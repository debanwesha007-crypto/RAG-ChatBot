"""Per-session Chroma collections. Each chat session gets its own isolated collection
so documents from one user's session never leak into another's retrieval."""
import chromadb

from app.config import CHROMA_DIR, DEFAULT_TOP_K

_client = chromadb.PersistentClient(path=str(CHROMA_DIR))


def get_collection(session_id: str):
    return _client.get_or_create_collection(
        name=f"session_{session_id}",
        metadata={"hnsw:space": "cosine"},
    )


def upsert_chunks(session_id: str, chunk_ids: list[str], embeddings: list[list[float]],
                   documents: list[str], metadatas: list[dict]) -> None:
    if not chunk_ids:
        return
    collection = get_collection(session_id)
    collection.upsert(
        ids=chunk_ids,
        embeddings=embeddings,
        documents=documents,
        metadatas=metadatas,
    )


def query(session_id: str, query_embedding: list[float], top_k: int = DEFAULT_TOP_K,
          filenames: list[str] | None = None) -> list[dict]:
    collection = get_collection(session_id)
    where = {"filename": {"$in": filenames}} if filenames else None
    result = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where=where,
    )
    hits = []
    ids = result.get("ids", [[]])[0]
    docs = result.get("documents", [[]])[0]
    metas = result.get("metadatas", [[]])[0]
    dists = result.get("distances", [[]])[0]
    for cid, doc, meta, dist in zip(ids, docs, metas, dists):
        hits.append({
            "chunk_id": cid,
            "text": doc,
            "filename": meta.get("filename"),
            "page_number": meta.get("page_number"),
            "similarity": 1 - dist,  # cosine distance -> similarity
        })
    return hits


def list_documents(session_id: str) -> list[str]:
    collection = get_collection(session_id)
    result = collection.get(include=["metadatas"])
    return sorted({m["filename"] for m in result.get("metadatas", []) if m})


def delete_session(session_id: str) -> None:
    try:
        _client.delete_collection(f"session_{session_id}")
    except Exception:
        pass
