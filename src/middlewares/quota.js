import { tierFor } from "../config/tiers.js";
import { countJobsToday, countNotesToday } from "../lib/usage.js";

// Enforce the per-tier daily quota BEFORE any heavy work (upload/download).
// `kind`: "media" (convert/download) or "notes" (AI notes). Sets req.tier.
// Must run after optionalAuth so req.user is populated.
export const enforceQuota = (kind = "media") => async (req, res, next) => {
  try {
    const tier = tierFor(req.user);
    req.tier = tier;

    if (kind === "notes" && !req.user) {
      return res.status(403).json({
        error: "SIGNUP_REQUIRED",
        message: "AI Study Notes needs a free account.",
      });
    }

    const limit = kind === "notes" ? tier.aiNotesDaily : tier.dailyJobs;
    const used =
      kind === "notes"
        ? await countNotesToday({ user: req.user, ip: req.ip })
        : await countJobsToday({ user: req.user, ip: req.ip });

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
