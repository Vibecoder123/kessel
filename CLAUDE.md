# CLAUDE.md — Kessel

This file provides project context, environment constraints, and session rules for Claude Code. Read this before every session.

---

## What is Kessel?

Kessel is a sales copilot web app. It pulls instant, accurate answers from a structured knowledge base — designed for sales reps who need technical answers fast, without searching through docs.

---

## Stack

| Layer | Technology | URL / Reference |
|---|---|---|
| Frontend | React (Vite/TS, Cloudflare Pages) | askkessel.com |
| Backend | Node.js / Express | kessel-production-16c5.up.railway.app |
| Database / Auth | Supabase | — |
| Hosting (backend) | Railway | — |
| Hosting (frontend) | Lovable / GitHub | github.com/Vibecoder123/kessel |
| Vector store | MemoryVectorStore (LangChain) | — |
| LLM | Claude (Anthropic) | via API |

---

## Environment Constraints — Read Before Proposing Dependencies

Railway runs a **containerised Linux environment**. The following are known constraints:

- **No GraphicsMagick** — do not use `gm`, `pdf2pic`, or any library that shells out to GraphicsMagick
- **No native compilers** — avoid packages requiring node-gyp, native bindings, or compiled C/C++ extensions
- **PDF processing** — use `pdftoppm` (available) or pure-JS alternatives; do NOT use `pdf2pic`
- **Vector store** — use `MemoryVectorStore` from LangChain; do NOT use HNSWLib (requires native binaries)
- **File system** — Railway has ephemeral storage; `data/index.json` is used for vector store persistence but will not survive a Railway redeploy. Be aware of this when making changes to ingestion logic.

**Before proposing any new dependency, confirm it is pure JavaScript / does not require system binaries.**

---

## Repo Structure

### kessel/ (backend — deployed to Railway)
```
src/
├── index.js          # Entry point
├── auth.js           # Auth middleware
├── chain.js          # RAG chain (LangChain)
├── ingest.js         # Document ingestion
├── ingestFile.js     # File ingestion handler (+ .bak backup exists)
├── upload.js         # Upload handling
├── vectorstore.js    # Vector store setup (MemoryVectorStore)
└── restrictions.js   # Query restrictions
config/
└── restrictions.json
data/
└── index.json        # Vector store persistence
```

### kessel-frontend/ (frontend — deployed to Cloudflare Pages)
```
src/
├── pages/
│   ├── Index.tsx
│   ├── Landing.tsx
│   ├── Admin.tsx
│   ├── NotFound.tsx
│   └── admin/
│       ├── AdminLogin.tsx
│       └── DocumentList.tsx
└── components/ui/    # shadcn/ui component set
functions/
└── upload-proxy.js   # Cloudflare Pages Function (active)
netlify/functions/
└── upload-proxy.js   # Legacy Netlify version (inactive — do not modify)
```

**Note:** The active upload proxy is `functions/upload-proxy.js` (Cloudflare). The `netlify/functions/` version is legacy — do not touch it.

---

## Key Endpoints (current)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat` | Main RAG query — retrieves context, calls Claude |
| POST | `/api/documents/upload` | Upload PDF/text into knowledge base |
| GET | `/api/documents` | List ingested documents |
| DELETE | `/api/documents/:id` | Remove document from knowledge base |

---

## Session Rules

1. **Validate the environment before writing feature code.** At the start of any session involving new dependencies or file processing, confirm available system tools and Node version before proceeding.
2. **Check whether a file exists before proposing to create it.** Use `ls` or `cat` to verify. Do not assume the repo is in a blank state.
3. **Do not run commands before the plan is confirmed.** Propose the approach, wait for explicit approval, then execute.
4. **One concern per prompt.** Do not combine unrelated changes in a single edit pass — it causes regressions.
5. **Prefer in-memory and pure-JS solutions** given Railway's constrained environment.

---

## Phase 2 — Planned Features (not yet built)

- Admin panel — document management UI
- Document upload via frontend
- Embeddable widget — deployable on third-party sites
- Auth layer for multi-tenant access

Do not scaffold Phase 2 features without explicit instruction.

---

## Branding Reference (for any frontend-touching work)

| Token | Value |
|---|---|
| Display font | Syne |
| Body font | Inter |
| Mono font | DM Mono |
| Primary accent | `#00E5FF` |
| Secondary accent | `#00B8D9` |
| Background | Dark navy ~`#0D1B2E` |
