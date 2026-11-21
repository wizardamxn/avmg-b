import cron from "node-cron";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import prisma from "../lib/prisma.js";
import { deletePublishedFile } from "../utils/fileStore.js";

dotenv.config();

// Legacy fallback retention for rows created before per-tier expiresAt existed.
const RETENTION_HOURS = Number(process.env.FILE_RETENTION_HOURS || 1);

// 🕒 When the broom runs. Default: top of every hour.
const CLEANUP_SCHEDULE = process.env.CLEANUP_CRON || "0 * * * *";

// Delete local uploads/ files older than 24h — a safety net for temp files
// that leaked because a job crashed before its finally-block ran.
const sweepLocalUploads = async () => {
  const dir = "uploads/";
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    const names = await fs.readdir(dir);
    for (const name of names) {
      const fp = path.join(dir, name);
      try {
        const st = await fs.stat(fp);
        if (st.isFile() && st.mtimeMs < cutoff) {
          await fs.unlink(fp);
          removed++;
        }
      } catch {
        // file vanished between readdir and stat — ignore
      }
    }
  } catch {
    // uploads/ missing — nothing to do
  }
  if (removed) console.log(`🧹 [CLEANUP] Removed ${removed} stale local file(s).`);
};

/**
 * One sweep: delete every published file past its expiry, mark its row
 * as swept (path = null → "link expired"), then tidy stale local temp files.
 */
export const runCleanup = async () => {
  const now = new Date();
  const legacyCutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
  console.log(`🧹 [CLEANUP] Sweeping expired files @ ${now.toISOString()}...`);

  await sweepLocalUploads();

  // Finished files still published (path !== null) whose expiry passed.
  const expired = await prisma.mediaJob.findMany({
    where: {
      status: "COMPLETED",
      path: { not: null },
      fileName: { not: null },
      OR: [
        { expiresAt: { lt: now } },
        { expiresAt: null, createdAt: { lt: legacyCutoff } },
      ],
    },
    select: { id: true, fileName: true },
  });

  if (expired.length === 0) {
    console.log("🧹 [CLEANUP] Nothing expired.");
    return;
  }

  console.log(`🧹 [CLEANUP] Deleting ${expired.length} expired file(s)...`);

  // Only rows whose file is really gone get marked; failures retry next run.
  const swept = [];
  for (const j of expired) {
    try {
      await deletePublishedFile(j.id, j.fileName);
      swept.push(j.id);
    } catch (err) {
      console.error(`🧹 [CLEANUP_ERR] Could not delete ${j.fileName}:`, err.message);
    }
  }

  // Null path = "download link expired"; fileName kept as a historical record.
  await prisma.mediaJob.updateMany({
    where: { id: { in: swept } },
    data: { path: null },
  });

  console.log(`✅ [CLEANUP] Removed ${swept.length} file(s) and tidied the DB.`);
};

/**
 * Register the recurring sweep. Call once when a long-running process boots.
 */
export const startCleanupCron = () => {
  cron.schedule(CLEANUP_SCHEDULE, () => {
    runCleanup().catch((err) =>
      console.error("🧹 [CLEANUP_ERR] Sweep crashed:", err.message),
    );
  });
  console.log(
    `🧹 Cleanup cron armed — schedule "${CLEANUP_SCHEDULE}", per-tier expiry (legacy ${RETENTION_HOURS}h).`,
  );

  // One sweep on boot to clear any backlog.
  runCleanup().catch((err) =>
    console.error("🧹 [CLEANUP_ERR] Initial sweep crashed:", err.message),
  );
};
