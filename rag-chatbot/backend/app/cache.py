"""Persistent caches so re-uploading an unchanged PDF never re-parses or re-embeds it.

Two caches, both keyed by content hash (not filename, so renamed-but-identical files
still hit the cache):
  - processed file registry: file_hash -> list of chunk_ids it produced
  - embedding cache: chunk_id -> embedding vector
"""
from sqlitedict import SqliteDict

from app.config import CACHE_DB_PATH

_PROCESSED_TABLE = "processed_files"
_EMBED_TABLE = "chunk_embeddings"


def get_processed_chunk_ids(file_hash: str) -> list[str] | None:
    with SqliteDict(str(CACHE_DB_PATH), tablename=_PROCESSED_TABLE) as db:
        return db.get(file_hash)


def mark_file_processed(file_hash: str, chunk_ids: list[str]) -> None:
    with SqliteDict(str(CACHE_DB_PATH), tablename=_PROCESSED_TABLE, autocommit=True) as db:
        db[file_hash] = chunk_ids


def get_cached_embeddings(chunk_ids: list[str]) -> dict[str, list[float]]:
    if not chunk_ids:
        return {}
    with SqliteDict(str(CACHE_DB_PATH), tablename=_EMBED_TABLE) as db:
        return {cid: db[cid] for cid in chunk_ids if cid in db}


def store_embeddings(embeddings: dict[str, list[float]]) -> None:
    if not embeddings:
        return
    with SqliteDict(str(CACHE_DB_PATH), tablename=_EMBED_TABLE, autocommit=True) as db:
        for cid, vec in embeddings.items():
            db[cid] = vec
