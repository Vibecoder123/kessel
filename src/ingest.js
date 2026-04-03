import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { getEmbeddings, saveVectorStore, INDEX_FILE } from "./vectorstore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, "..", "docs");

async function ingest() {
  console.log(`Loading documents from ${DOCS_DIR} ...`);

  const loader = new DirectoryLoader(DOCS_DIR, {
    ".txt": (p) => new TextLoader(p),
    ".md": (p) => new TextLoader(p),
  });

  const docs = await loader.load();

  if (docs.length === 0) {
    console.error("No .txt or .md files found in docs/. Add documents and re-run.");
    process.exit(1);
  }

  console.log(`Loaded ${docs.length} file(s).`);

  // Chunk documents so each embedding covers a coherent passage.
  // chunkSize=1000 chars ≈ ~200 tokens; overlap preserves sentence context at boundaries.
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await splitter.splitDocuments(docs);
  console.log(`Split into ${chunks.length} chunk(s).`);

  console.log(`Embedding chunks and saving index to ${INDEX_FILE} ...`);

  const vectorStore = await MemoryVectorStore.fromDocuments(chunks, getEmbeddings());
  await saveVectorStore(vectorStore);

  console.log("Done. Index saved and ready.");
}

ingest().catch((err) => {
  console.error("Ingestion failed:", err.message);
  process.exit(1);
});
