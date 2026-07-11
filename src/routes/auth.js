import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";
import { getUsage } from "../lib/usage.js";

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const name = req.body.name ? String(req.body.name).trim() : null;

    if (!EMAIL_RE.test(email))
      return res.status(400).json({ error: "INVALID_EMAIL", message: "Enter a valid email." });
    if (password.length < 8)
      return res.status(400).json({ error: "WEAK_PASSWORD", message: "Password must be at least 8 characters." });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      return res.status(409).json({ error: "EMAIL_TAKEN", message: "That email is already registered." });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, name, passwordHash } });

    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Could not create account." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = await prisma.user.findUnique({ where: { email } });
    // Same message whether the email is unknown or the password is wrong.
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok)
      return res.status(401).json({ error: "BAD_CREDENTIALS", message: "Wrong email or password." });

    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Could not log in." });
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
