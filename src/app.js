import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import avmgRoutes from "./routes/avmg.js";
import authRoutes from "./routes/auth.js";

const app = express();
app.disable("x-powered-by");

// How many proxy hops to trust when reading X-Forwarded-For — this is what
// req.ip resolves to, and req.ip drives guest quotas and rate limiting.
// Set too HIGH, a client can forge X-Forwarded-For and dodge both. Set too LOW,
// every request appears to come from the proxy and all guests collapse into a
// single bucket. The correct number is environment-specific: 2 behind the prod
// nginx + CDN, but 0 in plain compose where nothing fronts the container.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 2));

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
