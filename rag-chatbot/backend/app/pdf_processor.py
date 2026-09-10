"""Extracts text from PDFs page-by-page, tolerating corrupted/invalid files."""
import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)


@dataclass
class PageText:
    page_number: int  # 1-indexed
    text: str


@dataclass
class ProcessedPDF:
    filename: str
    file_hash: str
    pages: list[PageText]
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


def file_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def extract_pdf(filename: str, content: bytes) -> ProcessedPDF:
    """Extract text per page. Never raises - returns ProcessedPDF.error on failure."""
    fhash = file_hash(content)
    try:
        doc = fitz.open(stream=content, filetype="pdf")
    except Exception as e:  # corrupted / not a real PDF / encrypted without password, etc.
        logger.warning("Failed to open %s: %s", filename, e)
        return ProcessedPDF(filename=filename, file_hash=fhash, pages=[], error=f"Could not open PDF: {e}")

    if doc.is_encrypted:
        # try empty-password decrypt; many "encrypted" PDFs are just permission-locked
        if not doc.authenticate(""):
            doc.close()
            return ProcessedPDF(filename=filename, file_hash=fhash, pages=[], error="PDF is password-protected")

    pages: list[PageText] = []
    for i in range(doc.page_count):
        try:
            page = doc.load_page(i)
            text = page.get_text("text") or ""
        except Exception as e:
            logger.warning("Failed to extract page %d of %s: %s", i + 1, filename, e)
            text = ""
        pages.append(PageText(page_number=i + 1, text=text.strip()))
    doc.close()

    non_empty = [p for p in pages if p.text]
    if not non_empty:
        return ProcessedPDF(
            filename=filename, file_hash=fhash, pages=pages,
            error="No extractable text found (possibly a scanned/image-only PDF)",
        )

    return ProcessedPDF(filename=filename, file_hash=fhash, pages=pages)
