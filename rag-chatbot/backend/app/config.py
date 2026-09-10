import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
CHROMA_DIR = DATA_DIR / "chroma"
CACHE_DB_PATH = DATA_DIR / "cache.sqlite"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)

# --- Limits ---
MAX_FILES_PER_SESSION = 50
MAX_FILE_SIZE_MB = 50

# --- Chunking ---
CHUNK_SIZE_TOKENS = 600
CHUNK_OVERLAP_TOKENS = 90

# --- Retrieval ---
DEFAULT_TOP_K = 6
MAX_TOP_K = 15

# --- Embeddings ---
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
EMBEDDING_BATCH_SIZE = 64

# --- LLM backends ---
# "ollama" (local, free) or "anthropic" or "openai" (API, needs key)
LLM_BACKEND = os.getenv("LLM_BACKEND", "ollama")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
