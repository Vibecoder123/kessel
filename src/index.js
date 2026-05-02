import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { getChain, invalidateChain } from "./chain.js";
import { checkRestriction } from "./restrictions.js";
import uploadRouter from "./upload.js";
import { requireApiKey } from "./auth.js";
import { requireAuth } from "./middleware/auth.js";
import { getVectorStore, saveVectorStore } from "./vectorstore.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(uploadRouter);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

let chain;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/ask", requireAuth, async (req, res) => {
  const { question } = req.body ?? {};
  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "'question' is required and must be a non-empty string." });
  }
  try {
    if (!chain) chain = await getChain("admin");
    const result = await chain.invoke({ input: question.trim() });
    const answer = result.answer;

    // Log to Supabase — fire and forget, never blocks the response
    supabase.from("query_logs").insert({ question: question.trim(), answer }).then(({ error }) => {
      if (error) console.error("Logging error:", error.message);
    });

const restriction = checkRestriction(question);

    if (restriction.restricted) {
      return res.json({
        answer,
        restricted: true,
        restrictionLabel: restriction.label,
        contactUrl: restriction.contactUrl
      });
    }

    return res.json({ answer, restricted: false });   
 
  } catch (err) {
    console.error("Chain error:", err);
    res.status(500).json({ error: "Failed to generate an answer." });
  }
});
app.post("/api/chat", requireApiKey, async (req, res) => {
  const { question } = req.body ?? {};
  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "'question' is required and must be a non-empty string." });
  }
 
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
 
  try {
    if (!chain) chain = await getChain("admin");
 
    const stream = await chain.stream({ input: question.trim() });
 
    for await (const chunk of stream) {
      // createRetrievalChain emits chunks with an `answer` key as text accumulates
      if (chunk.answer) {
        res.write(`data: ${JSON.stringify({ token: chunk.answer })}\n\n`);
      }
    }
 
    res.write("data: [DONE]\n\n");
    res.end();
 
    // Log to Supabase after stream completes — fire and forget
    // Full answer not available mid-stream; log the question only for now
    supabase.from("query_logs").insert({ question: question.trim(), answer: "[streamed]" }).then(({ error }) => {
      if (error) console.error("Logging error:", error.message);
    });
 
  } catch (err) {
    console.error("/api/chat stream error:", err);
    res.write(`data: ${JSON.stringify({ error: "Failed to generate an answer." })}\n\n`);
    res.end();
  }
});

app.get("/documents", requireApiKey, async (_req, res) => {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await client
      .from("documents")
      .select("metadata");
    if (error) throw new Error(error.message);
    const counts = {};
    for (const row of data) {
      const source = row.metadata?.source ?? "(unknown)";
      counts[source] = (counts[source] ?? 0) + 1;
    }
    const documents = Object.keys(counts)
      .sort()
      .map((filename) => ({ filename, chunks: counts[filename] }));
    return res.json({ documents });
  } catch (err) {
    console.error("GET /documents error:", err);
    return res.status(500).json({ error: err.message });
  }
});
app.delete("/documents/:filename", requireApiKey, async (req, res) => {
  const { filename } = req.params;

  if (filename.includes("/") || filename.includes("..")) {
    return res.status(400).json({ error: "Invalid filename." });
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error, count } = await client
      .from("documents")
      .delete({ count: "exact" })
      .eq("metadata->>source", filename);
    if (error) throw new Error(error.message);
    if (count === 0) {
      return res.status(404).json({ error: `No chunks found for '${filename}'.` });
    }
    req.app.emit("vectorStoreUpdated", "admin");
    return res.json({ success: true, filename, chunksRemoved: count });
  } catch (err) {
    console.error("DELETE /documents error:", err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT ?? 3000;
app.on("vectorStoreUpdated", (userId) => {
  invalidateChain(userId);
  chain = null;
});

async function start() {

  app.listen(PORT, () => {
    console.log(`Kessel listening on http://localhost:${PORT}`);
    console.log('  POST /ask  { "question": "..." }');
    console.log('  POST /upload  (multipart/form-data, field: "file")');
    console.log("  GET  /health");
  });
}

start();
