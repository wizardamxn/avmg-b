// Load .env here too: the upload middleware reads these limits at import time,
// before the entry file's dotenv.config() runs (ESM evaluates imports first).
import "dotenv/config";

// Tier definitions. GUEST = anonymous (tracked by IP); FREE = any registered
// user. There is no paid tier — signing up IS the upgrade.

const MB = 1024 * 1024;
/** A positive number from the environment, or the default (blank/invalid values are ignored). */
const envNumber = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const TIERS = {
  GUEST: {
    name: "GUEST",
    maxUploadBytes: envNumber("GUEST_MAX_UPLOAD_MB", 5) * MB,
    maxRemoteBytes: envNumber("GUEST_MAX_REMOTE_MB", 50) * MB, // cap on URL downloads (probed)
    dailyJobs: 3,
    retentionHours: 1,
  },
  FREE: {
    name: "FREE",
    maxUploadBytes: envNumber("FREE_MAX_UPLOAD_MB", 100) * MB,
    maxRemoteBytes: null, // no probe cap
    dailyJobs: 20,
    retentionHours: 24,
  },
};

// Pick the tier for a request. `user` is req.user (null for guests).
export const tierFor = (user) => (user ? TIERS.FREE : TIERS.GUEST);
