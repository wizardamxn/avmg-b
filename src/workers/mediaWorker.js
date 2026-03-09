import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { convertMedia } from "../services/mediaProcessor.js";
import { downloadVideo } from "../services/downloader.js";
import { cleanTranscript } from "../services/transcriptCleaner.js";

import path from "path";

const prisma = new PrismaClient();
const redisConnection = { host: "127.0.0.1", port: 6379 };

console.log("👷 Media Worker is running and waiting for jobs...");

const worker = new Worker(
  "MediaProcessingQueue",
  async (job) => {
    // 1. 📦 EXTRACT ABSOLUTELY EVERYTHING FROM THE TICKET!
    const {
      jobId,
      inputPath,
      targetFormat,
      videoUrl,
      webhookUrl,
      startTime, // 👈 Added
      duration, // 👈 Added
      watermarkPath, // 👈 Added
      quality, // 👈 Added
    } = job.data;

    console.log(`\n👨‍🍳 Worker picked up ticket: ${job.name}`);

    // 2. Mark as processing
    await prisma.mediaJob.update({
      where: { id: jobId },
      data: { status: "PROCESSING" },
    });

    let finalFilePath = "";

    try {
      // 3. 🧠 THE SWITCHBOARD
      switch (job.name) {
        case "job-convert":
          finalFilePath = await convertMedia(
            inputPath,
            targetFormat,
            startTime,
            duration,
            watermarkPath,
            quality,
          );
          break;

        case "job-download":
          console.log("Initiating pure network pull...");

          // 📦 1. We must destructure the object returned by the new downloader!
          // We pass "mp4" as the targetFormat so the Ghost Protocol knows NOT to skip the video.
          const { videoPath: pureVideoPath } = await downloadVideo(
            videoUrl,
            "mp4",
            quality,
          );

          if (!pureVideoPath) {
            throw new Error(
              "System Failure: Network pull returned empty payload.",
            );
          }

          // 2. Assign it to the final variable so the DB can save it
          finalFilePath = pureVideoPath;
          break;
        case "job-download-convert":
          console.log("Combo Step 1: Downloading & Scraping Subs...");

          // 👈 Pass targetFormat into the downloader!
          const { videoPath, subPath } = await downloadVideo(
            videoUrl,
            targetFormat,
            quality,
          );

          let finalTranscriptPath = null;
          if (subPath) {
            finalTranscriptPath = await cleanTranscript(subPath);
          }

          // 🛣️ THE BYPASS LANE
          if (targetFormat === "txt") {
            if (!finalTranscriptPath)
              throw new Error(
                "No transcript could be extracted from this video.",
              );
            console.log("Skipping FFmpeg -> Sending Transcript directly!");
            finalFilePath = finalTranscriptPath;
          } else {
            // Normal video/audio conversion routing
            console.log("Combo Step 2: Converting Media...");
            finalFilePath = await convertMedia(
              videoPath,
              targetFormat,
              startTime,
              duration,
              watermarkPath,
              quality,
            );
          }
          break;

        default:
          throw new Error("Unknown job type!");
      }

      const finalFileName = path.basename(finalFilePath);

      // 4. Update the database to COMPLETED
      await prisma.mediaJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          path: finalFilePath,
          fileName: finalFileName,
        },
      });

      // 5. 🚀 THE WEBHOOK TRIGGER 🚀
      if (webhookUrl) {
        console.log(`📞 Calling Webhook: ${webhookUrl}`);
        try {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "job.completed",
              jobId: jobId,
              status: "COMPLETED",
              fileName: finalFileName,
              downloadUrl: `http://localhost:5000/${finalFilePath}`,
            }),
          });
          console.log("✅ Webhook delivered successfully!");
        } catch (webhookErr) {
          console.error("⚠️ Failed to deliver webhook:", webhookErr.message);
        }
      }

      return finalFilePath;
    } catch (error) {
      console.error(`❌ Job ${jobId} failed:`, error);

      await prisma.mediaJob.update({
        where: { id: jobId },
        data: { status: "FAILED" },
      });

      throw error;
    }
  },
  { connection: redisConnection },
);

worker.on("completed", (job) =>
  console.log(`✅ Job ${job.id} officially done!`),
);
worker.on("failed", (job, err) =>
  console.log(`🔥 Job ${job?.id} crashed: ${err.message}`),
);
