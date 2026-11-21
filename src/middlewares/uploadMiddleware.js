import multer from "multer";
import fs from "fs";
import { TIERS } from "../config/tiers.js";

const uploadDir = "uploads/";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const cleanName = file.originalname.replace(/\s+/g, "_");
    cb(null, `${uniqueSuffix}-${cleanName}`);
  },
});

// multer's fileSize limit is fixed per instance, so pre-build one per tier and
// pick the right one at request time based on whether the user is logged in.
const makeUploader = (maxBytes) => multer({ storage, limits: { fileSize: maxBytes } });
const uploaders = {
  GUEST: makeUploader(TIERS.GUEST.maxUploadBytes),
  FREE: makeUploader(TIERS.FREE.maxUploadBytes),
};

const mb = (bytes) => Math.round(bytes / (1024 * 1024));

// Run a multer middleware and translate its errors into friendly JSON instead
// of an unhandled 500.
const run = (mw, req, res, next) =>
  mw(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        const max = (req.user ? TIERS.FREE : TIERS.GUEST).maxUploadBytes;
        return res.status(413).json({
          error: "FILE_TOO_LARGE",
          message: `File too large. Max ${mb(max)}MB${req.user ? "" : " for guests — sign up free for 100MB"}.`,
        });
      }
      return res.status(400).json({ error: err.code, message: "Upload failed." });
    }
    if (err) return next(err);
    next();
  });

// Tier-aware multipart upload. Requires optionalAuth to have run first.
export const tierUpload = (fields) => (req, res, next) =>
  run(uploaders[req.user ? "FREE" : "GUEST"].fields(fields), req, res, next);
