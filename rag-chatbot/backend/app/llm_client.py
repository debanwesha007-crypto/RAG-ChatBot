"""Switchable LLM backend with streaming generation. Backend chosen per-request
(falls back to config default) so the frontend can offer a toggle."""
import json
from collections.abc import AsyncIterator

import httpx

from app import config

SYSTEM_PROMPT = """You are a document Q&A assistant. Answer ONLY using the provided \
context excerpts from the user's uploaded PDFs. Follow these rules strictly:

1. Do not use outside knowledge. If the context does not contain the answer, say plainly \
that the uploaded documents don't contain this information — do not guess or fill gaps.
2. Every factual claim must be traceable to a specific excerpt. Cite inline using the \
format [filename, p.N] immediately after the claim it supports.
3. If asked to compare or synthesize across multiple documents, clearly attribute each \
piece of information to its source document.
4. Be concise and direct. Do not pad the answer with filler.
5. If the retrieved context is empty or irrelevant to the question, say so instead of \
answering from general knowledge.
"""


def build_prompt(question: str, contexts: list[dict], history: list[dict]) -> list[dict]:
    context_block = "\n\n".join(
        f"[Source: {c['filename']}, p.{c['page_number']}]\n{c['text']}"
        for c in contexts
    ) or "(no relevant context retrieved)"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in history[-6:]:  # last few turns for conversational context
        messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({
        "role": "user",
        "content": f"Context excerpts:\n\n{context_block}\n\nQuestion: {question}",
    })
    return messages


async def stream_completion(messages: list[dict], backend: str | None = None) -> AsyncIterator[str]:
    backend = backend or config.LLM_BACKEND
    if backend == "ollama":
        async for token in _stream_ollama(messages):
            yield token
    elif backend == "anthropic":
        async for token in _stream_anthropic(messages):
            yield token
    elif backend == "openai":
        async for token in _stream_openai(messages):
            yield token
    else:
        raise ValueError(f"Unknown LLM backend: {backend}")


async def _stream_ollama(messages: list[dict]) -> AsyncIterator[str]:
    url = f"{config.OLLAMA_BASE_URL}/api/chat"
    payload = {"model": config.OLLAMA_MODEL, "messages": messages, "stream": True}
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", url, json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                data = json.loads(line)
                chunk = data.get("message", {}).get("content", "")
                if chunk:
                    yield chunk
                if data.get("done"):
                    break


async def _stream_anthropic(messages: list[dict]) -> AsyncIterator[str]:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
    system = next((m["content"] for m in messages if m["role"] == "system"), None)
    chat_messages = [m for m in messages if m["role"] != "system"]
    async with client.messages.stream(
        model=config.ANTHROPIC_MODEL,
        max_tokens=1024,
        system=system,
        messages=chat_messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def _stream_openai(messages: list[dict]) -> AsyncIterator[str]:
    import openai
    client = openai.AsyncOpenAI(api_key=config.OPENAI_API_KEY)
    stream = await client.chat.completions.create(
        model=config.OPENAI_MODEL, messages=messages, stream=True,
    )
    async for event in stream:
        delta = event.choices[0].delta.content
        if delta:
            yield delta
