import { Queue } from "bullmq";
import dotenv from "dotenv";

dotenv.config();

const redisConnection = {
  url: process.env.REDIS_URL,
};

export const mediaQueue = new Queue("MediaProcessingQueue", {
  connection: redisConnection,
  defaultJobOptions: {
    // Retry once on transient failures (network blips, yt-dlp hiccups).
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    // Don't let finished/failed jobs pile up in Redis.
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  },
});
