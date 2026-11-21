import express from "express";
import fs from "fs/promises";
import prisma from "../lib/prisma.js";
import { mediaQueue } from "../queue/mediaQueue.js";
import { optionalAuth, requireAuth } from "../middlewares/auth.js";
import { enforceQuota } from "../middlewares/quota.js";
import { tierUpload } from "../middlewares/uploadMiddleware.js";
import { probeRemoteSize } from "../services/probe.js";
import { probe, mediaSummary } from "../services/tools.js";
import { compressOptions, audioOptions, frameOptions, editOptions, subtitleOptions } from "../lib/toolOptions.js";

const router = express.Router();

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

// 🧰 Upload tools: same shape for each — optional auth → daily quota → tier-sized
// upload (field "file") → validate options → job row → queue. Options are
// whitelisted in lib/toolOptions.js before they get anywhere near ffmpeg.
const uploadTool = (jobType, validate) => [
  optionalAuth,
  enforceQuota("media"),
  tierUpload([{ name: "file", maxCount: 1 }]),
  async (req, res) => {
    const file = req.files?.file?.[0];
    try {
      if (!file) return res.status(400).json({ error: "NO_FILE", message: "No file uploaded." });
      const options = validate(req.body);
      if (typeof options === "string") {
        await cleanupFiles(req);
        return res.status(400).json({ error: "BAD_OPTIONS", message: options });
      }
      const jobRecord = await prisma.mediaJob.create({
        data: {
          jobType,
          userId: req.user?.id ?? null,
          ip: req.ip,
          originalName: file.originalname,
          targetFormat: options.outputFormat,
          status: "PENDING",
          expiresAt: expiryFor(req),
        },
      });
      await mediaQueue.add(jobType, { jobId: jobRecord.id, inputPath: file.path, options });
      res.status(200).json({ message: "Job queued.", jobId: jobRecord.id, status: "PENDING" });
    } catch (error) {
      console.error(`${jobType} error:`, error);
      await cleanupFiles(req);
      return res.status(500).json({ error: "SERVER_ERROR", message: "Server error." });
    }
  },
];

// 🗜️ ROUTE 4: Compress a video to fit a size (Discord 8 MB, WhatsApp 16 MB, ...)
router.post("/compress", ...uploadTool("job-compress", compressOptions));
// 🎚️ ROUTE 5: Audio cleanup — even out volume, cut silences, change speed
router.post("/audio-clean", ...uploadTool("job-audio-clean", audioOptions));
// 🖼️ ROUTE 6: Frame grabs — one still at a timestamp, or a contact sheet
router.post("/frames", ...uploadTool("job-frames", frameOptions));
// ✂️ ROUTE 7: Quick edits — rotate, flip, mute, speed
router.post("/edit", ...uploadTool("job-edit", editOptions));

// 📜 ROUTE 8: Subtitles / transcript from a link, without downloading the video
router.post("/subtitles", optionalAuth, enforceQuota("media"), async (req, res) => {
  try {
    const videoUrl = req.body.videoUrl ? String(req.body.videoUrl).trim() : "";
    if (!/^https?:\/\//i.test(videoUrl)) return res.status(400).json({ error: "NO_URL", message: "Paste a video link." });
    const options = subtitleOptions(req.body);
    if (typeof options === "string") return res.status(400).json({ error: "BAD_OPTIONS", message: options });

    const jobRecord = await prisma.mediaJob.create({
      data: {
        jobType: "job-subtitles",
        userId: req.user?.id ?? null,
        ip: req.ip,
        url: videoUrl,
        targetFormat: options.outputFormat,
        status: "PENDING",
        expiresAt: expiryFor(req),
      },
    });
    await mediaQueue.add("job-subtitles", { jobId: jobRecord.id, videoUrl, options });
    res.status(200).json({ message: "Subtitles job queued.", jobId: jobRecord.id, status: "PENDING" });
  } catch (error) {
    console.error("Subtitles Error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Server error." });
  }
});

// 🔬 ROUTE 9: Media inspector — instant ffprobe summary; the upload is deleted
// straight away. No queue and no daily quota: it's a few ms of work.
router.post("/inspect", optionalAuth, tierUpload([{ name: "file", maxCount: 1 }]), async (req, res) => {
  const file = req.files?.file?.[0];
  if (!file) return res.status(400).json({ error: "NO_FILE", message: "No file uploaded." });
  try {
    res.json({ name: file.originalname, ...mediaSummary(await probe(file.path)) });
  } catch {
    res.status(422).json({ error: "UNREADABLE", message: "That doesn't look like an audio, video or image file." });
  } finally {
    await cleanupFiles(req);
  }
});

// 🔍 ROUTE 10: Check job status (public — the UUID is unguessable and guests
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

// 📊 ROUTE 11: Job history (auth-scoped to the current user)
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
