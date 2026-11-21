import { tierFor } from "../config/tiers.js";
import { countJobsToday } from "../lib/usage.js";

// Enforce the per-tier daily job quota BEFORE any heavy work (upload/download).
// Sets req.tier. Must run after optionalAuth so req.user is populated.
// (The argument is the quota kind; "media" is the only one now that AI notes moved to Warden.)
export const enforceQuota = (_kind = "media") => async (req, res, next) => {
  try {
    const tier = tierFor(req.user);
    req.tier = tier;

    const limit = tier.dailyJobs;
    const used = await countJobsToday({ user: req.user, ip: req.ip });

    if (used >= limit) {
      return res.status(429).json({
        error: "QUOTA_EXCEEDED",
        used,
        limit,
        message: req.user
          ? `Daily limit of ${limit} reached. Resets at 00:00 UTC.`
          : `Guest limit of ${limit}/day reached — sign up free for more.`,
      });
    }

    next();
  } catch (error) {
    console.error("Quota check error:", error);
    // Fail open: a DB blip shouldn't hard-block the tools.
    if (!req.tier) req.tier = tierFor(req.user);
    next();
  }
};
