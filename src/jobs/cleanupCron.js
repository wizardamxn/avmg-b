import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import prisma from "../lib/prisma.js";
import { STORAGE_PREFIX } from "../utils/supabaseUplink.js";

dotenv.config();

// Same Supabase connection the uplink uses (service key = full admin rights)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const BUCKET = "avmg-payloads";

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
 * One sweep: delete every finished Supabase file past its expiry, mark its row
 * as swept (path = null → "link expired"), then tidy stale local temp files.
 */
export const runCleanup = async () => {
  const now = new Date();
  const legacyCutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
  console.log(`🧹 [CLEANUP] Sweeping expired files @ ${now.toISOString()}...`);

  await sweepLocalUploads();

  // Finished files still live in Supabase (path !== null) whose expiry passed.
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
    console.log("🧹 [CLEANUP] Bucket is tidy.");
    return;
  }

  // Only ever delete keys inside this project's folder in the shared bucket.
  const storageKeys = expired.map((j) => STORAGE_PREFIX + j.fileName);
  console.log(`🧹 [CLEANUP] Deleting ${storageKeys.length} expired file(s)...`);

  const { error } = await supabase.storage.from(BUCKET).remove(storageKeys);
  if (error) {
    // Leave rows untouched so the next run retries them.
    console.error("🧹 [CLEANUP_ERR] Supabase deletion failed:", error.message);
    return;
  }

  // Null path = "download link expired"; fileName kept as a historical record.
  await prisma.mediaJob.updateMany({
    where: { id: { in: expired.map((j) => j.id) } },
    data: { path: null },
  });

  console.log(`✅ [CLEANUP] Removed ${storageKeys.length} file(s) and tidied the DB.`);
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
