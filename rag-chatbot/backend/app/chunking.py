"""Chunks page text into overlapping word-bounded chunks, preserving page metadata.

Uses a simple whitespace tokenizer rather than a model-specific BPE tokenizer (e.g.
tiktoken) so chunking works fully offline with no vocab download, and stays
LLM-agnostic since this pipeline supports multiple swappable backends. "Tokens"
here means whitespace-split words, which approximates ~0.75 real tokens/word -
close enough for chunk-sizing purposes.
"""
import hashlib
import re
from dataclasses import dataclass

from app.config import CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS
from app.pdf_processor import ProcessedPDF

_WORD_RE = re.compile(r"\S+")


@dataclass
class Chunk:
    chunk_id: str
    text: str
    filename: str
    file_hash: str
    page_number: int
    chunk_index: int  # index within the page, for stable IDs


def _split_words(words: list[str], size: int, overlap: int):
    if not words:
        return
    step = max(size - overlap, 1)
    for start in range(0, len(words), step):
        window = words[start:start + size]
        if not window:
            break
        yield window
        if start + size >= len(words):
            break


def chunk_document(doc: ProcessedPDF) -> list[Chunk]:
    """One page's text may span multiple chunks; chunk_id stays stable per (file_hash, page, index)
    so re-processing an unchanged file produces identical IDs (idempotent upsert)."""
    chunks: list[Chunk] = []
    for page in doc.pages:
        if not page.text:
            continue
        words = _WORD_RE.findall(page.text)
        for idx, window in enumerate(_split_words(words, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS)):
            text = " ".join(window)
            raw_id = f"{doc.file_hash}:{page.page_number}:{idx}"
            chunk_id = hashlib.sha256(raw_id.encode()).hexdigest()[:24]
            chunks.append(Chunk(
                chunk_id=chunk_id,
                text=text,
                filename=doc.filename,
                file_hash=doc.file_hash,
                page_number=page.page_number,
                chunk_index=idx,
            ))
    return chunks
