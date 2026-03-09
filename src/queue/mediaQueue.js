import { Queue } from "bullmq";
import dotenv from "dotenv";

dotenv.config();

const redisConnection = {
  url: process.env.REDIS_URL,
};

export const mediaQueue = new Queue("MediaProcessingQueue", {
  connection: redisConnection,
});