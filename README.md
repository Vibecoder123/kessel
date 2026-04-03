# Kessel

AI-powered private knowledge base chatbot. Ask natural language questions against your own documents — answers are grounded strictly in your content, and source documents are never exposed to callers.

## How it works

Kessel uses a **Retrieval-Augmented Generation (RAG)** pipeline:

```
docs/ (your .txt / .md files)
        │
        ▼
   [npm run ingest]
        │  splits into ~1000-char chunks
        │  embeds each chunk via Voyage AI (voyage-3)
        │  saves vectors to data/index.json
        ▼
   data/index.json  (persisted MemoryVectorStore)
        │
        ▼
   [npm start]
        │  loads vectors into memory (no API calls at startup)
        │  builds a LangChain retrieval chain backed by Claude
        ▼
   POST /ask  {"question": "..."}
        │  embeds the question
        │  retrieves top-4 most similar chunks
        │  passes chunks + question to Claude (claude-sonnet-4-6)
        │  returns synthesised answer — no source text leaked
        ▼
   {"answer": "..."}
```

**Ingestion** is a one-time (or on-change) step. **Querying** uses the pre-built index, so no embedding calls happen at request time beyond the single question embedding.

## Setup

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- A [Voyage AI API key](https://dash.voyageai.com/)

### Install

```bash
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY and VOYAGE_API_KEY in .env
```

### Add your documents

Place `.txt` or `.md` files in the `docs/` directory.

### Ingest

```bash
npm run ingest
```

This embeds all documents and writes the vector index to `data/index.json`. Re-run whenever your documents change.

### Start the server

```bash
npm start
```

The server starts on `http://localhost:3000` (override with `PORT=` in `.env`).

## API

### `POST /ask`

Ask a question against the indexed documents.

**Request**
```json
{ "question": "What is the refund policy?" }
```

**Response**
```json
{ "answer": "According to the documentation, ..." }
```

Returns `400` if `question` is missing or empty. Returns `500` if the chain fails.

### `GET /health`

```json
{ "status": "ok", "ready": true }
```

`ready: false` means the chain has not finished initialising yet.

## Configuration

| Variable          | Default              | Description                          |
|-------------------|----------------------|--------------------------------------|
| `ANTHROPIC_API_KEY` | —                  | Required. Anthropic API key.         |
| `VOYAGE_API_KEY`  | —                    | Required. Voyage AI API key.         |
| `INDEX_PATH`      | `data/index.json`    | Path to the persisted vector index.  |
| `PORT`            | `3000`               | HTTP port the server listens on.     |

## Tech stack

| Layer         | Technology                        |
|---------------|-----------------------------------|
| API server    | Express                           |
| RAG framework | LangChain                         |
| Embeddings    | Voyage AI (`voyage-3`)            |
| Vector store  | LangChain `MemoryVectorStore` (JSON file) |
| LLM           | Anthropic Claude (`claude-sonnet-4-6`) |
