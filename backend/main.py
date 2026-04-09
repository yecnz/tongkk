from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from single_model_local_or_gemini_smoke import (  # noqa: E402
    get_client,
    extract_markdown_from_pdf,
    build_sections,
    build_chunks,
    run_global_summary,
    ensure_dir,
    save_json,
    save_text,
    get_model_provider,
)

app = FastAPI(title="Tongkk Summary MVP API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RUNTIME_DIR = PROJECT_ROOT / "runtime"
UPLOAD_DIR = RUNTIME_DIR / "uploads"
OUTPUT_DIR = RUNTIME_DIR / "outputs"
ensure_dir(UPLOAD_DIR)
ensure_dir(OUTPUT_DIR)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "provider": os.getenv("MODEL_PROVIDER", "gemini"),
        "model": os.getenv("MODEL_NAME", ""),
    }


@app.post("/api/summary/run")
async def summary_run(
    file: UploadFile = File(...),
    course: Optional[str] = Form(default=""),
):
    filename = file.filename or "uploaded.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="현재 MVP에서는 PDF 파일만 지원합니다.")

    document_id = f"doc_{uuid.uuid4().hex[:12]}"
    upload_path = UPLOAD_DIR / f"{document_id}.pdf"
    outdir = OUTPUT_DIR / document_id
    ensure_dir(outdir)

    content = await file.read()
    upload_path.write_bytes(content)

    try:
        client = get_client()
        model_name = os.getenv("MODEL_NAME", "gemini-2.5-flash")
        safe_one_shot_input_tokens = int(os.getenv("SAFE_ONE_SHOT_INPUT_TOKENS", "250000"))
        max_tokens_per_chunk = int(os.getenv("MAX_TOKENS_PER_CHUNK", "1024"))

        markdown = extract_markdown_from_pdf(upload_path)
        sections = build_sections(markdown)
        chunks = build_chunks(sections, max_tokens_per_chunk)

        save_text(outdir / "01_markdown.md", markdown)
        save_json(outdir / "02_sections.json", [s.__dict__ for s in sections])
        save_json(outdir / "03_chunks.json", [c.__dict__ for c in chunks])

        t_start = time.time()
        summary_markdown = run_global_summary(
            client=client,
            model_name=model_name,
            markdown=markdown,
            sections=sections,
            chunks=chunks,
            safe_one_shot_input_tokens=safe_one_shot_input_tokens,
            outdir=outdir,
        )
        elapsed_seconds = round(time.time() - t_start, 1)

        response = {
            "document_id": document_id,
            "filename": filename,
            "course": course or "",
            "model_provider": get_model_provider(),
            "model_name": model_name,
            "num_sections": len(sections),
            "num_chunks": len(chunks),
            "elapsed_seconds": elapsed_seconds,
            "summary_markdown": summary_markdown,
        }
        save_json(outdir / "00_response.json", response)
        return JSONResponse(response)

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"요약 생성 실패: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
