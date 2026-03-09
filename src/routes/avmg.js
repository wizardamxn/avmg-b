import express from "express";
import { PrismaClient } from "@prisma/client";
import { upload } from "../middlewares/uploadMiddleware.js";
import { mediaQueue } from "../queue/mediaQueue.js";

const router = express.Router();
const prisma = new PrismaClient();

// 🟢 ROUTE 1: Just Convert (Push Model)
// 🟢 ROUTE 1: Just Convert (Push Model)
router.post(
  "/convert",
  upload.fields([
    { name: "videoFile", maxCount: 1 },
    { name: "watermarkFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      // 1. Ensure the video file actually exists in the fields array
      if (!req.files || !req.files["videoFile"])
        return res.status(400).json({ error: "No video file." });

      // 2. Safely extract our files
      const videoFile = req.files["videoFile"][0];
      const watermarkFile = req.files["watermarkFile"]
        ? req.files["watermarkFile"][0]
        : null;

      // 3. Grab all the text payload data
      const quality = req.body.quality || "best";
      const format = req.body.targetFormat || "mp3";
      const webhookUrl = req.body.webhookUrl || null;
      const startTime = req.body.startTime || null;
      const duration = req.body.duration || null;
      const videoUrl = req.body.videoUrl;
      // 4. Create the DB Receipt
      const jobRecord = await prisma.mediaJob.create({
        data: {
          jobType: "job-convert", // 👈 Tell the DB which engine we used
          url: videoUrl, // 👈 Save the network link
          targetFormat: format, // 👈 Save the format
          quality: quality, // 👈 Save the quality
          status: "PENDING",
        },
      });

      // 5. Slap the ticket on the Redis rail!
      await mediaQueue.add("job-convert", {
        jobId: jobRecord.id,
        inputPath: videoFile.path, // 👈 Safely using the extracted variable
        targetFormat: format,
        webhookUrl: webhookUrl,
        startTime: startTime,
        duration: duration,
        watermarkPath: watermarkFile ? watermarkFile.path : null, // 👈 Safely using the extracted variable
        quality: quality,
      });

      res.status(200).json({
        message: "Conversion job queued successfully!",
        jobId: jobRecord.id,
        status: "PENDING",
      });
    } catch (error) {
      console.error("Conversion Error:", error);
      return res.status(500).json({ error: "Server error." });
    }
  },
);

// 🔵 ROUTE 2: Just Download (Pull Model)
router.post("/download", express.json(), async (req, res) => {
  try {
    const webhookUrl = req.body.webhookUrl || null; // 👈 Grab it!
    const quality = req.body.quality || "best";
    const videoUrl = req.body.videoUrl;
          const format = req.body.targetFormat || "mp3";

    const jobRecord = await prisma.mediaJob.create({
      data: {
        jobType: "job-download", // 👈 Tell the DB which engine we used
        url: videoUrl, // 👈 Save the network link
        targetFormat: format, // 👈 Save the format
        quality: quality, // 👈 Save the quality
        status: "PENDING",
      },
    });

    await mediaQueue.add("job-download", {
      jobId: jobRecord.id,
      videoUrl: videoUrl,
      webhookUrl: webhookUrl, // 👈 Put it on the ticket!
      quality: quality, // 👈 Put it on the ticket!
    });

    res.status(200).json({
      message: "Download job queued successfully!",
      jobId: jobRecord.id,
      status: "PENDING",
    });
  } catch (error) {
    console.error("Download Error:", error);
    return res.status(500).json({ error: "Server error." });
  }
});

// 🟣 ROUTE 3: The Combo (Download THEN Convert)
router.post("/download-convert", express.json(), async (req, res) => {
  try {
    const quality = req.body.quality || "best";
    const format = req.body.targetFormat || "mp3";
    const webhookUrl = req.body.webhookUrl || null; // 👈 Grab it!
    const videoUrl = req.body.videoUrl; // 👈 Grab the video URL

    console.log(
      `Received download-convert request for URL: ${videoUrl} with target format: ${format}`,
    );

    // 1. Create the database record WITH the new fields!
    const jobRecord = await prisma.mediaJob.create({
      data: {
        jobType: "job-download-convert", // 👈 Tell the DB which engine we used
        url: videoUrl, // 👈 Save the network link
        targetFormat: format, // 👈 Save the format
        quality: quality, // 👈 Save the quality
        status: "PENDING",
      },
    });

    await mediaQueue.add("job-download-convert", {
      jobId: jobRecord.id,
      videoUrl: req.body.videoUrl,
      targetFormat: format,
      webhookUrl: webhookUrl, // 👈 Put it on the ticket!
      quality: quality, // 👈 Put it on the ticket!
    });

    res.status(200).json({
      message: "Download and conversion job queued successfully!",
      jobId: jobRecord.id,
      status: "PENDING",
    });
  } catch (error) {
    console.error("Download-Convert Error:", error);
    return res.status(500).json({ error: "Server error." });
  }
});
// 🔍 ROUTE 4: Check Job Status
router.get("/status/:jobId", async (req, res) => {
  try {
    const job = await prisma.mediaJob.findUnique({
      where: { id: req.params.jobId },
    });
    if (!job) return res.status(404).json({ error: "Job not found" });

    // Return the database row to the frontend!
    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ error: "Database error" });
  }
});

// Add this near your other routes in your Express server

router.get("/jobs", async (req, res) => {
  try {
    // Fetch the 50 most recent jobs, newest first
    const jobs = await prisma.mediaJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(jobs);
  } catch (error) {
    console.error("Failed to fetch telemetry:", error);
    res.status(500).json({ error: "Failed to retrieve job history." });
  }
});
export default router;
