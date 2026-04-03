import "dotenv/config";
import express from "express";
import cors from "cors";
import { buildChain } from "./chain.js";

const app = express();
app.use(cors());
app.use(express.json());

let chain;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", ready: !!chain });
});

app.post("/ask", async (req, res) => {
  const { question } = req.body ?? {};

  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "'question' is required and must be a non-empty string." });
  }

  try {
    const result = await chain.invoke({ input: question.trim() });
    res.json({ answer: result.answer });
  } catch (err) {
    console.error("Chain error:", err);
    res.status(500).json({ error: "Failed to generate an answer." });
  }
});

const PORT = process.env.PORT ?? 3000;

async function start() {
  console.log("Connecting to vector store and building chain...");
  try {
    chain = await buildChain();
    console.log("Chain ready.");
  } catch (err) {
    console.error("Failed to build chain:", err.message);
    console.error("Make sure Chroma is running and you have run `npm run ingest` first.");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Kessel listening on http://localhost:${PORT}`);
    console.log("  POST /ask  { \"question\": \"...\" }");
    console.log("  GET  /health");
  });
}

start();
