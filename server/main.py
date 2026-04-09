from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown
import tempfile
import os

app = FastAPI()

# React 개발 서버(5173)에서 오는 요청 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

md_converter = MarkItDown()


@app.post("/convert")
async def convert_pdf_to_markdown(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 지원합니다.")

    # 임시 파일로 저장 후 markitdown 변환
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = md_converter.convert(tmp_path)
        return {"markdown": result.text_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"변환 실패: {str(e)}")
    finally:
        os.unlink(tmp_path)


@app.get("/health")
def health():
    return {"status": "ok"}
