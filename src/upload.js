import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { Router } from "express";
import { ingestFile } from "./ingestFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// RISK: Railway (and most container platforms) have an ephemeral filesystem.
// The uploads/ directory and its contents are lost on every redeploy or
// restart. This is intentional — temp files are deleted after ingestion —
// but the directory itself must be re-created on each boot. We do that here
// at module load time rather than lazily, so multer never races against a
// missing destination.
const UPLOAD_DIR = path.resolve(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- Multer configuration ---

const ALLOWED_MIME_TYPES = new Set(["application/pdf", "text/plain"]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Prefix with timestamp to avoid collisions if two uploads share a filename.
    // RISK: still not collision-proof under extreme concurrency; a UUID would be
    // safer if this endpoint ever sees high parallel traffic.
    const unique = `${Date.now()}-${file.originalname}`;
    cb(null, unique);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    // Reject before the file lands on disk.
    cb(Object.assign(new Error("Only .pdf and .txt files are accepted."), { status: 400 }), false);
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_BYTES } });

// --- API key middleware ---

function requireApiKey(req, res, next) {
  const apiKey = process.env.KESSEL_API_KEY;

  // RISK: if KESSEL_API_KEY is not set, the check is skipped entirely and the
  // endpoint is open. Fail closed instead of open if that's ever a concern —
  // replace the guard below with: if (!apiKey) return res.status(500)...
  if (!apiKey) {
    console.warn("KESSEL_API_KEY is not set — /upload is unprotected.");
    return next();
  }

  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token !== apiKey) {
    return res.status(401).json({ error: "Invalid or missing API key." });
  }

  next();
}

// --- Router ---

const router = Router();

router.post(
  "/upload",
  requireApiKey,
  (req, res, next) => {
    // Run multer as middleware so we can return structured JSON errors rather
    // than letting multer's default error handler send plain text.
    upload.single("file")(req, res, (err) => {
      if (!err) return next();

      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: `File exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB limit.` });
      }

      const status = err.status ?? 400;
      return res.status(status).json({ error: err.message });
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Send a file in the 'file' field." });
    }

    const tempPath = req.file.path;

    try {
      // ingestFile appends to the on-disk index. The caller (index.js) is
      // responsible for rebuilding the chain so the running server picks up the
      // new vectors without a restart.
      const chunksAdded = await ingestFile(tempPath, req.file.mimetype);

      // Signal index.js to hot-swap the chain.
      req.app.emit("vectorStoreUpdated");

      return res.json({
        success: true,
        filename: req.file.originalname,
        chunksAdded,
      });
    } catch (err) {
      console.error("Ingestion error:", err);
      return res.status(500).json({ error: "Ingestion failed: " + err.message });
    } finally {
      // Always delete the temp file, whether ingestion succeeded or failed.
      fs.unlink(tempPath, (unlinkErr) => {
        if (unlinkErr) console.error("Failed to clean up temp file:", unlinkErr.message);
      });
    }
  }
);

export default router;
