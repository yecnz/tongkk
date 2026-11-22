import asyncio
import copy
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from auth import require_api_user
from learning_sessions.generation import Generator, GenerationError, validate_feedback, validate_pack
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.router import get_service, router
from learning_sessions.schemas import Action, Answer, Command, CreateSession, Draft, Help, Report, Scope, SessionView
from learning_sessions.service import Service, now, public_view
from learning_sessions.source_scope import select_source, source_hash, units

USER, OTHER, COURSE = (str(uuid4()) for _ in range(3))
TEXT = '<!-- p.1 -->\n분산 학습은 시간을 두고 반복하는 학습이다.\n\n인출 연습은 기억에서 답을 꺼내는 활동이다.'


class MemoryRepository:
    """Test double only; production never falls back to this store."""
    def __init__(self):
        self.bundles = {}
        self.material_row = {"id": "lecture:100", "course_id": COURSE, "user_id": USER,
                             "markdown": TEXT, "name": "강의 자료"}

    async def material(self, user, _token, course, material):
        if user != USER or course != COURSE or material != self.material_row["id"]:
            raise HTTPException(404)
        return copy.deepcopy(self.material_row)

    async def load(self, user, session):
        value = self.bundles.get(session)
        if not value or value["session"]["user_id"] != user:
            raise HTTPException(404)
        return copy.deepcopy(value)

    async def command(self, user, key):
        for b in self.bundles.values():
            for op in b["operations"]:
                if b["session"]["user_id"] == user and op["command_key"] == key:
                    return copy.deepcopy(op)

    async def cached_pack(self, user, key):
        return next((copy.deepcopy(b["pack"]) for b in self.bundles.values()
                     if b["pack"]["user_id"] == user and b["pack"]["preparation_key"] == key
                     and b["pack"]["status"] in {"ready", "failed"}), None)

    async def open_pack(self, user, key):
        return next((copy.deepcopy(b) for b in self.bundles.values()
                     if b["pack"]["user_id"] == user and b["pack"]["preparation_key"] == key
                     and b["session"]["status"] in {"preparing", "active", "paused", "failed"}), None)

    async def listing(self, user, _limit):
        return [{"id": b["session"]["id"], "status": b["session"]["status"],
                 "material_name": b["pack"]["material_name"], "updated_at": now().isoformat()}
                for b in self.bundles.values() if b["session"]["user_id"] == user]

    async def save(self, user, bundle, version):
        session = bundle["session"]
        old = self.bundles.get(session["id"])
        if version != -1 and (not old or old["session"]["version"] != version):
            raise WriteConflict()
        value = copy.deepcopy(bundle)
        value["session"]["version"] = 0 if version == -1 else version + 1
        for op in value["operations"]:
            op.update(session_id=session["id"], user_id=user)
        self.bundles[session["id"]] = value
        return copy.deepcopy(value)


def pack_content(source_units, count=2):
    refs = [{"unit_id": source_units[0]["id"], "quote": "분산 학습은 시간을 두고 반복하는 학습이다."}]
    return {"concepts": [{"title": f"개념 {i}", "introduction": "학습 활동을 확인해요.",
                          "question": f"개념 {i}을 자기 말로 설명하세요.",
                          "criteria": [{"id": "c1", "description": "시간 간격 설명", "source_refs": refs}],
                          "source_refs": refs, "hints": ["시간을 생각해요", "한 번에 몰아서 할까요?"],
                          "reference": "분산 학습은 시간을 두고 반복합니다.",
                          "check": {"question": "어느 방법이 분산 학습일까요?", "options": ["매일 조금씩", "하루에 전부"],
                                    "answer_index": 0, "explanation": "시간을 두고 반복하는 방법입니다."}}
                         for i in range(count)]}


