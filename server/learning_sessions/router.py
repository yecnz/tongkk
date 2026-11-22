from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Response

from auth import require_api_user
from .errors import fail
from .schemas import (Action, Answer, Command, CreateSession, Draft, Help, OperationView,
                      Report, ScopesView, SessionList, SessionView, SessionHistory)
from .service import Service, public_view, history_view

router = APIRouter(prefix="/learning-sessions", tags=["learning-sessions"])


async def session_user(user=Depends(require_api_user), authorization: str = Header(default="")):
    if not user or not user.get("id") or not authorization.lower().startswith("bearer "):
        fail("AUTH_REQUIRED", "학습 기록을 저장하려면 로그인해주세요.", 401)
    try:
        user_id = str(UUID(user["id"]))
    except (ValueError, TypeError):
        fail("AUTH_REQUIRED", "다시 로그인해주세요.", 401)
    return user_id, authorization.split(" ", 1)[1].strip()


def get_service():
    return Service()


def finish(bundle, operation, user, tasks, response, service):
    if operation:
        tasks.add_task(service.run, user, bundle["session"]["id"], operation)
        response.status_code = 202
    return public_view(bundle)


@router.get("/scopes", response_model=ScopesView)
async def scopes(course_id: UUID, material_id: str = Query(min_length=1, max_length=1000),
                 auth=Depends(session_user), service=Depends(get_service)):
    return await service.scopes(auth[0], auth[1], str(course_id), material_id)


@router.get("", response_model=SessionList)
async def listing(limit: int = Query(default=10, ge=1, le=30), auth=Depends(session_user), service=Depends(get_service)):
    return {"sessions": await service.repo.listing(auth[0], limit)}


@router.post("", response_model=SessionView)
async def create(request: CreateSession, tasks: BackgroundTasks, response: Response,
                 auth=Depends(session_user), service=Depends(get_service)):
    bundle, operation = await service.create(*auth, request)
    return finish(bundle, operation, auth[0], tasks, response, service)


@router.get('/history', response_model=SessionList)
async def history_list(limit: int = Query(default=30, ge=1, le=30), auth=Depends(session_user), service=Depends(get_service)):
    return {'sessions': await service.repo.history(auth[0], limit)}


@router.get('/{session_id}/history', response_model=SessionHistory)
async def history_detail(session_id: UUID, auth=Depends(session_user), service=Depends(get_service)):
    return history_view(await service.repo.load(auth[0], str(session_id)))


@router.get('/{session_id}/concepts')
async def concepts(session_id: UUID, auth=Depends(session_user), service=Depends(get_service)):
    await service.repo.load(auth[0], str(session_id))
    return {'concepts': await service.repo._rpc('learning_session_concepts', {'p_user': auth[0], 'p_session': str(session_id)})}


@router.get("/{session_id}", response_model=SessionView)
async def read(session_id: UUID, auth=Depends(session_user), service=Depends(get_service)):
    return public_view(await service.repo.load(auth[0], str(session_id)))


@router.patch("/{session_id}/draft", response_model=SessionView)
async def draft(session_id: UUID, request: Draft, auth=Depends(session_user), service=Depends(get_service)):
    return public_view(await service.draft(auth[0], str(session_id), request))


@router.post("/{session_id}/answers", response_model=SessionView)
async def answer(session_id: UUID, request: Answer, tasks: BackgroundTasks, response: Response,
                 auth=Depends(session_user), service=Depends(get_service)):
    bundle, operation = await service.command(auth[0], str(session_id), "answers", request)
    return finish(bundle, operation, auth[0], tasks, response, service)


@router.post("/{session_id}/help", response_model=SessionView)
async def help_item(session_id: UUID, request: Help, tasks: BackgroundTasks, response: Response,
                    auth=Depends(session_user), service=Depends(get_service)):
    bundle, operation = await service.command(auth[0], str(session_id), "help", request)
    return finish(bundle, operation, auth[0], tasks, response, service)


@router.post("/{session_id}/actions", response_model=SessionView)
async def action(session_id: UUID, request: Action, tasks: BackgroundTasks, response: Response,
                 auth=Depends(session_user), service=Depends(get_service)):
    bundle, operation = await service.command(auth[0], str(session_id), "actions", request)
    return finish(bundle, operation, auth[0], tasks, response, service)


@router.get("/{session_id}/operations/{operation_id}", response_model=OperationView)
async def operation_status(session_id: UUID, operation_id: UUID, auth=Depends(session_user), service=Depends(get_service)):
    view = public_view(await service.repo.load(auth[0], str(session_id)))
    if not view["operation"] or view["operation"]["id"] != str(operation_id):
        fail("NOT_FOUND", "현재 작업을 찾을 수 없습니다.", 404)
    return view["operation"]


@router.post("/{session_id}/operations/{operation_id}/retry", response_model=SessionView)
async def retry(session_id: UUID, operation_id: UUID, request: Command, tasks: BackgroundTasks, response: Response,
                auth=Depends(session_user), service=Depends(get_service)):
    bundle, operation = await service.command(auth[0], str(session_id), "retry", request, str(operation_id))
    return finish(bundle, operation, auth[0], tasks, response, service)


@router.post("/{session_id}/items/{item_id}/report", response_model=SessionView)
async def report(session_id: UUID, item_id: UUID, request: Report, tasks: BackgroundTasks, response: Response,
                 auth=Depends(session_user), service=Depends(get_service)):
    bundle, operation = await service.command(auth[0], str(session_id), "report", request, str(item_id))
    return finish(bundle, operation, auth[0], tasks, response, service)
