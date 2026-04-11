import { TextLoader } from "langchain/document_loaders/fs/text";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getVectorStore, saveVectorStore } from "./vectorstore.js";

// Chunk settings match src/ingest.js so all content is indexed consistently.
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Loads a single file, chunks it, embeds it, and appends the vectors to the
 * existing index — without wiping documents that are already there.
 *
 * @param {string} filePath  Absolute path to the file on disk.
 * @param {string} mimeType  "application/pdf" | "text/plain"
 * @returns {Promise<number>} Number of chunks added.
 */
export async function ingestFile(filePath, mimeType) {
  // --- Load ---
  let loader;
  if (mimeType === "application/pdf") {
    loader = new PDFLoader(filePath);
  } else {
    // text/plain — covers both .txt uploads and any future plain-text types.
    loader = new TextLoader(filePath);
  }

  const docs = await loader.load();

  // --- Chunk ---
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const chunks = await splitter.splitDocuments(docs);

  if (chunks.length === 0) {
    throw new Error("File produced no chunks after splitting — it may be empty.");
  }

  // --- Append to existing store ---
  //
  // RISK: no file lock around the read-modify-write below.
  // If two /upload requests arrive concurrently, both read the same index.json,
  // each appends their own chunks to an independent in-memory copy, and the
  // second saveVectorStore call overwrites the first's additions.
  // Acceptable for a low-traffic internal tool; add a queue/mutex here if
  // concurrent uploads become a real use case.
  const store = await getVectorStore();
  await store.addDocuments(chunks);
  await saveVectorStore(store);

  return chunks.length;
}