class FakeGenerator:
    model = "fake-model"
    fail_prepare = False
    fail_evaluate = False

    async def prepare(self, pack):
        if self.fail_prepare:
            raise ValueError("provider error with private content")
        content = pack_content(pack["source_units"], pack["concept_count"])
        return validate_pack(content, pack["source_units"], pack["concept_count"]), {"model_id": self.model}

    async def evaluate(self, pack, concept, answer):
        if self.fail_evaluate:
            raise ValueError("provider failed")
        output = {"criteria": [{"criterion_id": "c1", "status": "met", "student_quote": answer,
                                "reason": "시간 간격을 설명했어요.", "source_refs": concept["source_refs"]}]}
        return validate_feedback(output, concept, pack["source_units"], answer), {"model_id": self.model}


def create_request(**extra):
    return CreateSession(course_id=COURSE, material_id="lecture:100", source_hash=source_hash(TEXT),
                         idempotency_key=uuid4(), **extra)


async def ready(count=2):
    service = Service(MemoryRepository(), FakeGenerator())
    bundle, op = await service.create(USER, "jwt", create_request(concept_count=count))
    await service.run(USER, bundle["session"]["id"], op)
    return service, await service.repo.load(USER, bundle["session"]["id"])


def cmd(bundle, cls, **values):
    return cls(expected_revision=bundle["session"]["revision"], idempotency_key=uuid4(), **values)


def test_recall_to_check_to_completion_and_no_early_answer_disclosure():
    async def scenario():
        service, b = await ready(1)
        view = SessionView.model_validate(public_view(b)).model_dump()
        assert view["current"]["check"] is None
        assert "criteria" not in str(view["current"]["help"])
        assert "answer_index" not in str(view)
        item = b["items"][0]
        b = await service.draft(USER, b["session"]["id"], Draft(item_id=item["id"], expected_item_revision=0, text="이전 초안"))
        request = cmd(b, Answer, item_id=item["id"], kind="recall", answer="시간을 두고 복습해요")
        b, operation = await service.command(USER, b["session"]["id"], "answers", request)
        # Submission carries the newest text even if autosave had an older draft.
        assert b["attempts"][0]["answer"] == "시간을 두고 복습해요"
        replay, duplicate = await service.command(USER, b["session"]["id"], "answers", request)
        assert duplicate is None and len(replay["attempts"]) == 1
        await service.run(USER, b["session"]["id"], operation)
        b = await service.repo.load(USER, b["session"]["id"])
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="advance"))
        assert public_view(b)["current"]["check"] and public_view(b)["current"]["check_result"] is None
        b, operation = await service.command(USER, b["session"]["id"], "answers", cmd(b, Answer, item_id=item["id"], kind="check", answer=0))
        assert operation is None and public_view(b)["current"]["check_result"]["correct"]
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="advance"))
        assert b["session"]["status"] == "completed" and b["session"]["calls"] == 2
        assert public_view(b)["result"][0]["recall"] == "sufficient"
    asyncio.run(scenario())


def test_evaluation_error_keeps_answer_and_allows_self_check():
    async def scenario():
        service, b = await ready()
        service.generator.fail_evaluate = True
        b, op = await service.command(USER, b["session"]["id"], "answers", cmd(b, Answer, item_id=b["items"][0]["id"], kind="recall", answer="내 설명"))
        await service.run(USER, b["session"]["id"], op)
        b = await service.repo.load(USER, b["session"]["id"])
        assert b["attempts"][0]["status"] == "ungraded" and b["attempts"][0]["answer"] == "내 설명"
        assert "self_check" in public_view(b)["allowed_actions"]
        b, _ = await service.command(USER, b["session"]["id"], "help", cmd(b, Help, item_id=b["items"][0]["id"], help_type="reference"))
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="self_check", self_check="needs_review"))
        assert public_view(b)["current"]["self_check"] == "needs_review"
    asyncio.run(scenario())


