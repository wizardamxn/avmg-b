import dotenv from "dotenv";
import prisma from "../lib/prisma.js";
import { startCleanupCron } from "../jobs/cleanupCron.js";

dotenv.config();

// Single-replica sweeper. Split out of mediaWorker.js so the media worker can
// be scaled horizontally without multiplying the cleanup sweep — N copies would
// race each other deleting the same expired files and updating the same rows.
//
// This service must NEVER be scaled above 1 replica.
startCleanupCron();

console.log("🧹 Cleanup service running (must stay at 1 replica).");

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 ${signal} received — stopping cleanup service.`);
  try {
    await prisma.$disconnect();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
