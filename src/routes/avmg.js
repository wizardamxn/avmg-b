import express from "express";
import fs from "fs/promises";
import prisma from "../lib/prisma.js";
import { mediaQueue } from "../queue/mediaQueue.js";
import { optionalAuth, requireAuth } from "../middlewares/auth.js";
import { enforceQuota } from "../middlewares/quota.js";
import { tierUpload, notesUpload } from "../middlewares/uploadMiddleware.js";
import { probeRemoteSize } from "../services/probe.js";

const router = express.Router();

const SUB_EXT = /\.(srt|vtt|txt)$/i;

// File expiry stamped at creation → per-tier retention (guest 1h, account 24h).
const expiryFor = (req) =>
  new Date(Date.now() + (req.tier?.retentionHours ?? 1) * 60 * 60 * 1000);

// Sweep any multer temp files if a handler fails before enqueuing.
const cleanupFiles = async (req) => {
  const files = req.files ? Object.values(req.files).flat() : [];
  if (req.file) files.push(req.file);
  await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));
};

// For guest URL jobs, reject oversized videos before spending bandwidth.
const guestSizeGuard = async (req, res, videoUrl, verb) => {
  if (req.user || !req.tier?.maxRemoteBytes) return false;
  try {
    const size = await probeRemoteSize(videoUrl);
    if (size && size > req.tier.maxRemoteBytes) {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: `That video is too large for guests (over ${Math.round(
          req.tier.maxRemoteBytes / 1048576,
        )}MB). Sign up free to ${verb} it.`,
      });
      return true;
    }
  } catch {
    // Probe is flaky by nature — don't block on it.
  }
  return false;
};

// 🟢 ROUTE 1: Convert an uploaded file
router.post(
  "/convert",
  optionalAuth,
  enforceQuota("media"),
  tierUpload([
    { name: "videoFile", maxCount: 1 },
    { name: "watermarkFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      if (!req.files || !req.files["videoFile"])
        return res.status(400).json({ error: "NO_FILE", message: "No video file." });

      const videoFile = req.files["videoFile"][0];
      const watermarkFile = req.files["watermarkFile"] ? req.files["watermarkFile"][0] : null;

      const quality = req.body.quality || "best";
      const format = req.body.targetFormat || "mp3";
      const startTime = req.body.startTime || null;
      const duration = req.body.duration || null;

      const jobRecord = await prisma.mediaJob.create({
        data: {
          jobType: "job-convert",
          userId: req.user?.id ?? null,
          ip: req.ip,
          originalName: videoFile.originalname,
          targetFormat: format,
          quality,
          status: "PENDING",
          expiresAt: expiryFor(req),
        },
      });

      await mediaQueue.add("job-convert", {
        jobId: jobRecord.id,
        inputPath: videoFile.path,
        targetFormat: format,
        startTime,
        duration,
        watermarkPath: watermarkFile ? watermarkFile.path : null,
        quality,
      });

      res.status(200).json({ message: "Conversion job queued.", jobId: jobRecord.id, status: "PENDING" });
    } catch (error) {
      console.error("Conversion Error:", error);
      await cleanupFiles(req);
      return res.status(500).json({ error: "SERVER_ERROR", message: "Server error." });
    }
  },
);

// 🔵 ROUTE 2: Download from a URL
router.post("/download", optionalAuth, enforceQuota("media"), async (req, res) => {
  try {
    const quality = req.body.quality || "best";
    const format = req.body.targetFormat || "mp3";
    const videoUrl = req.body.videoUrl;
    if (!videoUrl) return res.status(400).json({ error: "NO_URL", message: "No video URL." });

    if (await guestSizeGuard(req, res, videoUrl, "download")) return;

    const jobRecord = await prisma.mediaJob.create({
      data: {
        jobType: "job-download",
        userId: req.user?.id ?? null,
        ip: req.ip,
        url: videoUrl,
        targetFormat: format,
        quality,
        status: "PENDING",
        expiresAt: expiryFor(req),
      },
    });

    await mediaQueue.add("job-download", { jobId: jobRecord.id, videoUrl, quality });
    res.status(200).json({ message: "Download job queued.", jobId: jobRecord.id, status: "PENDING" });
  } catch (error) {
    console.error("Download Error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Server error." });
  }
});

