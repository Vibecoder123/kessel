import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";
import { createClient } from "@supabase/supabase-js";

export function getEmbeddings() {
  return new VoyageEmbeddings({
    apiKey: process.env.VOYAGE_API_KEY,
    modelName: "voyage-3",
  });
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

export async function getVectorStore(userId) {
  const client = getSupabaseClient();
  return new SupabaseVectorStore(getEmbeddings(), {
    client,
    tableName: "documents",
    queryName: "match_documents",
    // filter removed — single tenant pilot, all docs shared
  });
}

export async function saveVectorStore(store, userId) {
  // No-op: SupabaseVectorStore writes directly to the database on addDocuments.
  // This function is kept so callers don't need to change.
}
