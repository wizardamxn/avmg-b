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

// Every tool job counts toward the same daily allowance.
export const countJobsToday = ({ user, ip }) =>
  prisma.mediaJob.count({
    where: { createdAt: { gte: startOfUtcDay() }, ...scope({ user, ip }) },
  });

// Snapshot used by GET /auth/me and the quota UI.
export const getUsage = async ({ user, ip }) => {
  const tier = tierFor(user);
  return { jobsUsed: await countJobsToday({ user, ip }), jobsLimit: tier.dailyJobs };
};
