import path from "path";
import os from "os";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getVectorStore, saveVectorStore } from "./vectorstore.js";
import Tesseract from "tesseract.js";

const execFileAsync = promisify(execFile);

// Chunk settings match src/ingest.js so all content is indexed consistently.
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

// Pages with fewer characters than this are treated as image-only and OCR'd.
const MIN_TEXT_THRESHOLD = 10;

/**
 * Renders all pages of a PDF to PNG files in tmpDir using pdftoppm and
 * returns the sorted list of absolute file paths.
 *
 * @param {string} filePath  Path to the PDF.
 * @param {string} tmpDir    Directory to write PNG files into.
 * @returns {Promise<string[]>} Sorted PNG file paths, one per page.
 */
async function renderPagesToPng(filePath, tmpDir) {
  await execFileAsync("pdftoppm", ["-r", "300", "-png", filePath, path.join(tmpDir, "page")]);
  const files = await fs.readdir(tmpDir);
  return files
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => path.join(tmpDir, f));
}

/**
 * Loads a PDF and returns one Document per page, falling back to OCR via
 * pdftoppm + tesseract for any page (or the whole file) that has no
 * extractable text.
 *
 * Handles two cases:
 *  - Fully image-based PDFs: PDFLoader returns 0 docs → render + OCR all pages.
 *  - Mixed PDFs: some pages have text, others don't → OCR only the empty ones.
 *
 * @param {string} filePath
 * @returns {Promise<Document[]>}
 */
async function loadPdfDocs(filePath) {
  const loader = new PDFLoader(filePath);
  let docs = await loader.load();

  const emptyPages = docs.filter((d) => d.pageContent.trim().length < MIN_TEXT_THRESHOLD);
  const needsOcr = docs.length === 0 || emptyPages.length > 0;
  if (!needsOcr) return docs;

  // Check if pdftoppm is available
  let pdftoppmAvailable = true;
  try {
    await execFileAsync("pdftoppm", ["-v"]);
  } catch (e) {
    if (e.code === "ENOENT") pdftoppmAvailable = false;
  }

  if (!pdftoppmAvailable) {
    return docs.filter((d) => d.pageContent.trim().length > 0);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kessel-ocr-"));
  try {
    const pngFiles = await renderPagesToPng(filePath, tmpDir);

    if (docs.length === 0) {
      // Fully image-based PDF: build a Document for every rendered page.
      const ocrDocs = [];
      for (let i = 0; i < pngFiles.length; i++) {
        const { data: { text } } = await Tesseract.recognize(pngFiles[i], "eng", { logger: () => {} });
        if (text.trim().length > 0) {
          ocrDocs.push(new Document({
            pageContent: text,
            metadata: { page: i, loc: { pageNumber: i + 1 } },
          }));
        }
      }
      return ocrDocs;
    }

    // Mixed PDF: OCR only the pages that came back empty.
    // pngFiles[i] corresponds to page i+1; align by page number.
    for (const doc of emptyPages) {
      const pageNum = doc.metadata.loc?.pageNumber ?? (doc.metadata.page ?? 0) + 1;
      const png = pngFiles[pageNum - 1];
      if (!png) continue;
      const { data: { text } } = await Tesseract.recognize(png, "eng", { logger: () => {} });
      doc.pageContent = text;
    }

    // Drop pages that yielded no text even after OCR (e.g. blank separator pages).
    return docs.filter((d) => d.pageContent.trim().length > 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Loads a single file, chunks it, embeds it, and appends the vectors to the
 * existing index — without wiping documents that are already there.
 *
 * @param {string} filePath  Absolute path to the file on disk.
 * @param {string} mimeType  "application/pdf" | "text/plain"
 * @returns {Promise<number>} Number of chunks added.
 */
export async function ingestFile(filePath, mimeType, userId) {
  // --- Load ---
  let docs;
  if (mimeType === "application/pdf") {
    docs = await loadPdfDocs(filePath);
  } else {
    // text/plain — covers both .txt uploads and any future plain-text types.
    const loader = new TextLoader(filePath);
    docs = await loader.load();
  }

  // --- Chunk ---
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const chunks = await splitter.splitDocuments(docs);

  if (chunks.length === 0) {
    throw new Error("File produced no chunks after splitting — it may be empty.");
  }

  // --- Stamp source filename, page count and file size onto every chunk ---
  const stat = await fs.stat(filePath);
  const fileSize = stat.size;
  const pageCount = docs.length;
  const basename = path.basename(filePath);
  for (const chunk of chunks) {
    chunk.metadata.source = basename;
    chunk.metadata.fileSize = fileSize;
    chunk.metadata.pageCount = pageCount;
  }

  // --- Append to existing store ---
  //
  // RISK: no file lock around the read-modify-write below.
  // If two /upload requests arrive concurrently, both read the same index.json,
  // each appends their own chunks to an independent in-memory copy, and the
  // second saveVectorStore call overwrites the first's additions.
  // Acceptable for a low-traffic internal tool; add a queue/mutex here if
  // concurrent uploads become a real use case.
  // Chunks are embedded in batches of 50 with a 1-second pause between batches
  // to stay within Voyage AI's free-tier per-minute token cap.
  // saveVectorStore is called once after all batches complete — not per batch.
  // Filter out chunks with no usable text before embedding.
  // PDFs with font encoding issues (cmap warnings) can produce empty or
  // whitespace-only chunks that cause Voyage to return an unexpected response,
  // crashing the LangChain client when it tries to read embeddings from it.
  const MIN_CHUNK_LENGTH = 20;
  const usableChunks = chunks.filter(
    (c) => c.pageContent && c.pageContent.trim().length >= MIN_CHUNK_LENGTH
  );
  if (usableChunks.length === 0) {
    throw new Error("File produced no usable chunks after filtering — content may be empty or unreadable.");
  }

  const BATCH_SIZE = 50;
  const store = await getVectorStore(userId);
  for (let i = 0; i < usableChunks.length; i += BATCH_SIZE) {
    const batch = usableChunks.slice(i, i + BATCH_SIZE);
    await store.addDocuments(batch);
    if (i + BATCH_SIZE < usableChunks.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await saveVectorStore(store, userId);

  return chunks.length;
}
