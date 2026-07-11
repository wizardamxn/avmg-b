// Tier definitions. GUEST = anonymous (tracked by IP); FREE = any registered
// user. There is no paid tier — signing up IS the upgrade.

export const TIERS = {
  GUEST: {
    name: "GUEST",
    maxUploadBytes: 5 * 1024 * 1024, // 5 MB uploads
    maxRemoteBytes: 50 * 1024 * 1024, // 50 MB cap on URL downloads (probed)
    dailyJobs: 3,
    aiNotesDaily: 0, // AI notes locked for guests
    retentionHours: 1,
  },
  FREE: {
    name: "FREE",
    maxUploadBytes: 100 * 1024 * 1024, // 100 MB uploads
    maxRemoteBytes: null, // no probe cap
    dailyJobs: 20,
    aiNotesDaily: 5,
    retentionHours: 24,
  },
};

// Pick the tier for a request. `user` is req.user (null for guests).
export const tierFor = (user) => (user ? TIERS.FREE : TIERS.GUEST);
