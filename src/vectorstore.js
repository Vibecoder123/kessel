import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the persisted vector index (plain JSON — no native deps required).
export const INDEX_FILE = path.resolve(
  process.env.INDEX_PATH ?? path.join(__dirname, "..", "data", "index.json")
);

export function getEmbeddings() {
  return new VoyageEmbeddings({
    apiKey: process.env.VOYAGE_API_KEY,
    modelName: "voyage-3",
  });
}

// Serialise a MemoryVectorStore to disk.
export async function saveVectorStore(store) {
  await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(store.memoryVectors));
}

// Deserialise the stored vectors back into a MemoryVectorStore.
// Vectors are already embedded — no API calls needed at load time.
export async function getVectorStore() {
  const raw = await fs.readFile(INDEX_FILE, "utf-8");
  const store = new MemoryVectorStore(getEmbeddings());
  store.memoryVectors = JSON.parse(raw);
  return store;
}
