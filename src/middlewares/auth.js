import jwt from "jsonwebtoken";

// Sets req.user from a Bearer token when present and valid; otherwise leaves
// req.user null and proceeds. A bad/expired token never errors here — tool
// endpoints must keep working for guests.
export const optionalAuth = (req, _res, next) => {
  req.user = null;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      req.user = { id: payload.sub, email: payload.email };
    } catch {
      // ignore — treat as guest
    }
  }
  next();
};

// Requires a valid token; 401s guests. Only account-only endpoints use this.
export const requireAuth = (req, res, next) =>
  optionalAuth(req, res, () =>
    req.user
      ? next()
      : res.status(401).json({ error: "AUTH_REQUIRED", message: "Please log in." }),
  );
