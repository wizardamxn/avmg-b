import crypto from "node:crypto";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export const newOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");

// Keyed, so a leaked database can't be brute-forced back to 6-digit codes offline.
export const hashOtp = (code) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(String(code)).digest("hex");

export const canResend = (user, now = Date.now()) =>
  !user.otpSentAt || now - user.otpSentAt.getTime() >= OTP_RESEND_MS;

/** "ok" | "wrong" | "expired" for a code typed by `user`. */
export const checkOtp = (user, code, now = Date.now()) => {
  if (!user || user.emailVerified || !user.otpHash || !user.otpExpires) return "wrong";
  if (user.otpExpires.getTime() < now || user.otpAttempts >= OTP_MAX_ATTEMPTS) return "expired";
  const a = Buffer.from(hashOtp(code));
  const b = Buffer.from(user.otpHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? "ok" : "wrong";
};