def test_pause_during_evaluation_preserves_result_and_pause():
    async def scenario():
        service, b = await ready()
        b, op = await service.command(USER, b["session"]["id"], "answers", cmd(b, Answer, item_id=b["items"][0]["id"], kind="recall", answer="내 설명"))
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="pause"))
        await service.run(USER, b["session"]["id"], op)
        b = await service.repo.load(USER, b["session"]["id"])
        assert b["session"]["status"] == "paused" and b["items"][0]["phase"] == "recall_feedback"
    asyncio.run(scenario())


def test_expired_lease_retry_and_old_result_cannot_apply():
    async def scenario():
        service, b = await ready()
        b, op = await service.command(USER, b["session"]["id"], "answers", cmd(b, Answer, item_id=b["items"][0]["id"], kind="recall", answer="내 설명"))
        stored = service.repo.bundles[b["session"]["id"]]
        stored["operations"][-1]["lease_expires_at"] = (now() - timedelta(seconds=1)).isoformat()
        b = await service.repo.load(USER, b["session"]["id"])
        assert public_view(b)["operation"]["retryable"]
        b, new_op = await service.command(USER, b["session"]["id"], "retry", cmd(b, Command), op)
        await service.run(USER, b["session"]["id"], op)
        assert (await service.repo.load(USER, b["session"]["id"]))["items"][0]["phase"] == "recall_evaluating"
        await service.run(USER, b["session"]["id"], new_op)
        assert (await service.repo.load(USER, b["session"]["id"]))["attempts"][0]["status"] == "graded"
    asyncio.run(scenario())


def test_completed_session_and_deleted_session_ignore_late_results():
    async def scenario():
        service, b = await ready()
        b, op = await service.command(USER, b["session"]["id"], "answers", cmd(b, Answer, item_id=b["items"][0]["id"], kind="recall", answer="내 설명"))
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="finish"))
        await service.run(USER, b["session"]["id"], op)
        assert (await service.repo.load(USER, b["session"]["id"]))["attempts"][0]["status"] == "ungraded"
        del service.repo.bundles[b["session"]["id"]]
        await service.run(USER, b["session"]["id"], op)
        assert not service.repo.bundles
    asyncio.run(scenario())


def test_help_records_overlap_and_skip_is_ungraded():
    async def scenario():
        service, b = await ready()
        b, _ = await service.command(USER, b["session"]["id"], "help", cmd(b, Help, item_id=b["items"][0]["id"], help_type="source"))
        assert b["items"][1]["data"]["prior_instruction"]
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="skip"))
        assert public_view(b)["current"]["position"] == 1 and not b["attempts"]
    asyncio.run(scenario())


def test_source_and_feedback_validation():
    source_units = units(TEXT)
    with pytest.raises(HTTPException):
        select_source(TEXT, Scope(type="pages", pages=[999]))
    with pytest.raises(HTTPException):
        select_source("a" * 12001, Scope())
    raw = pack_content(source_units)
    raw["concepts"][0]["source_refs"][0]["quote"] = "원문에 없는 문장"
    with pytest.raises(ValueError):
        validate_pack(raw, source_units, 2)
    concept = pack_content(source_units)["concepts"][0]
    with pytest.raises(ValueError):
        validate_feedback({"criteria": [{"criterion_id": "c1", "status": "met", "student_quote": "만든 인용",
                                          "reason": "근거", "source_refs": concept["source_refs"]}]}, concept, source_units, "학생 답변")


def test_revision_and_idempotency_key_conflicts_and_other_owner():
    async def scenario():
        service, b = await ready()
        request = cmd(b, Action, action="pause")
        b, _ = await service.command(USER, b["session"]["id"], "actions", request)
        with pytest.raises(HTTPException) as conflict:
            await service.command(USER, b["session"]["id"], "actions", request.model_copy(update={"action": "resume"}))
        assert conflict.value.detail["error_code"] == "KEY_REUSED"
        with pytest.raises(HTTPException):
            await service.repo.load(OTHER, b["session"]["id"])
        with pytest.raises(HTTPException):
            await service.command(USER, b["session"]["id"], "actions", Action(expected_revision=0, idempotency_key=uuid4(), action="resume"))
    asyncio.run(scenario())


