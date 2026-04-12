/**
 * Shared API key middleware.
 * Reused by /upload, GET /documents, and DELETE /documents/:filename.
 */
export function requireApiKey(req, res, next) {
  const apiKey = process.env.KESSEL_API_KEY;

  // RISK: if KESSEL_API_KEY is not set, the check is skipped entirely and the
  // endpoint is open. Fail closed instead of open if that's ever a concern —
  // replace the guard below with: if (!apiKey) return res.status(500)...
  if (!apiKey) {
    console.warn("KESSEL_API_KEY is not set — endpoint is unprotected.");
    return next();
  }

  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token !== apiKey) {
    return res.status(401).json({ error: "Invalid or missing API key." });
  }

  next();
}
