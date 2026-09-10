from pydantic import BaseModel


class UploadResult(BaseModel):
    filename: str
    status: str  # "processed" | "cached" | "error"
    pages: int = 0
    chunks: int = 0
    error: str | None = None


class ChatTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    session_id: str
    question: str
    history: list[ChatTurn] = []
    top_k: int = 6
    filenames: list[str] | None = None  # optional: restrict retrieval to specific docs
    backend: str | None = None  # "ollama" | "anthropic" | "openai"


class Citation(BaseModel):
    filename: str
    page_number: int
    similarity: float


class DocumentInfo(BaseModel):
    filename: str
