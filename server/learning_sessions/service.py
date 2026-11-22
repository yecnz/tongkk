import asyncio
import copy
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException

from .errors import fail
from .generation import POLICY_VERSION, Generator
from .repository import Repository, WriteConflict
from .source_scope import select_source, source_hash, units, MAX_SOURCE_CHARS


def now():
    return datetime.now(timezone.utc)


def uid():
    return str(uuid4())


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def expired(op):
    if op["status"] != "running":
        return False
    # Production reads compute expiration using the database clock, shared by all workers.
    if "lease_expired" in op:
        return op["lease_expired"]
    return datetime.fromisoformat(op["lease_expires_at"]) <= now()


def current_item(bundle):
    return next((i for i in bundle["items"] if i["id"] == bundle["session"]["current_item_id"]), None)


def concept_for(bundle, item):
    return bundle["pack"]["content"]["concepts"][item["position"]]


def model_operation(bundle):
    return next((op for op in reversed(bundle["operations"]) if op["kind"] in {"prepare", "evaluate"}), None)


def results(bundle):
    output = []
    for item in bundle["items"]:
        data = item["data"]
        feedback = data.get("feedback")
        status = "ungraded"
        if feedback:
            states = [c["status"] for c in feedback["criteria"]]
            status = "sufficient" if all(s == "met" for s in states) else (
                "uncertain" if "uncertain" in states else "needs_review")
        elif data.get("self_check"):
            status = "self_report"
        check = data.get("check_result")
        output.append({"title": concept_for(bundle, item)["title"], "recall": status,
                       "check": "ungraded" if not check else "correct" if check["correct"] else "incorrect",
                       "assisted": bool(data.get("help")),
                       "prior_instruction": data.get("prior_instruction", False) or bool(check),
                       "repeated": bundle["session"].get("repeated", False),
                       "reported": bool(data.get("report"))})
    return output


def allowed(bundle):
    session = bundle["session"]
    status = session["status"]
    if status in {"completed", "abandoned"}:
        return []
    if status == "paused":
        return ["resume", "finish", "abandon"]
    if status in {"preparing", "failed"}:
        return ["abandon"]
    item = current_item(bundle)
    actions = ["pause", "finish", "abandon"]
    if not item:
        return actions
    phase = item["phase"]
    if phase in {"recall_answering", "check_answering"}:
        actions += ["submit", "help", "skip"]
        if phase == "recall_answering":
            actions += ["unknown"]
    elif phase in {"recall_feedback", "check_feedback", "repair"}:
        actions += ["advance", "help"]
    op = model_operation(bundle)
    if (item["data"].get("evaluation_error") or
            (phase == "recall_evaluating" and op and expired(op)) or
            any(c["status"] == "uncertain" for c in item["data"].get("feedback", {}).get("criteria", []))):
        actions += ["self_check", "help"]
    return list(dict.fromkeys(actions))


def public_view(bundle):
    session, pack = bundle["session"], bundle["pack"]
    item = current_item(bundle)
    op = model_operation(bundle)
    current = None
    if item and session["status"] not in {"completed", "abandoned"}:
        concept, data = concept_for(bundle, item), item["data"]
        show_check = item["phase"] in {"check_answering", "check_feedback", "done"}
        current = {"id": item["id"], "title": concept["title"], "phase": item["phase"],
                   "revision": item["revision"], "position": item["position"],
                   "question": concept["question"], "draft": data.get("draft", ""),
                   "introduction": concept["introduction"] if session["familiarity"] == "new" else None,
                   "help": data.get("help", {}), "feedback": data.get("feedback"),
                   "evaluation_error": bool(data.get("evaluation_error") or
                                            (op and op["kind"] == "evaluate" and expired(op))),
                   "self_check": data.get("self_check"),
                   "check": {"question": concept["check"]["question"], "options": concept["check"]["options"]}
                   if show_check else None,
                   "check_result": data.get("check_result") if show_check else None,
                   "reported": bool(data.get("report"))}
    operation = None
    if op:
        status = "expired" if expired(op) else op["status"]
        operation = {"id": op["id"], "kind": op["kind"], "status": status,
                     "retryable": status in {"failed", "expired"}
                     and session["status"] not in {"completed", "abandoned"}
                     and session["calls"] < pack["concept_count"] + 2
                     and (op["kind"] == "prepare" or bool(item and item["id"] == op["data"].get("item_id")
                          and item["phase"] in {"recall_evaluating", "recall_feedback"}
                          and not item["data"].get("self_check"))),
                     "error_code": op.get("error_code")}
    return {"id": session["id"], "course_id": session["course_id"], "material_id": pack["material_id"],
            "material_name": pack["material_name"], "status": session["status"],
            "revision": session["revision"], "target_minutes": session["target_minutes"],
            "concept_count": len(bundle["items"]) or pack["concept_count"],
            "completed_count": sum(i["phase"] == "done" for i in bundle["items"]),
            "source_changed": bundle.get("source_changed", False), "current": current,
            "operation": operation, "allowed_actions": allowed(bundle),
            "result": session.get("result") or (results(bundle) if session["status"] in {"completed", "abandoned"} else [])}


