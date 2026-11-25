"""Material-grounded, editable chapter paths; progress comes from linked sessions."""
from uuid import UUID, uuid4, uuid5

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, ConfigDict, Field

from learning_sessions.errors import fail
from learning_sessions.generation import Generator
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.router import session_user
from learning_sessions.schemas import CreateSession, Scope
from learning_sessions.service import Service
from learning_sessions.source_scope import select_source, source_hash, units
from usage import track_generation

router = APIRouter(prefix='/study-paths', tags=['study-paths'])


def repository():
    return Repository()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class CreatePath(StrictModel):
    id: UUID
    course_id: UUID
    material_ids: list[str] = Field(min_length=1, max_length=6)
    title: str = Field(min_length=1, max_length=100)


class DraftChapter(StrictModel):
    material_id: str = Field(min_length=1, max_length=1000)
    title: str = Field(min_length=1, max_length=100)
    objective: str = Field(min_length=1, max_length=300)
    unit_ids: list[str] = Field(min_length=1, max_length=40)


class DraftPath(StrictModel):
    chapters: list[DraftChapter] = Field(min_length=1, max_length=12)


class EditChapter(StrictModel):
    id: UUID
    title: str = Field(min_length=1, max_length=100)
    included: bool


class EditPath(StrictModel):
    revision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=100)
    chapters: list[EditChapter] = Field(min_length=1, max_length=12)


class PathGenerator(Generator):
    @track_generation
    async def draft(self, materials):
        return await self._call(
            '여러 강의자료를 학습할 순서의 챕터로 구성하라. 모든 자료를 적어도 한 번 포함하고 '
            '자료 하나당 1~3개, 전체 12개 이하 챕터를 작성하라. 각 챕터는 자료 한 개의 실제 unit_ids를 '
            '선택하고 그 구간만으로 공부할 목표를 한 문장으로 써라. 선수 개념부터 정렬하되 원문에 없는 '
            '개념을 추가하지 마라. 각 챕터의 원문은 구간 사이 공백을 포함하여 12000자 이내여야 한다. '
            '하나의 구간을 여러 챕터에 중복 배정하지 마라.',
            {'materials': materials}, DraftPath.model_json_schema(), 60)


def validate_chapters(raw, materials):
    draft = DraftPath.model_validate(raw)
    source = {m['id']: m for m in materials}
    covered, used, result = set(), set(), []
    for c in draft.chapters:
        if c.material_id not in source or len(c.unit_ids) != len(set(c.unit_ids)):
            raise ValueError('Foreign or duplicate source units')
        material = source[c.material_id]
        if any((c.material_id, unit) in used for unit in c.unit_ids):
            raise ValueError('Repeated chapter scope')
        _, selected = select_source(material['markdown'], Scope(type='units', unit_ids=c.unit_ids))
        used.update((c.material_id, unit) for unit in c.unit_ids)
        covered.add(c.material_id)
        result.append({**c.model_dump(), 'unit_ids': [u['id'] for u in selected], 'id': str(uuid4()), 'included': True,
                       'material_name': material['name'], 'source_hash': source_hash(material['markdown']),
                       'source_labels': [u['label'] for u in selected]})
    if covered != set(source):
        raise ValueError('Every selected material must appear')
    return result


async def read_path(repo, user, path):
    value = await repo._rpc('study_path_read', {'p_user': user, 'p_id': str(path)})
    if not value:
        fail('NOT_FOUND', '학습 코스를 찾을 수 없어요.', 404)
    return value


@router.get('')
async def listing(auth=Depends(session_user), repo=Depends(repository)):
    return {'paths': await repo._rpc('study_path_list', {'p_user': auth[0]})}


