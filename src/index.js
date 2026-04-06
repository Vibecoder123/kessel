import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { buildChain } from "./chain.js";
import { checkRestriction } from "./restrictions.js";

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

const PORT = process.env.PORT ?? 3000;

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
    console.log("  GET  /health");
  });
}

start();