class Service:
    def __init__(self, repository=None, generator=None):
        self.repo = repository or Repository()
        self.generator = generator or Generator()

    async def scopes(self, user, token, course, material):
        row = await self.repo.material(user, token, course, material)
        text = row["markdown"]
        return {"material_name": row["name"], "source_hash": source_hash(text),
                "total_chars": len(text), "max_chars": MAX_SOURCE_CHARS,
                "units": [{k: u[k] for k in ("id", "label", "page", "chars")} for u in units(text)]}

    def operation(self, kind, key, input_hash, data=None):
        model = kind in {"prepare", "evaluate"}
        return {"id": uid(), "command_key": key, "input_hash": input_hash, "kind": kind,
                "status": "running" if model else "succeeded", "data": data or {},
                "lease_token": uid() if model else None,
                "lease_expires_at": (now() + timedelta(seconds=90)).isoformat() if model else None,
                "attempt_no": 1, "error_code": None, "metrics": {}, "created_at": now().isoformat()}

    @staticmethod
    def replay(op, input_hash, session=None):
        if op["input_hash"] != input_hash or (session and op["session_id"] != session):
            fail("KEY_REUSED", "같은 요청 키가 다른 작업에 사용됐습니다.")

    async def create(self, user, token, request):
        if os.getenv("LEARNING_SESSION_ENABLED", "true").lower() in {"false", "0", "off"}:
            fail("START_DISABLED", "새 학습 시작이 잠시 중단됐습니다. 기존 학습 기록은 계속 조회할 수 있어요.", 503)
        payload = request.model_dump(mode="json")
        key, input_hash = str(request.idempotency_key), digest(["create", payload])
        previous = await self.repo.command(user, key)
        if previous:
            self.replay(previous, input_hash)
            return await self.repo.load(user, previous["session_id"]), None
        row = await self.repo.material(user, token, str(request.course_id), request.material_id)
        if source_hash(row["markdown"]) != request.source_hash:
            fail("SOURCE_CHANGED", "원문이 변경됐습니다. 범위를 다시 선택해주세요.")
        snapshot, selected = select_source(row["markdown"], request.scope)
        normalized_scope = {"type": "units", "unit_ids": [u["id"] for u in selected]}
        prep_key = digest([user, row["course_id"], row["id"], request.source_hash,
                           normalized_scope, request.concept_count, self.generator.model, POLICY_VERSION])
        # Opening the same scope continues its existing work, including a running preparation.
        # Persist the new entry command too, so retrying it after completion cannot start another session.
        for _ in range(4):
            existing = await self.repo.open_pack(user, prep_key)
            if not existing:
                break
            previous = next((o for o in existing["operations"] if o["command_key"] == key), None)
            if previous:
                self.replay(previous, input_hash)
                return existing, None
            existing["operations"].append(self.operation("create", key, input_hash))
            try:
                return await self.repo.save(user, existing, existing["session"]["version"]), None
            except WriteConflict:
                continue
        cached = await self.repo.cached_pack(user, prep_key)
        prepared = bool(cached and cached["status"] == "ready")
        pack = cached or {"id": uid(), "user_id": user, "course_id": row["course_id"],
                          "material_id": row["id"], "material_name": row["name"],
                          "source_hash": request.source_hash, "selected_scope": normalized_scope,
                          "source_snapshot": snapshot, "source_units": selected, "preparation_key": prep_key,
                          "concept_count": request.concept_count, "content_version": POLICY_VERSION,
                          "content": None, "status": "preparing"}
        if not prepared:
            pack["status"] = "preparing"
        session = {"id": uid(), "user_id": user, "course_id": row["course_id"], "pack_id": pack["id"],
                   "status": "active" if prepared else "preparing", "revision": 0, "version": 0,
                   "familiarity": request.familiarity, "target_minutes": request.target_minutes,
                   "calls": 0 if prepared else 1, "current_item_id": None, "result": [],
                   "repeated": prepared, "created_at": now().isoformat(), "completed_at": None}
        op = self.operation("create" if prepared else "prepare", key, input_hash)
        bundle = {"pack": pack, "session": session, "items": [], "attempts": [], "operations": [op]}
        if prepared:
            self.populate(bundle)
        try:
            saved = await self.repo.save(user, bundle, -1)
        except WriteConflict:
            previous = await self.repo.command(user, key)
            if previous:
                self.replay(previous, input_hash)
                return await self.repo.load(user, previous["session_id"]), None
            fail("ACTIVE_SESSION", "같은 범위의 학습이 진행 중입니다. 학습 목록에서 이어서 해주세요.")
        return saved, op["id"] if not prepared else None

    @staticmethod
    def populate(bundle):
        session = bundle["session"]
        for index, _concept in enumerate(bundle["pack"]["content"]["concepts"]):
            bundle["items"].append({"id": uid(), "position": index, "phase": "recall_answering", "revision": 0,
                                    "data": {"draft": "", "help": {}, "help_history": [],
                                             "prior_instruction": session["familiarity"] == "new"}})
        session["current_item_id"] = bundle["items"][0]["id"]

    async def command(self, user, session_id, kind, request, extra=None):
        payload = request.model_dump(mode="json")
        input_hash, key = digest([session_id, kind, payload, extra]), str(request.idempotency_key)
        previous = await self.repo.command(user, key)
        if previous:
            self.replay(previous, input_hash, session_id)
            return await self.repo.load(user, session_id), None
        for _ in range(4):
            bundle = await self.repo.load(user, session_id)
            previous = next((o for o in bundle["operations"] if o["command_key"] == key), None)
            if previous:
                self.replay(previous, input_hash)
                return bundle, None
            session = bundle["session"]
            if request.expected_revision != session["revision"]:
                fail("REVISION_CONFLICT", "다른 화면에서 학습 상태가 변경됐습니다. 최신 상태를 확인해주세요.",
                     current_revision=session["revision"])
            op = self.operation(kind, key, input_hash)
            self.apply(bundle, kind, request, op, extra)
            session["revision"] += 1
            bundle["operations"].append(op)
            try:
                return await self.repo.save(user, bundle, session["version"]), op["id"] if op["status"] == "running" else None
            except WriteConflict:
                continue
        fail("REVISION_CONFLICT", "동시에 변경된 내용이 있습니다. 최신 상태를 확인해주세요.")

    def apply(self, bundle, kind, req, op, extra):
        session, item = bundle["session"], current_item(bundle)
        if session["status"] in {"completed", "abandoned"}:
            fail("SESSION_CLOSED", "종료된 학습은 변경할 수 없습니다.")
        if kind == "retry":
            target = next((o for o in bundle["operations"] if o["id"] == extra), None)
            view_op = public_view(bundle)["operation"]
            if not target or not view_op or target["id"] != view_op["id"] or not view_op["retryable"]:
                fail("RETRY_UNAVAILABLE", "이 작업은 재시도할 수 없습니다.")
            target["status"] = "expired" if expired(target) else target["status"]
            op.update(kind=target["kind"], status="running", data=copy.deepcopy(target["data"]),
                      lease_token=uid(), lease_expires_at=(now() + timedelta(seconds=90)).isoformat(),
                      attempt_no=target["attempt_no"] + 1)
            session["calls"] += 1
            if target["kind"] == "prepare":
                session["status"] = "preparing"
            else:
                item["phase"] = "recall_evaluating"
                item["data"].pop("evaluation_error", None)
            return
        if kind == "report":
            target = next((i for i in bundle["items"] if i["id"] == extra), None)
            # Only visited items may be reported, never a future item.
            if not target or not item or target["position"] > item["position"]:
                fail("NOT_FOUND", "열람한 학습 항목을 찾을 수 없습니다.", 404)
            target["data"]["report"] = {"reason": req.reason, "description": req.description}
            return
        if kind == "actions":
            if req.action not in allowed(bundle):
                fail("INVALID_STATE", "현재 단계에서 사용할 수 없는 행동입니다.")
            if req.action in {"pause", "resume", "finish", "abandon"}:
                session["status"] = {"pause": "paused", "resume": "active", "finish": "completed", "abandon": "abandoned"}[req.action]
                if req.action in {"finish", "abandon"}:
                    for attempt in bundle["attempts"]:
                        if attempt["status"] == "pending":
                            attempt["status"] = "ungraded"
                    for pending in bundle["operations"]:
                        if pending["status"] == "running":
                            pending["status"] = "expired"
                    session["result"] = results(bundle)
                    session["completed_at"] = now().isoformat()
                return
        if session["status"] != "active" or not item:
            fail("INVALID_STATE", "학습을 재개한 뒤 진행해주세요.")
        data, concept = item["data"], concept_for(bundle, item)
        if kind in {"answers", "help"} and str(req.item_id) != item["id"]:
            fail("INVALID_ITEM", "현재 학습 항목이 변경됐습니다.")
        if kind == "answers":
            if item["phase"] != f"{req.kind}_answering":
                fail("ALREADY_SUBMITTED", "이미 제출했거나 현재 답변 단계가 아닙니다.")
            answer = req.answer
            if req.kind == "recall" and (not isinstance(answer, str) or not answer.strip() or len(answer) > 4000):
                fail("INVALID_ANSWER", "4,000자 이내의 설명을 입력하거나 모르겠어요를 선택해주세요.", 422)
            if req.kind == "check" and (type(answer) is not int or not 0 <= answer < len(concept["check"]["options"])):
                fail("INVALID_ANSWER", "선택지 하나를 골라주세요.", 422)
            attempt = {"id": uid(), "item_id": item["id"], "kind": req.kind, "answer": answer,
                       "status": "pending", "result": None, "method": "ai" if req.kind == "recall" else "exact",
                       "assistance": {"during": any(h["phase"].startswith(req.kind) for h in data["help_history"]),
                                      "prior_instruction": data["prior_instruction"] or req.kind == "check",
                                      "prior_exposure": session["repeated"]}, "created_at": now().isoformat()}
            bundle["attempts"].append(attempt)
            if req.kind == "recall":
                if session["calls"] >= bundle["pack"]["concept_count"] + 2:
                    data["evaluation_error"] = True
                    item["phase"] = "recall_feedback"
                    attempt["status"] = "ungraded"
                else:
                    session["calls"] += 1
                    op.update(kind="evaluate", status="running", lease_token=uid(),
                              lease_expires_at=(now() + timedelta(seconds=60)).isoformat(),
                              data={"item_id": item["id"], "attempt_id": attempt["id"]})
                    item["phase"] = "recall_evaluating"
                data["draft"] = answer
            else:
                check = concept["check"]
                result = {"selected": answer, "answer_index": check["answer_index"],
                          "correct": answer == check["answer_index"], "explanation": check["explanation"]}
                attempt.update(status="graded", result=result)
                data["check_result"] = result
                item["phase"] = "check_feedback"
        elif kind == "help":
            if "help" not in allowed(bundle):
                fail("INVALID_STATE", "평가가 끝난 뒤 도움을 열어주세요.")
            help_type = req.help_type
            content = {"source": "\n\n".join(u["text"] for u in bundle["pack"]["source_units"]
                                            if u["id"] in {r["unit_id"] for r in concept["source_refs"]}),
                       "hint1": concept["hints"][0], "hint2": concept["hints"][1], "reference": concept["reference"]}
            data["help"][help_type] = content[help_type]
            data["help_history"].append({"type": help_type, "phase": item["phase"], "at": now().isoformat()})
            if help_type == "hint2":
                data["help"]["hint1"] = content["hint1"]
            if help_type in {"source", "reference"}:
                source_ids = {r["unit_id"] for r in concept["source_refs"]}
                for other in bundle["items"]:
                    if other["position"] > item["position"] and source_ids.intersection(
                            r["unit_id"] for r in concept_for(bundle, other)["source_refs"]):
                        other["data"]["prior_instruction"] = True
        elif kind == "actions":
            if req.action == "unknown":
                item["phase"] = "repair"
                data["unknown"] = True
            elif req.action == "self_check":
                if not req.self_check or "reference" not in data["help"]:
                    fail("REFERENCE_REQUIRED", "모범 설명을 확인한 뒤 자기 점검을 선택해주세요.", 422)
                data["self_check"] = req.self_check
                item["phase"] = "repair"
                # Invalidate any expired/in-flight evaluation before self reporting.
                for target in bundle["operations"]:
                    if target["kind"] == "evaluate" and target["data"].get("item_id") == item["id"] and target["status"] == "running":
                        target["status"] = "expired"
            elif req.action == "advance" and item["phase"] in {"recall_feedback", "repair"}:
                item["phase"] = "check_answering"
            elif req.action in {"advance", "skip"}:
                item["phase"] = "done"
                following = next((i for i in bundle["items"] if i["position"] == item["position"] + 1), None)
                if following:
                    session["current_item_id"] = following["id"]
                else:
                    session.update(status="completed", result=results(bundle), completed_at=now().isoformat())
        item["revision"] += 1

    async def draft(self, user, session_id, request):
        for _ in range(4):
            bundle = await self.repo.load(user, session_id)
            item = current_item(bundle)
            if bundle["session"]["status"] != "active" or not item or item["id"] != str(request.item_id) or item["phase"] != "recall_answering":
                fail("INVALID_STATE", "현재 답변을 수정할 수 없습니다.")
            if item["revision"] != request.expected_item_revision:
                fail("DRAFT_CONFLICT", "다른 화면의 답변이 저장됐습니다. 두 답변을 확인해주세요.")
            item["data"]["draft"] = request.text
            item["revision"] += 1
            try:
                return await self.repo.save(user, bundle, bundle["session"]["version"])
            except WriteConflict:
                continue
        fail("DRAFT_CONFLICT", "답변 저장이 충돌했습니다. 최신 상태를 확인해주세요.")

    async def run(self, user, session_id, operation_id):
        """Process-local task with a durable lease; expired work needs an explicit retry."""
        try:
            bundle = await self.repo.load(user, session_id)
            op = next(o for o in bundle["operations"] if o["id"] == operation_id)
            if op["status"] != "running" or expired(op):
                return
            lease = op["lease_token"]
            started = now()
            try:
                if op["kind"] == "prepare":
                    output, metrics = await asyncio.wait_for(self.generator.prepare(bundle["pack"]), 65)
                else:
                    attempt = next(a for a in bundle["attempts"] if a["id"] == op["data"]["attempt_id"])
                    item = next(i for i in bundle["items"] if i["id"] == op["data"]["item_id"])
                    output, metrics = await asyncio.wait_for(self.generator.evaluate(
                        bundle["pack"], concept_for(bundle, item), attempt["answer"]), 35)
                error = None
            except Exception as exc:
                output, metrics, error = None, getattr(exc, "metrics", {"model_id": self.generator.model}), "MODEL_FAILED"
            metrics["elapsed_ms"] = int((now() - started).total_seconds() * 1000)
            # Retry persistence of the same validated output; never repeat the model here.
            for _ in range(4):
                latest = await self.repo.load(user, session_id)
                target = next(o for o in latest["operations"] if o["id"] == operation_id)
                if (target["status"] != "running" or target["lease_token"] != lease or expired(target)
                        or latest["session"]["status"] in {"completed", "abandoned"}):
                    return
                target.update(status="failed" if error else "succeeded", error_code=error, metrics=metrics)
                if op["kind"] == "prepare":
                    latest["session"]["status"] = "failed" if error else "active"
                    latest["pack"]["status"] = "failed" if error else "ready"
                    if not error:
                        latest["pack"]["content"] = output
                        self.populate(latest)
                else:
                    item = next(i for i in latest["items"] if i["id"] == op["data"]["item_id"])
                    if item["phase"] != "recall_evaluating":
                        return
                    attempt = next(a for a in latest["attempts"] if a["id"] == op["data"]["attempt_id"])
                    attempt.update(status="ungraded" if error else "graded", result=output)
                    item["phase"] = "recall_feedback"
                    item["data"]["evaluation_error"] = bool(error)
                    if not error:
                        item["data"]["feedback"] = output
                    item["revision"] += 1
                latest["session"]["revision"] += 1
                try:
                    await self.repo.save(user, latest, latest["session"]["version"])
                    return
                except WriteConflict:
                    continue
                except HTTPException as exc:
                    if exc.status_code != 503:
                        raise
        except (HTTPException, StopIteration):
            # Deleted sessions stay deleted. Failed saves leave a recoverable expired lease.
            return
