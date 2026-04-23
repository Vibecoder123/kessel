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
  res.json({ status: "ok", ready: !!chain });
});

app.post("/ask", requireAuth, async (req, res) => {
  const { question } = req.body ?? {};
  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "'question' is required and must be a non-empty string." });
  }
  try {
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

app.get("/documents", requireApiKey, async (_req, res) => {
  try {
    const store = await getVectorStore(req.userId);
    const counts = {};
    for (const v of store.memoryVectors) {
      const source = v.metadata?.source ?? "(unknown)";
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
    const store = await getVectorStore();
    const before = store.memoryVectors.length;
    store.memoryVectors = store.memoryVectors.filter(
      (v) => v.metadata?.source !== filename
    );
    const removed = before - store.memoryVectors.length;

    if (removed === 0) {
      return res.status(404).json({ error: `No chunks found for '${filename}'.` });
    }

    await saveVectorStore(store, req.userId);
    req.app.emit("vectorStoreUpdated", req.userId);

    return res.json({ success: true, filename, chunksRemoved: removed });
  } catch (err) {
    console.error("DELETE /documents error:", err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT ?? 3000;

// Hot-swap the chain after a successful /upload so new vectors are immediately
// searchable without a server restart.
// RISK: buildChain() re-reads the full index.json into a new MemoryVectorStore.
// For a very large index this rebuild will take time and consume extra memory
// transiently. No requests are blocked during the swap, but the window between
// ingestFile() writing and the new chain being assigned means a query arriving
// in that gap will still use the old chain.
app.on("vectorStoreUpdated", async () => {
  console.log("Vector store updated — rebuilding chain...");
  try {
    chain = await buildChain();
    console.log("Chain rebuilt successfully.");
  } catch (err) {
    console.error("Failed to rebuild chain after upload:", err.message);
    // The old chain stays active. The server remains up but won't surface the
    // newly uploaded documents until the next successful rebuild or restart.
  }
});

async function start() {
  console.log("Connecting to vector store and building chain...");
  try {
    chain = await buildChain();
    console.log("Chain ready.");
  } catch (err) {
    console.error("Failed to build chain:", err.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Kessel listening on http://localhost:${PORT}`);
    console.log('  POST /ask  { "question": "..." }');
    console.log('  POST /upload  (multipart/form-data, field: "file")');
    console.log("  GET  /health");
  });
}

start();