// 🟣 ROUTE 3: Download THEN convert
router.post("/download-convert", optionalAuth, enforceQuota("media"), async (req, res) => {
  try {
    const quality = req.body.quality || "best";
    const format = req.body.targetFormat || "mp3";
    const videoUrl = req.body.videoUrl;
    if (!videoUrl) return res.status(400).json({ error: "NO_URL", message: "No video URL." });

    // Subtitle-only (txt) jobs are tiny — only guard real media pulls.
    if (format !== "txt" && (await guestSizeGuard(req, res, videoUrl, "convert"))) return;

    const jobRecord = await prisma.mediaJob.create({
      data: {
        jobType: "job-download-convert",
        userId: req.user?.id ?? null,
        ip: req.ip,
        url: videoUrl,
        targetFormat: format,
        quality,
        status: "PENDING",
        expiresAt: expiryFor(req),
      },
    });

    await mediaQueue.add("job-download-convert", {
      jobId: jobRecord.id,
      videoUrl,
      targetFormat: format,
      quality,
    });
    res.status(200).json({ message: "Download+convert job queued.", jobId: jobRecord.id, status: "PENDING" });
  } catch (error) {
    console.error("Download-Convert Error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Server error." });
  }
});

// 🧠 ROUTE 4: AI Study Notes (accounts only)
router.post("/notes", requireAuth, enforceQuota("notes"), notesUpload, async (req, res) => {
  try {
    const videoUrl = req.body.videoUrl ? String(req.body.videoUrl).trim() : null;
    const subtitleFile = req.file || null;

    if (!videoUrl && !subtitleFile)
      return res.status(400).json({ error: "NO_INPUT", message: "Provide a video URL or a subtitle file." });

    if (subtitleFile && !SUB_EXT.test(subtitleFile.originalname)) {
      await fs.unlink(subtitleFile.path).catch(() => {});
      return res.status(400).json({ error: "BAD_FILE", message: "Only .srt, .vtt, or .txt files." });
    }

    const jobRecord = await prisma.mediaJob.create({
      data: {
        jobType: "job-ai-notes",
        userId: req.user.id,
        ip: req.ip,
        url: videoUrl,
        originalName: subtitleFile?.originalname ?? null,
        targetFormat: "md",
        status: "PENDING",
        expiresAt: expiryFor(req),
      },
    });

    await mediaQueue.add("job-ai-notes", {
      jobId: jobRecord.id,
      videoUrl,
      subtitlePath: subtitleFile?.path ?? null,
    });

    res.status(200).json({ message: "Notes job queued.", jobId: jobRecord.id, status: "PENDING" });
  } catch (error) {
    console.error("Notes Error:", error);
    await cleanupFiles(req);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Server error." });
  }
});

// 🔍 ROUTE 5: Check job status (public — the UUID is unguessable and guests
// have no token, so they must be able to poll their own jobs).
router.get("/status/:jobId", async (req, res) => {
  try {
    const job = await prisma.mediaJob.findUnique({ where: { id: req.params.jobId } });
    if (!job) return res.status(404).json({ error: "NOT_FOUND", message: "Job not found." });
    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ error: "SERVER_ERROR", message: "Database error." });
  }
});

// 📊 ROUTE 6: Job history (auth-scoped to the current user)
router.get("/jobs", requireAuth, async (req, res) => {
  try {
    const jobs = await prisma.mediaJob.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(jobs);
  } catch (error) {
    console.error("Failed to fetch jobs:", error);
    res.status(500).json({ error: "SERVER_ERROR", message: "Failed to retrieve job history." });
  }
});

export default router;
