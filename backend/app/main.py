import asyncio
import json
import logging
import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app import config, llm_client, pipeline, vector_store
from app.models import ChatRequest, UploadResult

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Multi-PDF RAG Chatbot")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten for production deployment
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/session")
async def create_session():
    return {"session_id": str(uuid.uuid4())}


@app.post("/api/upload/{session_id}", response_model=list[UploadResult])
async def upload_files(session_id: str, files: list[UploadFile] = File(...)):
    existing = vector_store.list_documents(session_id)
    incoming_names = {f.filename for f in files}
    projected_total = len(set(existing) | incoming_names)
    if projected_total > config.MAX_FILES_PER_SESSION:
        raise HTTPException(
            status_code=400,
            detail=f"Session limit is {config.MAX_FILES_PER_SESSION} PDFs "
                   f"(would have {projected_total}).",
        )

    results: list[UploadResult] = []
    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            results.append(UploadResult(filename=f.filename, status="error", error="Not a PDF"))
            continue
        content = await f.read()
        size_mb = len(content) / (1024 * 1024)
        if size_mb > config.MAX_FILE_SIZE_MB:
            results.append(UploadResult(
                filename=f.filename, status="error",
                error=f"File exceeds {config.MAX_FILE_SIZE_MB}MB limit",
            ))
            continue
        # Run the (CPU-bound) processing in a thread so multiple files process concurrently
        # rather than one at a time blocking the event loop.
        result = await asyncio.to_thread(
            pipeline.process_and_index_file, session_id, f.filename, content,
        )
        results.append(result)
    return results


@app.get("/api/documents/{session_id}")
async def list_documents(session_id: str):
    return {"documents": vector_store.list_documents(session_id)}


@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str):
    vector_store.delete_session(session_id)
    return {"status": "deleted"}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    docs = vector_store.list_documents(req.session_id)
    if not docs:
        raise HTTPException(status_code=400, detail="No documents uploaded in this session yet")

    top_k = min(req.top_k, config.MAX_TOP_K)
    try:
        contexts = pipeline.retrieve(req.session_id, req.question, top_k, req.filenames)
    except Exception as e:
        logger.exception("Retrieval failed")
        raise HTTPException(status_code=503, detail=f"Retrieval unavailable: {e}")

    async def event_stream():
        # Send citations first so the UI can render source chips immediately,
        # independent of generation speed.
        citation_payload = [
            {"filename": c["filename"], "page_number": c["page_number"], "similarity": round(c["similarity"], 3)}
            for c in contexts
        ]
        yield f"event: citations\ndata: {json.dumps(citation_payload)}\n\n"

        messages = llm_client.build_prompt(
            req.question, contexts, [t.model_dump() for t in req.history],
        )
        try:
            async for token in llm_client.stream_completion(messages, backend=req.backend):
                yield f"event: token\ndata: {json.dumps({'text': token})}\n\n"
        except Exception as e:
            logger.exception("LLM streaming failed")
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/health")
async def health():
    return {"status": "ok", "llm_backend": config.LLM_BACKEND}
