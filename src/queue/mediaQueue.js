import { Queue } from 'bullmq';

// Connect to your Docker Redis instance
const redisConnection = {
  host: '127.0.0.1',
  port: 6379
};

// Create the Queue (The Ticket Rail)
export const mediaQueue = new Queue('MediaProcessingQueue', {
  connection: redisConnection
});