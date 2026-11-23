import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";
import { getUsage } from "../lib/usage.js";
import { mailConfigured, sendMail } from "../lib/mailer.js";
import { OTP_TTL_MS, canResend, checkOtp, hashOtp, newOtp } from "../lib/otp.js";

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

const readEmail = (req) => String(req.body.email || "").trim().toLowerCase();

// Emails a fresh 6-digit code, replacing any earlier one.
const sendOtp = async (user) => {
  const code = newOtp();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      otpHash: hashOtp(code),
      otpExpires: new Date(Date.now() + OTP_TTL_MS),
      otpAttempts: 0,
      otpSentAt: new Date(),
    },
  });
  await sendMail({
    to: user.email,
    subject: `${code} is your AVMG verification code`,
    text: `Your AVMG verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't sign up, ignore this email.`,
    html: `<p>Your AVMG verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you didn't sign up, ignore this email.</p>`,
  });
};

// POST /api/auth/signup
// With SMTP configured, new accounts get no token until they enter the emailed code.
router.post("/signup", async (req, res) => {
  try {
    const email = readEmail(req);
    const password = String(req.body.password || "");
    const name = req.body.name ? String(req.body.name).trim() : null;

    if (!EMAIL_RE.test(email))
      return res.status(400).json({ error: "INVALID_EMAIL", message: "Enter a valid email." });
    if (password.length < 8)
      return res.status(400).json({ error: "WEAK_PASSWORD", message: "Password must be at least 8 characters." });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      return res.status(409).json({ error: "EMAIL_TAKEN", message: "That email is already registered." });

    const verify = mailConfigured();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, name, passwordHash, emailVerified: !verify },
    });

    if (verify) {
      await sendOtp(user);
      return res.status(201).json({ verify: true, email, message: "Check your email for a 6-digit code." });
    }
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Could not create account." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const email = readEmail(req);
    const password = String(req.body.password || "");

    const user = await prisma.user.findUnique({ where: { email } });
    // Same message whether the email is unknown or the password is wrong.
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok)
      return res.status(401).json({ error: "BAD_CREDENTIALS", message: "Wrong email or password." });

    if (!user.emailVerified) {
      if (canResend(user)) await sendOtp(user);
      return res.status(403).json({
        error: "EMAIL_UNVERIFIED",
        message: "Verify your email first. We sent a code to your inbox.",
      });
    }

    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Could not log in." });
  }
});

// POST /api/auth/verify-email  { email, code } -> token, like login
router.post("/verify-email", async (req, res) => {
  try {
    const email = readEmail(req);
    const code = String(req.body.code || "").trim();
    if (!/^\d{6}$/.test(code))
      return res.status(400).json({ error: "INVALID_CODE", message: "Enter the 6-digit code from the email." });

    const user = await prisma.user.findUnique({ where: { email } });
    const result = checkOtp(user, code);

    if (result === "expired")
      return res.status(400).json({ error: "INVALID_CODE", message: "That code has expired. Send a new one." });
    if (result === "wrong") {
      // Atomic, so parallel guesses can't share one attempt.
      if (user?.otpHash)
        await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: { increment: 1 } } });
      return res.status(400).json({ error: "INVALID_CODE", message: "That code is wrong or has expired." });
    }

    const verified = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, otpHash: null, otpExpires: null, otpAttempts: 0, otpSentAt: null },
    });
    return res.json({ token: signToken(verified), user: publicUser(verified) });
  } catch (error) {
    console.error("Verify email error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Could not verify email." });
  }
});

// POST /api/auth/resend-code  { email } — same answer for every email so it can't probe accounts
router.post("/resend-code", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: readEmail(req) } });
    if (user && !user.emailVerified && canResend(user)) await sendOtp(user);
    return res.json({ message: "If that account still needs verifying, a new code is on its way." });
  } catch (error) {
    console.error("Resend code error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Could not send a new code." });
  }
});

// GET /api/auth/me — profile + today's usage
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: "AUTH_REQUIRED" });
    const usage = await getUsage({ user, ip: req.ip });
    return res.json({ user: publicUser(user), usage });
  } catch (error) {
    console.error("Me error:", error);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

export default router;
