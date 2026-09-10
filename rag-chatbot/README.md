# Multi-PDF RAG Chatbot

Upload up to 50 PDFs per session and ask grounded, cited questions across them.

## Architecture

```
PDF upload → PyMuPDF text extraction (per-page, error-tolerant)
           → word-bounded chunking (~600 words, 90-word overlap), page metadata attached
           → SHA-256 content hash dedup → skip re-parsing/re-embedding unchanged files
           → sentence-transformers embeddings (batched, cached by chunk hash)
           → ChromaDB (per-session collection, cosine similarity)

Chat query → embed query → Top-K retrieval (optionally scoped to selected docs)
           → grounded prompt (context + citation instructions) → streamed LLM response (SSE)
           → citations (filename + page) shown alongside the answer
```

Backend: FastAPI. Frontend: React + Vite. Vector DB: ChromaDB (local, persistent).
Embeddings: `sentence-transformers` (local, free). LLM: switchable — local Ollama
or Anthropic/OpenAI API, chosen per-request from the UI.

## Why this design meets the requirements

- **50-PDF sessions**: each browser session gets its own Chroma collection; a
  server-side count check rejects uploads that would exceed the 50-file cap.
- **Corrupted PDFs**: `pdf_processor.py` never raises — a bad file returns a
  per-file error in the upload response while the rest of the batch still processes.
- **No reprocessing**: files are hashed (SHA-256) on upload. A processed-file
  registry (SQLite) and a chunk-level embedding cache mean re-uploading an
  unchanged file (even across sessions) reuses existing chunks/vectors instead
  of re-parsing or re-embedding.
- **Multi-doc synthesis**: retrieval can run unscoped (across all uploaded docs)
  or scoped to a subset the user selects in the sidebar; every retrieved chunk
  carries its source filename + page number end-to-end into the prompt and the
  citation UI.
- **No hallucination**: the system prompt instructs the model to answer only
  from retrieved context and say so explicitly when the answer isn't there;
  citations are generated from what was *actually retrieved*, not invented
  after the fact.
- **Follow-ups**: recent chat history is included in the prompt so the model
  can resolve references like "what about page 5?".
- **Performance**: file processing runs in a thread pool (concurrent across an
  upload batch), embeddings are batched (not one-at-a-time), and the LLM
  response streams token-by-token over SSE so latency to first output is low.

## Setup

### Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

Choose an LLM backend by setting environment variables (or a `.env` file):

```bash
# Option A: local, free (requires Ollama running: https://ollama.com)
export LLM_BACKEND=ollama
export OLLAMA_MODEL=llama3.1:8b   # ollama pull llama3.1:8b first

# Option B: Anthropic API
export LLM_BACKEND=anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Option C: OpenAI API
export LLM_BACKEND=openai
export OPENAI_API_KEY=sk-...
```

This is just the *default* — the frontend also lets you pick the backend
per-request via a dropdown, as long as the corresponding server env var/key is set.

Run:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

First run will download the embedding model (`BAAI/bge-small-en-v1.5`, ~130MB)
from Hugging Face — needs internet access once, then it's cached locally.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens on `http://localhost:5173`, proxying `/api` to the backend on `:8000`.

## Deployment

Dockerized and ready to run on a VPS: `docker-compose.yml` wires up the
backend, the frontend (built + served by nginx), and Caddy as a reverse proxy
with automatic HTTPS. See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full
step-by-step.

Quick version, once you're on the server with the repo cloned:

```bash
cp backend/.env.example backend/.env   # fill in your LLM backend + API key
# edit Caddyfile: replace your-domain.com with your actual domain
docker compose up -d --build
```

## API summary

- `POST /api/session` — create a session, returns `session_id`
- `POST /api/upload/{session_id}` — multipart upload, up to 50 PDFs
- `GET /api/documents/{session_id}` — list processed filenames
- `POST /api/chat` — SSE stream: `citations` event, then `token` events, then `done`
- `DELETE /api/session/{session_id}` — clear a session's index
