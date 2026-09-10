FROM python:3.12-slim

WORKDIR /app

# System deps for PyMuPDF and building wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Persisted data (uploads, chroma index, cache db) - mount a volume here
RUN mkdir -p /app/data/uploads /app/data/chroma
VOLUME ["/app/data"]

EXPOSE 8000

# Pre-download the embedding model at build time so first request isn't slow
# and the container doesn't need outbound internet at runtime for it.
ARG EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
ENV EMBEDDING_MODEL=${EMBEDDING_MODEL}
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
