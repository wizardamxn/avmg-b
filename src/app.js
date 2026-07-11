import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import avmgRoutes from "./routes/avmg.js";
import authRoutes from "./routes/auth.js";

const app = express();
app.disable("x-powered-by");

// nginx fronts this in prod — trust it so req.ip is the real client IP
// (used for guest quotas and rate limiting).
app.set("trust proxy", 1);

// CORS allowlist. Auth uses a Bearer header (not cookies), so no credentials.
// localhost:3000 is always allowed for local dev.
const allowedOrigins = [process.env.FRONTEND_ORIGIN, "http://localhost:3000"].filter(Boolean);
app.use(cors({ origin: allowedOrigins }));

app.use(express.json());

// Blanket rate limit; auth gets a tighter one to slow credential stuffing.
app.use(
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }),
);
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Mounted under /api so it matches the public path (nginx forwards
// https://<domain>/api/* to this backend).
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api", avmgRoutes);

export default app;
