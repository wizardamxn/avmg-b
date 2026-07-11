import dotenv from "dotenv";
import { Worker } from "bullmq";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma.js";
import { convertMedia } from "../services/mediaProcessor.js";
import { downloadVideo } from "../services/downloader.js";
import { cleanTranscript, parseSubtitles } from "../services/transcriptCleaner.js";
import { generateNotes } from "../services/notesGenerator.js";
import { transmitToCloud } from "../utils/supabaseUplink.js";
import { startCleanupCron } from "../jobs/cleanupCron.js";

dotenv.config();

// 🧹 Arm the recurring bucket + local-uploads sweep.
startCleanupCron();

const redisConnection = { url: process.env.REDIS_URL };

console.log("👷 Media Worker is running and waiting for jobs...");

const unlinkQuiet = async (p) => {
  if (!p) return;
  try {
    await fs.promises.unlink(p);
  } catch {
    // already gone — fine
  }
};

const fileSize = (p) => {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
};

const worker = new Worker(
  "MediaProcessingQueue",
  async (job) => {
    const {
      jobId,
      inputPath,
      targetFormat,
      videoUrl,
      startTime,
      duration,
      watermarkPath,
      quality,
      subtitlePath,
    } = job.data;

    console.log(`\n👨‍🍳 Worker picked up: ${job.name} (${jobId})`);

    await prisma.mediaJob.update({
      where: { id: jobId },
      data: { status: "PROCESSING" },
    });

    // Every temp file we touch — swept in the finally regardless of outcome.
    const temps = [inputPath, watermarkPath, subtitlePath].filter(Boolean);
    let finalFilePath = null; // → uploaded to Supabase
    let notesMarkdown = null; // → stored in the DB, no upload

    try {
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

        case "job-download": {
          const { videoPath } = await downloadVideo(videoUrl, "mp4", quality);
          if (!videoPath) throw new Error("Network pull returned empty payload.");
          finalFilePath = videoPath;
          break;
        }

        case "job-download-convert": {
          const { videoPath, subPath } = await downloadVideo(videoUrl, targetFormat, quality);
          if (videoPath) temps.push(videoPath);
          if (subPath) temps.push(subPath);

          if (targetFormat === "txt") {
            const transcriptPath = subPath ? await cleanTranscript(subPath) : null;
            if (!transcriptPath)
              throw new Error("No transcript could be extracted from this video.");
            finalFilePath = transcriptPath;
          } else {
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
        }

        case "job-ai-notes": {
          let parsed;
          if (subtitlePath) {
            parsed = await parseSubtitles(subtitlePath);
          } else {
            const { subPath } = await downloadVideo(videoUrl, "txt", "best");
            if (!subPath) throw new Error("No subtitles are available for this video.");
            temps.push(subPath);
            parsed = await parseSubtitles(subPath);
          }
          if (!parsed || !parsed.plainText)
            throw new Error("Could not read the transcript.");
          notesMarkdown = await generateNotes(parsed.timestampedText || parsed.plainText);
          break;
        }

        default:
          throw new Error("Unknown job type!");
      }

      // AI notes: store markdown in the DB, skip the cloud upload entirely.
      if (notesMarkdown) {
        await prisma.mediaJob.update({
          where: { id: jobId },
          data: { status: "COMPLETED", notesMarkdown, fileName: "study-notes.md" },
        });
        console.log(`✅ Notes job ${jobId} complete.`);
        return "notes";
      }

      // File-producing job: measure, upload, record. Supabase key must be safe.
      const size = fileSize(finalFilePath);
      const finalFileName = path.basename(finalFilePath).replace(/[^a-zA-Z0-9._-]/g, "_");
      const cloudUrl = await transmitToCloud(finalFilePath, finalFileName);

      await prisma.mediaJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED", path: cloudUrl, fileName: finalFileName, size },
      });

      console.log(`✅ Job ${jobId} complete → ${cloudUrl}`);
      return cloudUrl;
    } catch (error) {
      console.error(`❌ Job ${jobId} failed:`, error);
      await prisma.mediaJob
        .update({
          where: { id: jobId },
          data: { status: "FAILED", error: String(error?.message || error).slice(0, 500) },
        })
        .catch(() => {});
      throw error;
    } finally {
      // transmitToCloud already unlinks the uploaded file; sweep everything else
      // (inputs, watermark, intermediate downloads, subtitle files).
      await Promise.all(temps.map(unlinkQuiet));
    }
  },
  { connection: redisConnection },
);

worker.on("completed", (job) => console.log(`✅ Job ${job.id} officially done!`));
worker.on("failed", (job, err) => console.log(`🔥 Job ${job?.id} crashed: ${err.message}`));