def test_prepare_failure_never_opens_answer_and_cache_reuse_has_no_model_call():
    async def scenario():
        service = Service(MemoryRepository(), FakeGenerator())
        service.generator.fail_prepare = True
        b, op = await service.create(USER, "jwt", create_request())
        await service.run(USER, b["session"]["id"], op)
        b = await service.repo.load(USER, b["session"]["id"])
        assert b["session"]["status"] == "failed" and public_view(b)["current"] is None
        service.generator.fail_prepare = False
        b, op = await service.command(USER, b["session"]["id"], "retry", cmd(b, Command), op)
        await service.run(USER, b["session"]["id"], op)
        b = await service.repo.load(USER, b["session"]["id"])
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="finish"))
        new, operation = await service.create(USER, "jwt", create_request())
        assert operation is None and new["session"]["calls"] == 0 and new["session"]["repeated"]
    asyncio.run(scenario())


def test_new_routes_reject_unknown_fields_and_auth_bypass(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_api_user] = lambda: None
    client = TestClient(app)
    assert client.get('/learning-sessions').status_code == 401
    app.dependency_overrides[require_api_user] = lambda: {"id": USER}
    app.dependency_overrides[get_service] = lambda: Service(MemoryRepository(), FakeGenerator())
    body = create_request().model_dump(mode="json")
    body["score"] = 100
    assert client.post('/learning-sessions', json=body, headers={"Authorization": "Bearer jwt"}).status_code == 422


def test_missing_server_key_fails_closed(monkeypatch):
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(HTTPException) as error:
        Repository().available()
    assert error.value.status_code == 503


def test_http_round_trip_and_scopes_route_order():
    app = FastAPI()
    app.include_router(router)
    service = Service(MemoryRepository(), FakeGenerator())
    app.dependency_overrides[require_api_user] = lambda: {"id": USER}
    app.dependency_overrides[get_service] = lambda: service
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer jwt"}
        scopes = client.get('/learning-sessions/scopes', params={"course_id": COURSE, "material_id": "lecture:100"}, headers=headers)
        assert scopes.status_code == 200 and scopes.json()["source_hash"] == source_hash(TEXT)
        created = client.post('/learning-sessions', json=create_request(concept_count=1).model_dump(mode="json"), headers=headers)
        assert created.status_code == 202
        path = '/learning-sessions/' + created.json()["id"]
        view = client.get(path, headers=headers).json()
        assert view["status"] == "active" and view["current"]["check"] is None
        answer = {"item_id": view["current"]["id"], "kind": "recall", "answer": "시간 간격을 두고 공부해요",
                  "expected_revision": view["revision"], "idempotency_key": str(uuid4())}
        assert client.post(path+'/answers', json=answer, headers=headers).status_code == 202
        feedback = client.get(path, headers=headers).json()
        assert feedback["current"]["feedback"]["criteria"][0]["status"] == "met"
        assert "source_snapshot" not in feedback and "content" not in feedback


def test_simultaneous_duplicate_submission_creates_only_one_attempt():
    async def scenario():
        service, b = await ready()
        original_load = service.repo.load

        async def yielding_load(*args):
            value = await original_load(*args)
            await asyncio.sleep(0)
            return value
        service.repo.load = yielding_load
        request = cmd(b, Answer, item_id=b["items"][0]["id"], kind="recall", answer="같은 답변")
        replies = await asyncio.gather(*(service.command(USER, b["session"]["id"], "answers", request) for _ in range(4)))
        stored = await service.repo.load(USER, b["session"]["id"])
        assert len(stored["attempts"]) == 1
        assert sum(operation is not None for _, operation in replies) == 1
    asyncio.run(scenario())


