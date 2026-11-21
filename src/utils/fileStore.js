import fs from "fs/promises";
import path from "path";

// Finished files live here on the server's own disk, one folder per job
// (uploads/out/<jobId>/<friendly name>), served by GET /api/files/:jobId/:name
// until the cleanup cron deletes them at expiry. The per-job folder lets every
// file keep a human name ("holiday (8 MB).mp4") without two jobs colliding.
// Inside uploads/ so the api and worker share it (same dir / same Docker volume).
export const OUTPUT_DIR = path.resolve("uploads/out");

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public base URL of this API, used to build download links the browser can reach.
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");

/**
 * Publish a finished file: move it into its job's folder and return its download URL.
 * rename() on the same disk only updates the directory entry — the file's bytes
 * are never read, so a 500MB video costs no RAM.
 */
export const publishFile = async (localFilePath, jobId, name) => {
  const dir = path.join(OUTPUT_DIR, jobId);
  await fs.mkdir(dir, { recursive: true });
  await fs.rename(localFilePath, path.join(dir, name));
  return `${PUBLIC_API_URL}/api/files/${jobId}/${encodeURIComponent(name)}`;
};

/** Where a published file lives, or null if the request doesn't look like one of ours. */
export const publishedPath = (jobId, name) =>
  JOB_ID.test(jobId) ? path.join(OUTPUT_DIR, jobId, path.basename(name)) : null;

/** Delete a job's published file(s); already-gone counts as success. */
export const deletePublishedFile = async (jobId, legacyName) => {
  if (JOB_ID.test(jobId)) await fs.rm(path.join(OUTPUT_DIR, jobId), { recursive: true, force: true });
  // Files published before per-job folders sat directly in OUTPUT_DIR.
  if (legacyName) await fs.rm(path.join(OUTPUT_DIR, path.basename(legacyName)), { force: true });
};
