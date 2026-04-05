import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const INDEX_FILE = path.resolve(
  process.env.INDEX_PATH ?? path.join(__dirname, "..", "data", "index.json")
);

const BACKUP_FILE = INDEX_FILE + ".bak";

export function getEmbeddings() {
  return new VoyageEmbeddings({
    apiKey: process.env.VOYAGE_API_KEY,
    modelName: "voyage-3",
  });
}

export async function saveVectorStore(store) {
  await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });

  const tmpFile = INDEX_FILE + ".tmp";
  const data = JSON.stringify(store.memoryVectors);

  await fs.writeFile(tmpFile, data, "utf-8");

  try {
    await fs.copyFile(INDEX_FILE, BACKUP_FILE);
  } catch {
    // No existing index to back up — that's fine
  }

  await fs.rename(tmpFile, INDEX_FILE);
}

export async function getVectorStore() {
  let raw;
  try {
    raw = await fs.readFile(INDEX_FILE, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `Index file not found at ${INDEX_FILE}. Run "npm run ingest" first.`
      );
    }
    throw err;
  }

  let vectors;
  try {
    vectors = JSON.parse(raw);
  } catch {
    throw new Error(
      `Index file at ${INDEX_FILE} is corrupted. Delete it and run "npm run ingest" to rebuild.`
    );
  }

  const store = new MemoryVectorStore(getEmbeddings());
  store.memoryVectors = vectors;
  return store;
}