def test_lost_persistence_retries_same_model_output():
    async def scenario():
        service, b = await ready()
        b, op = await service.command(USER, b["session"]["id"], "answers", cmd(b, Answer, item_id=b["items"][0]["id"], kind="recall", answer="설명"))
        original_save, original_evaluate = service.repo.save, service.generator.evaluate
        writes, calls = 0, 0

        async def save(*args):
            nonlocal writes
            writes += 1
            if writes == 1:
                raise HTTPException(503)
            return await original_save(*args)

        async def evaluate(*args):
            nonlocal calls
            calls += 1
            return await original_evaluate(*args)
        service.repo.save, service.generator.evaluate = save, evaluate
        await service.run(USER, b["session"]["id"], op)
        assert calls == 1 and writes == 2
        assert (await service.repo.load(USER, b["session"]["id"]))["attempts"][0]["status"] == "graded"
    asyncio.run(scenario())


def test_exhausted_budget_does_not_call_model_and_does_not_mark_wrong():
    async def scenario():
        service, b = await ready()
        service.repo.bundles[b["session"]["id"]]["session"]["calls"] = 4
        b, op = await service.command(USER, b["session"]["id"], "answers", cmd(b, Answer, item_id=b["items"][0]["id"], kind="recall", answer="설명"))
        assert op is None and b["attempts"][0]["status"] == "ungraded"
        assert public_view(b)["current"]["evaluation_error"]
    asyncio.run(scenario())


def test_stale_source_and_draft_conflict_are_explicit():
    async def scenario():
        service, b = await ready()
        service.repo.material_row["markdown"] += '\n수정'
        with pytest.raises(HTTPException) as error:
            await service.create(USER, "jwt", create_request())
        assert error.value.detail["error_code"] == "SOURCE_CHANGED"
        request = Draft(item_id=b["items"][0]["id"], expected_item_revision=0, text="첫 초안")
        await service.draft(USER, b["session"]["id"], request)
        with pytest.raises(HTTPException) as error:
            await service.draft(USER, b["session"]["id"], request.model_copy(update={"text": "다른 탭 초안"}))
        assert error.value.detail["error_code"] == "DRAFT_CONFLICT"
    asyncio.run(scenario())


def test_first_learning_shows_intro_and_reports_require_visited_item():
    async def scenario():
        service = Service(MemoryRepository(), FakeGenerator())
        b, op = await service.create(USER, "jwt", create_request(familiarity="new"))
        await service.run(USER, b["session"]["id"], op)
        b = await service.repo.load(USER, b["session"]["id"])
        assert public_view(b)["current"]["introduction"]
        with pytest.raises(HTTPException):
            await service.command(USER, b["session"]["id"], "report", cmd(b, Report, reason="question"), b["items"][1]["id"])
    asyncio.run(scenario())


def test_identical_scope_continues_existing_session_without_second_ai_work():
    async def scenario():
        service = Service(MemoryRepository(), FakeGenerator())
        first, first_op = await service.create(USER, "jwt", create_request())
        second, second_op = await service.create(USER, "jwt", create_request(scope=Scope(type="pages", pages=[1])))
        assert first_op and second_op is None
        assert first["session"]["id"] == second["session"]["id"]
        assert len(service.repo.bundles) == 1 and second["session"]["calls"] == 1
    asyncio.run(scenario())


def test_failed_preparation_can_restart_after_abandoning():
    async def scenario():
        service = Service(MemoryRepository(), FakeGenerator())
        service.generator.fail_prepare = True
        b, op = await service.create(USER, "jwt", create_request())
        await service.run(USER, b["session"]["id"], op)
        b = await service.repo.load(USER, b["session"]["id"])
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="abandon"))
        service.generator.fail_prepare = False
        fresh, op = await service.create(USER, "jwt", create_request())
        assert fresh["pack"]["id"] == b["pack"]["id"] and fresh["session"]["id"] != b["session"]["id"]
        assert fresh["session"]["status"] == "preparing" and op
    asyncio.run(scenario())


