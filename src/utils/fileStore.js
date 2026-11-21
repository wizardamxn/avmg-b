import fs from "fs/promises";
import path from "path";

// Finished files live here on the server's own disk and are served by
// GET /api/files/:name until the cleanup cron deletes them at expiry.
// Inside uploads/ so the api and worker share it (same dir / same Docker volume).
export const OUTPUT_DIR = path.resolve("uploads/out");

// Public base URL of this API, used to build download links the browser can reach.
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");

/**
 * Publish a finished file: move it into OUTPUT_DIR and return its download URL.
 * rename() on the same disk only updates the directory entry — the file's bytes
 * are never read, so a 500MB video costs no RAM (the old Supabase upload read
 * the whole file into memory first).
 */
export const publishFile = async (localFilePath, fileName) => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.rename(localFilePath, path.join(OUTPUT_DIR, fileName));
  return `${PUBLIC_API_URL}/api/files/${encodeURIComponent(fileName)}`;
};

/** Delete a published file; already-gone counts as success. */
export const deletePublishedFile = async (fileName) => {
  try {
    await fs.unlink(path.join(OUTPUT_DIR, path.basename(fileName)));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
};
