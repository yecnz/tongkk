from uuid import UUID
from typing import Literal
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.source_scope import source_hash, select_source
from learning_sessions.schemas import Scope
from learning_sessions.service import digest
from learning_sessions.generation import Generator, POLICY_VERSION
from learning_sessions.errors import fail
from summary_identity import PrepareSummary, MaterialIdentity, prepare_identity, normalize_pages
from workflow import durable_enabled

router = APIRouter(prefix='/preparation-requests', tags=['preparation'])


def repository():
    return Repository()


class Create(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    course_id: UUID
    material_id: str = Field(min_length=1, max_length=1000)
    kinds: list[Literal['summary', 'quiz', 'pack']] = Field(min_length=1, max_length=3)
    pages: str = Field(default='', max_length=1000)
    regenerate: bool = False


class Action(BaseModel):
    action: Literal['apply', 'discard', 'retry']


def projection(value):
    if not value:
        fail('NOT_FOUND', '준비 작업을 찾을 수 없어요.', 404)
    r = value['request']
    artifacts = []
    for a in value['artifacts']:
        result = a.get('result') or {}
        preview = {'concepts': [c['title'] for c in result.get('content', {}).get('concepts', [])]} if a['kind'] == 'pack' else result
        artifacts.append({**{k: a.get(k) for k in ('id', 'kind', 'status', 'generation', 'error_code', 'applied_id')}, 'preview': preview})
    return {'id': r['id'], 'course_id': r['course_id'], 'material_id': r['material_id'], 'pages': r['config']['pages'],
            'source_changed': value['source_changed'], 'artifacts': artifacts}


def build_config(user, course, material, pages):
    normalized = normalize_pages(pages, material['markdown'])
    scope = Scope(type='pages', pages=[int(p) for p in normalized.split(',')]) if normalized else Scope()
    snapshot, selected = select_source(material['markdown'], scope)
    scope_value = {'type': 'units', 'unit_ids': [u['id'] for u in selected]}
    full_hash = source_hash(material['markdown'])
    identity = prepare_identity(PrepareSummary(markdown=material['markdown'], course_id=course, pages=normalized,
        materials=[MaterialIdentity(id=material['id'], name=material['name'])], source_names=[material['name']]), user)
    generator = Generator()
    pack = {'user_id': user, 'course_id': course, 'material_id': material['id'], 'material_name': material['name'],
            'source_hash': full_hash, 'source_snapshot': snapshot, 'source_units': selected, 'selected_scope': scope_value,
            'concept_count': 2, 'content_version': POLICY_VERSION,
            'preparation_key': digest([user, course, material['id'], full_hash, scope_value, 2, generator.model, POLICY_VERSION])}
    return snapshot, {'pages': normalized, 'material_name': material['name'], 'summary_identity': identity, 'pack': pack}


@router.post('')
async def create(request: Create, auth=Depends(session_user), repo=Depends(repository)):
    if not durable_enabled():
        fail('WORKER_REQUIRED', '자료 자동 준비를 사용하려면 학습 워커 설정이 필요해요.', 503)
    material = await repo.material(*auth, str(request.course_id), request.material_id)
    try:
        snapshot, config = build_config(auth[0], str(request.course_id), material, request.pages)
    except ValueError as exc:
        fail('INVALID_SCOPE', str(exc), 422)
    key = digest([auth[0], str(request.course_id), request.material_id, source_hash(material['markdown']), config,
                  sorted(set(request.kinds)), str(request.id) if request.regenerate else None])
    config['regenerate'] = request.regenerate
    try:
        value = await repo._rpc('preparation_create', {'p_user': auth[0], 'p_id': str(request.id), 'p_course': str(request.course_id),
            'p_material': request.material_id, 'p_hash': source_hash(material['markdown']), 'p_key': key, 'p_snapshot': snapshot,
            'p_config': config, 'p_kinds': sorted(set(request.kinds))})
    except WriteConflict:
        fail('CONFLICT', '준비 요청을 다시 확인해주세요.')
    return projection(value)


@router.get('')
async def listing(course_id: UUID, material_id: str = Query(min_length=1, max_length=1000), auth=Depends(session_user), repo=Depends(repository)):
    values = await repo._rpc('preparation_list', {'p_user': auth[0], 'p_course': str(course_id), 'p_material': material_id})
    return {'requests': [projection(v) for v in values]}


@router.get('/{request_id}')
async def read(request_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    return projection(await repo._rpc('preparation_read', {'p_user': auth[0], 'p_id': str(request_id)}))


@router.post('/artifacts/{artifact_id}/actions')
async def action(artifact_id: UUID, request: Action, auth=Depends(session_user), repo=Depends(repository)):
    try:
        result = await repo._rpc('preparation_action', {'p_user': auth[0], 'p_artifact': str(artifact_id), 'p_action': request.action})
    except WriteConflict:
        fail('CONFLICT', '준비 결과가 바뀌었어요. 작업을 다시 확인해주세요.')
    return {'id': result['id'], 'status': result['status'], 'applied_id': result.get('applied_id')}


async def generate_artifact(repo, job):
    ctx = await repo._rpc('preparation_context', {'p_user': job['user_id'], 'p_artifact': job['target_id']})
    if not ctx or ctx['source_changed']:
        raise ValueError('Source changed or deleted')
    r, a = ctx['request'], ctx['artifact']
    if a['status'] != 'queued' or a['generation'] != job['generation']:
        raise ValueError('Work was superseded')
    config = r['config']
    from usage import request_usage
    usage_context = request_usage.get()
    if usage_context:
        usage_context['feature'] = 'preparation_' + a['kind']
    if a['kind'] == 'pack':
        cached = await repo.cached_pack(job['user_id'], config['pack']['preparation_key'])
        if cached and cached['status'] == 'ready':
            return {'reused_id': cached['id'], 'content': cached['content']}, {}
        content, metrics = await Generator().prepare(config['pack'])
        return {'content': content}, metrics
    if a['kind'] == 'summary' and not config.get('regenerate'):
        cached = await repo._rpc('preparation_summary_lookup', {'p_user': job['user_id'], 'p_key': config['summary_identity']['request_key']})
        if cached:
            return cached, {}
    # Reuse the same validated generation entry points as interactive authoring.
    from main import summarize, generate_quiz
    from schemas import SummarizeRequest, QuizRequest
    if a['kind'] == 'summary':
        result = await summarize(SummarizeRequest(markdown=r['source_snapshot'], source_names=[config['material_name']]), _user={'id': job['user_id']})
        if not result.get('result', '').strip():
            raise ValueError('Empty summary')
        return {'content': result['result']}, {}
    result = await generate_quiz(QuizRequest(subject=config['material_name'], count=5, difficulty='보통', question_type='객관식', markdown=r['source_snapshot']), _user={'id': job['user_id']})
    from uuid import uuid4
    return {'questions': [{**q, 'id': str(uuid4()), 'version': 1} for q in result['questions']]}, {}