def test_skip_is_distinguished_from_unattempted_items_in_results():
    async def scenario():
        service, b = await ready(2)
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="skip"))
        assert b["session"]["status"] == "active"
        b, _ = await service.command(USER, b["session"]["id"], "actions", cmd(b, Action, action="finish"))
        view = SessionView.model_validate(public_view(b)).model_dump()
        assert view["result"][0]["skipped"] is True
        assert view["result"][1]["skipped"] is False
        assert all(item["recall"] == "ungraded" for item in view["result"])
        # Completed records saved before skip metadata existed still deserialize.
        for item in b["session"]["result"]:
            item.pop("skipped", None)
        assert all(not item["skipped"] for item in SessionView.model_validate(public_view(b)).model_dump()["result"])
    asyncio.run(scenario())


@pytest.mark.parametrize("explanation", ["가" * 161, "   ", "같은 근거입니다.\n\n같은 근거입니다."])
def test_generated_check_rejects_verbose_or_empty_explanations_without_truncation(explanation):
    source_units = units(TEXT)
    raw = pack_content(source_units, 1)
    raw["concepts"][0]["check"]["explanation"] = explanation
    with pytest.raises(ValueError):
        validate_pack(raw, source_units, 1)
    assert raw["concepts"][0]["check"]["explanation"] == explanation


@pytest.mark.parametrize("reason", ["가" * 161, "   ", "같은 판단입니다.\n\n같은 판단입니다."])
def test_generated_feedback_rejects_verbose_or_empty_reasons_without_truncation(reason):
    source_units = units(TEXT)
    concept = pack_content(source_units, 1)["concepts"][0]
    raw = {"criteria": [{"criterion_id": "c1", "status": "missing", "student_quote": "",
                         "reason": reason, "source_refs": concept["source_refs"]}]}
    with pytest.raises(ValueError):
        validate_feedback(raw, concept, source_units, "학생 답변")
    assert raw["criteria"][0]["reason"] == reason


def test_concise_feedback_preserves_long_exact_quotes_and_saved_feedback():
    async def scenario():
        service, b = await ready(1)
        item = b["items"][0]
        answer = "시간을 두고 반복해요. " * 20
        quoted_source = TEXT * 4
        source_units = [{"id": "source", "text": quoted_source}]
        concept = pack_content(units(TEXT), 1)["concepts"][0]
        refs = [{"unit_id": "source", "quote": quoted_source}]
        feedback = {"criteria": [{"criterion_id": "c1", "status": "met", "student_quote": answer,
                                  "reason": "시간 간격을 정확히 설명했어요.", "source_refs": refs}]}
        assert validate_feedback(feedback, concept, source_units, answer) == feedback
        # Historical long feedback must still load through the public response schema.
        item["phase"] = "recall_feedback"
        old = copy.deepcopy(feedback)
        old["criteria"][0]["reason"] = "이전에 저장된 상세 설명입니다. " * 20
        item["data"]["feedback"] = old
        view = SessionView.model_validate(public_view(b)).model_dump()
        assert view["current"]["feedback"] == old
    asyncio.run(scenario())


def test_generator_applies_compact_output_schema_and_keeps_validation_failures_retryable(monkeypatch):
    from unittest.mock import AsyncMock

    async def scenario():
        source_units = units(TEXT)
        raw = pack_content(source_units, 1)
        fake_call = AsyncMock(return_value=(raw, {"model_id": "fake"}))
        generator = Generator()
        monkeypatch.setattr(generator, "_call", fake_call)
        result, metrics = await generator.prepare({"concept_count": 1, "source_units": source_units})
        assert result == raw and metrics == {"model_id": "fake"}
        schema = fake_call.call_args.args[2]
        assert schema["$defs"]["ConciseCheckQuestion"]["properties"]["explanation"]["maxLength"] == 160
        raw["concepts"][0]["check"]["explanation"] = "가" * 161
        with pytest.raises(GenerationError) as error:
            await generator.prepare({"concept_count": 1, "source_units": source_units})
        assert error.value.metrics == {"model_id": "fake"}
    asyncio.run(scenario())
