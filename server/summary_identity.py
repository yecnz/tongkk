"""AI-free identity for summary requests; never treats old output as current input."""
import hashlib
import json
import os
import re
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from auth import require_api_user
from schemas import SummarizeRequest

router = APIRouter(prefix='/summaries', tags=['summaries'])
SUMMARY_POLICY = 'summary-v2'
CHUNK_POLICY = '16000-28000-1500-v1'


class MaterialIdentity(BaseModel):
    id: str = Field(min_length=1, max_length=1000)
    name: str = Field(min_length=1, max_length=1000)


class PrepareSummary(SummarizeRequest):
    course_id: UUID
    materials: list[MaterialIdentity] = Field(min_length=1, max_length=100)


def normalize_pages(spec, markdown):
    if not spec or not spec.strip():
        return ''
    selected = set()
    for part in spec.split(','):
        match = re.fullmatch(r'\s*(\d{1,5})(?:\s*-\s*(\d{1,5}))?\s*', part)
        if not match:
            raise ValueError('페이지 범위를 확인해주세요.')
        a, b = int(match[1]), int(match[2] or match[1])
        if not 1 <= a <= 10000 or not 1 <= b <= 10000:
            raise ValueError('페이지 범위를 확인해주세요.')
        selected.update(range(min(a, b), max(a, b) + 1))
    available = {int(n) for n in re.findall(r'<!--\s*(?:p\.|Slide number:\s*)(\d+)\s*-->', markdown)}
    if not selected.issubset(available):
        raise ValueError('자료에 있는 페이지를 선택해주세요.')
    return ','.join(map(str, sorted(selected)))


def prepare_identity(request, user):
    if len({m.id for m in request.materials}) != len(request.materials):
        raise ValueError('같은 자료를 중복 선택할 수 없어요.')
    pages = normalize_pages(request.pages, request.markdown)
    source_hash = hashlib.sha256(request.markdown.encode()).hexdigest()
    config = {'materials': [m.model_dump() for m in request.materials], 'pages': pages,
              'focus_prompt': (request.focus_prompt or '').replace('\r\n', '\n').strip(),
              'template': request.template, 'model': os.getenv('OPENAI_MODEL', 'gpt-5.4-mini') if request.model == 'GPT'
              else os.getenv('GEMINI_MODEL', 'gemini-3.1-flash-lite-preview'),
              'prompt_version': SUMMARY_POLICY, 'chunk_version': CHUNK_POLICY}
    key = hashlib.sha256(json.dumps([user, str(request.course_id), source_hash, config],
                                   ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'source_hash': source_hash, 'request_key': key, 'generation_config': config}


@router.post('/prepare')
async def prepare_summary(request: PrepareSummary, user=Depends(require_api_user)):
    try:
        return prepare_identity(request, user['id'])
    except ValueError as error:
        raise HTTPException(422, detail=str(error)) from error
