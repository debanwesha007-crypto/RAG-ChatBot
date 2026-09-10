"""Orchestrates: parse -> chunk -> (cache-aware) embed -> index, per uploaded file."""
import logging

from app import cache, embeddings, vector_store
from app.chunking import chunk_document
from app.models import UploadResult
from app.pdf_processor import extract_pdf

logger = logging.getLogger(__name__)


def process_and_index_file(session_id: str, filename: str, content: bytes) -> UploadResult:
    doc = extract_pdf(filename, content)
    if not doc.ok:
        return UploadResult(filename=filename, status="error", error=doc.error)

    # Skip re-chunking if this exact file content was already processed anywhere before.
    cached_chunk_ids = cache.get_processed_chunk_ids(doc.file_hash)
    chunks = chunk_document(doc)
    if not chunks:
        return UploadResult(filename=filename, status="error", error="No text could be extracted")

    chunk_ids = [c.chunk_id for c in chunks]

    # Reuse cached embeddings where available; only embed what's missing.
    cached_vectors = cache.get_cached_embeddings(chunk_ids)
    missing = [c for c in chunks if c.chunk_id not in cached_vectors]
    if missing:
        new_vectors = embeddings.embed_texts([c.text for c in missing])
        fresh = {c.chunk_id: vec for c, vec in zip(missing, new_vectors)}
        cache.store_embeddings(fresh)
        cached_vectors.update(fresh)

    all_embeddings = [cached_vectors[c.chunk_id] for c in chunks]
    metadatas = [
        {"filename": c.filename, "page_number": c.page_number, "file_hash": c.file_hash}
        for c in chunks
    ]
    vector_store.upsert_chunks(
        session_id=session_id,
        chunk_ids=chunk_ids,
        embeddings=all_embeddings,
        documents=[c.text for c in chunks],
        metadatas=metadatas,
    )
    cache.mark_file_processed(doc.file_hash, chunk_ids)

    status = "cached" if cached_chunk_ids else "processed"
    return UploadResult(filename=filename, status=status, pages=len(doc.pages), chunks=len(chunks))


def retrieve(session_id: str, question: str, top_k: int, filenames: list[str] | None) -> list[dict]:
    query_vec = embeddings.embed_query(question)
    return vector_store.query(session_id, query_vec, top_k=top_k, filenames=filenames)
