import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import prisma from "../lib/prisma.js";

dotenv.config();

// Same Supabase connection the uplink uses (service key = full admin rights)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const BUCKET = "avmg-payloads";

// ⏳ How long a finished file is allowed to live before we sweep it.
const RETENTION_HOURS = Number(process.env.FILE_RETENTION_HOURS || 1);

// 🕒 When the broom runs. Default: top of every hour. (min hour day month weekday)
const CLEANUP_SCHEDULE = process.env.CLEANUP_CRON || "0 * * * *";

/**
 * One sweep of the bucket: delete every COMPLETED file older than the
 * retention window, then mark its DB row as expired (path = null) so we
 * never look at it again.
 */
export const runCleanup = async () => {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
  console.log(
    `🧹 [CLEANUP] Sweeping files older than ${cutoff.toISOString()}...`,
  );

  // 1. Find finished files that are past their expiry and not yet purged.
  //    path !== null  → still live in Supabase.  path === null  → already swept.
  const expired = await prisma.mediaJob.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { lt: cutoff },
      path: { not: null },
      fileName: { not: null },
    },
    select: { id: true, fileName: true },
  });

  if (expired.length === 0) {
    console.log("🧹 [CLEANUP] Nothing to delete. Bucket is tidy.");
    return;
  }

  const fileNames = expired.map((j) => j.fileName);
  console.log(
    `🧹 [CLEANUP] Found ${fileNames.length} expired file(s). Deleting from Supabase...`,
  );

  // 2. Delete the actual objects from the bucket (accepts a batch of keys).
  const { error } = await supabase.storage.from(BUCKET).remove(fileNames);
  if (error) {
    // Leave the rows untouched so the next run retries them.
    console.error("🧹 [CLEANUP_ERR] Supabase deletion failed:", error.message);
    return;
  }

  // 3. Mark the rows as swept. Null path = "download link expired".
  //    fileName is kept as a historical record of what the file was called.
  await prisma.mediaJob.updateMany({
    where: { id: { in: expired.map((j) => j.id) } },
    data: { path: null },
  });

  console.log(
    `✅ [CLEANUP] Removed ${fileNames.length} file(s) and tidied the database.`,
  );
};

/**
 * Register the recurring sweep. Call this once when a long-running process boots.
 */
export const startCleanupCron = () => {
  cron.schedule(CLEANUP_SCHEDULE, () => {
    runCleanup().catch((err) =>
      console.error("🧹 [CLEANUP_ERR] Sweep crashed:", err.message),
    );
  });
  console.log(
    `🧹 Cleanup cron armed — schedule "${CLEANUP_SCHEDULE}", retention ${RETENTION_HOURS}h.`,
  );

  // Run one sweep on boot so a freshly-started server clears any backlog.
  runCleanup().catch((err) =>
    console.error("🧹 [CLEANUP_ERR] Initial sweep crashed:", err.message),
  );
};