@router.post('')
async def create(request: CreatePath, auth=Depends(session_user), repo=Depends(repository)):
    existing = await repo._rpc('study_path_read', {'p_user': auth[0], 'p_id': str(request.id)})
    if existing:
        return existing
    if len(set(request.material_ids)) != len(request.material_ids):
        fail('INVALID_INPUT', '서로 다른 자료를 선택해주세요.', 422)
    materials = [await repo.material(*auth, str(request.course_id), mid) for mid in request.material_ids]
    # Reject oversized sources explicitly; never imply omitted pages were covered.
    if sum(len(m['markdown']) for m in materials) > 60000:
        fail('SOURCE_LIMIT', '선택 자료의 원문은 합계 60,000자 이내여야 해요. 자료를 나누어 선택하세요.', 422)
    payload = []
    for material in materials:
        sections = units(material['markdown'])
        if not sections or any(u['chars'] > 12000 for u in sections):
            fail('SOURCE_LIMIT', '빈 자료 또는 한 구간이 12,000자를 넘는 자료는 사용할 수 없어요.', 422)
        payload.append({'id': material['id'], 'name': material['name'], 'units': sections})
    try:
        raw, _ = await PathGenerator().draft(payload)
        chapters = validate_chapters(raw, materials)
    except Exception:
        fail('GENERATION_FAILED', '코스 초안을 만들지 못했어요. 선택한 자료를 확인하고 다시 시도해주세요.', 502)
    try:
        return await repo._rpc('study_path_create', {'p_user': auth[0], 'p_id': str(request.id),
            'p_course': str(request.course_id), 'p_title': request.title, 'p_chapters': chapters})
    except WriteConflict:
        fail('CONFLICT', '요청이 이미 처리되었거나 자료가 바뀌었어요. 코스 목록을 새로 확인해주세요.', 409)


@router.get('/{path_id}')
async def read(path_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    return await read_path(repo, auth[0], path_id)


@router.put('/{path_id}')
async def edit(path_id: UUID, request: EditPath, auth=Depends(session_user), repo=Depends(repository)):
    try:
        return await repo._rpc('study_path_edit', {'p_user': auth[0], 'p_id': str(path_id),
            'p_revision': request.revision, 'p_title': request.title,
            'p_chapters': [c.model_dump(mode='json') for c in request.chapters]})
    except WriteConflict:
        fail('CONFLICT', '다른 화면에서 코스가 바뀌었어요. 다시 불러온 뒤 편집해주세요.', 409)


@router.post('/{path_id}/chapters/{chapter_id}/start')
async def start(path_id: UUID, chapter_id: UUID, tasks: BackgroundTasks,
                auth=Depends(session_user), repo=Depends(repository)):
    path = await read_path(repo, auth[0], path_id)
    chapter = next((c for c in path['chapters'] if c['id'] == str(chapter_id) and c['included']), None)
    if not chapter:
        fail('NOT_FOUND', '학습할 챕터를 찾을 수 없어요.', 404)
    retry_finished = chapter.get('session_status') in ('completed', 'abandoned') and not chapter.get('completed')
    if chapter.get('session_id') and not retry_finished:
        return {'session_id': chapter['session_id']}
    material = await repo.material(*auth, path['course_id'], chapter['material_id'])
    if source_hash(material['markdown']) != chapter['source_hash']:
        fail('SOURCE_CHANGED', '원문이 변경되어 새 코스를 만들어야 해요. 기존 학습 기록은 보존됩니다.', 409)
    service = Service()
    service.repo = repo
    bundle, operation = await service.create(*auth, CreateSession(
        course_id=path['course_id'], material_id=chapter['material_id'], source_hash=chapter['source_hash'],
        scope=Scope(type='units', unit_ids=chapter['unit_ids']), familiarity='new',
        target_minutes=15, concept_count=2, idempotency_key=uuid5(path_id,
            str(chapter_id) + (':' + chapter['session_id'] if retry_finished else ''))))
    # Enqueue existing session work before linking, so an interrupted link can be retried safely.
    if operation:
        from workflow import durable_enabled
        if not durable_enabled():
            tasks.add_task(service.run, auth[0], bundle['session']['id'], operation)
    try:
        await repo._rpc('study_path_link_session', {'p_user': auth[0], 'p_id': str(path_id),
            'p_chapter': str(chapter_id), 'p_session': bundle['session']['id']})
    except WriteConflict:
        fail('CONFLICT', '챕터가 변경되었어요. 코스를 다시 불러와주세요.', 409)
    return {'session_id': bundle['session']['id']}
