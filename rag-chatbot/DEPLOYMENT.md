# Deploying to your own VPS (Docker)

This spins up three containers: `backend` (FastAPI + RAG pipeline), `frontend`
(the React app, built and served by nginx), and `caddy` (reverse proxy that
gets you automatic HTTPS if you point a domain at the server).

## 1. Prep the VPS

SSH in, then install Docker + Compose (Ubuntu/Debian example):

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in after this so you don't need sudo for docker
```

Open ports 80 and 443 in your VPS firewall/security group (needed for Caddy's
HTTP-01 TLS challenge and normal traffic).

## 2. Get the code onto the server

```bash
git clone https://github.com/<your-username>/rag-chatbot.git
cd rag-chatbot
```

## 3. Configure the backend

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Set, at minimum:

```
LLM_BACKEND=anthropic          # or openai
ANTHROPIC_API_KEY=sk-ant-...   # your real key
```

`docker-compose.yml` won't start without this `.env` file existing (even if
some values are blank), since it's referenced via `env_file`.

## 4. Point your domain at the server

Add an A record for your domain (e.g. `chatbot.yourdomain.com`) pointing to
the VPS's public IP. Wait for DNS to propagate (usually minutes).

Edit `Caddyfile` and replace `your-domain.com` with your actual domain:

```
chatbot.yourdomain.com {
    reverse_proxy frontend:80
}
```

No domain yet / just testing by IP? Use `:80` instead of a domain name in the
Caddyfile — Caddy will serve plain HTTP with no TLS, reachable at
`http://<your-vps-ip>`.

## 5. Build and start everything

```bash
docker compose up -d --build
```

First build downloads the embedding model into the backend image (~130MB) and
installs dependencies (including PyTorch for sentence-transformers) — this can
take several minutes on the first run. Subsequent deploys are much faster
thanks to Docker layer caching.

Check it came up clean:

```bash
docker compose ps
docker compose logs -f backend
```

Visit `https://chatbot.yourdomain.com` (or `http://<vps-ip>`) — you should see
the chat UI.

## 6. Updating after code changes

```bash
git pull
docker compose up -d --build
```

## 7. Data persistence

Uploaded PDFs, the Chroma vector index, and the processed-file cache all live
in the `backend_data` Docker volume, so they survive container restarts and
rebuilds. To wipe everything and start fresh:

```bash
docker compose down -v   # -v also removes volumes — this deletes all uploaded data
```

## Notes specific to your setup

- You're running the **API backend** (Anthropic/OpenAI), so the VPS itself
  doesn't need much RAM/CPU beyond running the embedding model + FastAPI —
  a 2GB RAM VPS is generally enough. If you later switch to local Ollama,
  you'll want considerably more RAM (8GB+) and ideally a GPU.
- CORS in `backend/app/main.py` is currently `allow_origins=["*"]`. Once your
  domain is live, tighten this to your actual frontend origin
  (`https://chatbot.yourdomain.com`) to prevent other sites from calling your
  API directly.
- Consider adding basic auth or an API key check in front of `/api/*` if this
  will be publicly reachable and you don't want strangers uploading files to
  your server.
