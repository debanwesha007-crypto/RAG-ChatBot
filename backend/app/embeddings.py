"""Batched embedding generation using a local sentence-transformers model.

Loaded once (module-level singleton) since model load is the expensive part.
"""
from functools import lru_cache

from sentence_transformers import SentenceTransformer

from app.config import EMBEDDING_MODEL_NAME, EMBEDDING_BATCH_SIZE


@lru_cache(maxsize=1)
def _get_model() -> SentenceTransformer:
    return SentenceTransformer(EMBEDDING_MODEL_NAME)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embeds; never calls the model one text at a time."""
    if not texts:
        return []
    model = _get_model()
    vectors = model.encode(
        texts,
        batch_size=EMBEDDING_BATCH_SIZE,
        show_progress_bar=False,
        normalize_embeddings=True,  # so cosine similarity == dot product
        convert_to_numpy=True,
    )
    return vectors.tolist()


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]
