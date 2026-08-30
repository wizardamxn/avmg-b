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

dotenv.config();

// NOTE: the cleanup cron deliberately does NOT live here any more. This process
// is horizontally scalable (`--scale worker=3`), and running the sweep inside it
// would mean N concurrent sweeps deleting the same Supabase objects and racing
// on the same rows. It now runs as its own single-replica `cleanup` service.

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

// ---- liveness heartbeat ---------------------------------------------------
// The worker has no HTTP port, so there's nothing for Docker to poll. Checking
// "is the process running" is nearly worthless — a deadlocked event loop still
// counts as running. Instead we touch a file on a timer: if the loop is wedged,
// the timestamp goes stale and the healthcheck fails. ffmpeg runs as a child
// process so it doesn't block the loop, and the heartbeat keeps ticking during
// long conversions (which is what we want — busy is not unhealthy).
const HEARTBEAT_FILE = "/tmp/worker-alive";
const heartbeat = setInterval(() => {
  fs.promises.writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => {});
}, 15_000);
fs.promises.writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => {});

// ---- graceful shutdown ----------------------------------------------------
// Docker sends SIGTERM on `compose down`/`stop`, waits out stop_grace_period,
// then SIGKILLs. Without a handler Node exits immediately and abandons whatever
// job is mid-flight: ffmpeg dies with a half-written output file still sitting
// in the uploads volume, and the MediaJob row stays PROCESSING forever — the
// frontend then polls that row until its 10-minute ceiling before giving up.
//
// worker.close() refuses new jobs and waits for the active one to finish, which
// is exactly why stop_grace_period has to cover a realistic conversion.
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return; // a second Ctrl-C shouldn't re-enter this
  shuttingDown = true;
  console.log(`\n🛑 ${signal} received — finishing current job, accepting no new ones.`);
  try {
    clearInterval(heartbeat); // otherwise this timer keeps the process alive
    await worker.close();
    await prisma.$disconnect();
    console.log("✅ Worker drained cleanly.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Shutdown failed:", err);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
