import prisma from "./prisma.js";
import { tierFor } from "../config/tiers.js";

// Daily quotas reset at UTC midnight — simple and predictable.
export const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

// Registered users are scoped by userId; guests by IP (rows with no userId).
const scope = ({ user, ip }) => (user ? { userId: user.id } : { ip, userId: null });

// General job count for the day EXCLUDING AI-notes jobs, so notes have their
// own independent budget and don't silently eat the media job allowance.
export const countJobsToday = ({ user, ip }) =>
  prisma.mediaJob.count({
    where: {
      createdAt: { gte: startOfUtcDay() },
      jobType: { not: "job-ai-notes" },
      ...scope({ user, ip }),
    },
  });

export const countNotesToday = ({ user, ip }) =>
  prisma.mediaJob.count({
    where: {
      createdAt: { gte: startOfUtcDay() },
      jobType: "job-ai-notes",
      ...scope({ user, ip }),
    },
  });

// Snapshot used by GET /auth/me and the quota UI.
export const getUsage = async ({ user, ip }) => {
  const tier = tierFor(user);
  const [jobsUsed, notesUsed] = await Promise.all([
    countJobsToday({ user, ip }),
    countNotesToday({ user, ip }),
  ]);
  return {
    jobsUsed,
    jobsLimit: tier.dailyJobs,
    notesUsed,
    notesLimit: tier.aiNotesDaily,
  };
};
