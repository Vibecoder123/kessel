import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";
import { createRequire } from "module";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const INDEX_FILE = path.resolve(
  process.env.INDEX_PATH ?? path.join(__dirname, "..", "data", "index.json")
);

function getIndexPath(userId) {
  if (!userId) return INDEX_FILE;
  return path.resolve(path.join(__dirname, "..", "data", userId, "index.json"));
}

export function getEmbeddings() {
  return new VoyageEmbeddings({
    apiKey: process.env.VOYAGE_API_KEY,
    modelName: "voyage-3",
  });
}

export async function saveVectorStore(store, userId) {
  const indexFile = getIndexPath(userId);
  await fs.mkdir(path.dirname(indexFile), { recursive: true });

  const tmpFile = indexFile + ".tmp";
  const data = JSON.stringify(store.memoryVectors);

  await fs.writeFile(tmpFile, data, "utf-8");

  try {
    await fs.copyFile(indexFile, indexFile + ".bak");
  } catch {
    // No existing index to back up — that's fine
  }

  await fs.rename(tmpFile, indexFile);
}

export async function getVectorStore(userId) {
  const indexFile = getIndexPath(userId);
  let raw;
  try {
    raw = await fs.readFile(indexFile, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
  return new MemoryVectorStore(getEmbeddings());
    }
    throw err;
  }

  let vectors;
  try {
    vectors = JSON.parse(raw);
  } catch {
    throw new Error(
      `Index file at ${indexFile} is corrupted. Delete it and run "npm run ingest" to rebuild.`
    );
  }

  const embeddings = getEmbeddings();
  const store = new MemoryVectorStore(embeddings);
  store.memoryVectors = vectors;
  return store;
}
