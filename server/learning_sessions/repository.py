"""The only production persistence path; no local/in-memory fallback."""
import os

import httpx

from config import SUPABASE_ANON_KEY, SUPABASE_URL
from .errors import fail


class WriteConflict(Exception):
    pass


class Repository:
    def __init__(self):
        self.key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    def available(self):
        if not self.key or not SUPABASE_URL:
            fail("SETUP_REQUIRED", "학습 세션 DB 연결 설정이 필요합니다. 서버 관리자에게 문의해주세요.", 503)

    async def _rpc(self, name: str, payload: dict):
        self.available()
        headers = {"apikey": self.key, "Content-Type": "application/json"}
        if not self.key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {self.key}"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/{name}", headers=headers, json=payload)
        except httpx.HTTPError:
            fail("DB_UNAVAILABLE", "학습 기록 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.", 503)
        if res.is_error:
            # Never forward SQL parameters, answer text, or provider responses.
            message = res.json().get("message", "") if "json" in res.headers.get("content-type", "") else ""
            if "LS_GRAPH_CYCLE" in message:
                fail("GRAPH_CYCLE", "선수 관계가 순환하거나 같은 개념과 충돌해요. 연결을 확인해주세요.", 409)
            if "LS_CONFLICT" in message or res.status_code == 409:
                raise WriteConflict()
            if "LS_BUSY" in message:
                fail("WORK_IN_PROGRESS", "진행 중인 AI 작업이 있습니다. 잠시 후 다시 시도해주세요.", 429)
            if "LS_SOURCE_CHANGED" in message:
                fail("SOURCE_CHANGED", "원문이 변경됐습니다. 학습 범위를 다시 선택해주세요.")
            if "LS_NOT_FOUND" in message:
                fail("NOT_FOUND", "자료 또는 학습 세션을 찾을 수 없습니다.", 404)
            fail("DB_UNAVAILABLE", "학습 기록을 저장하지 못했습니다. DB 설정을 확인해주세요.", 503)
        # returns void 함수(source_begin 등)는 204 빈 본문을 돌려준다.
        return res.json() if res.content else None

    async def material(self, user: str, token: str, course: str, material: str):
        self.available()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.get(f"{SUPABASE_URL}/rest/v1/materials", params={
                    "select": "id,course_id,user_id,name,markdown", "course_id": f"eq.{course}",
                    "id": f"eq.{material}", "user_id": f"eq.{user}", "limit": "1",
                }, headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"})
        except httpx.HTTPError:
            fail("DB_UNAVAILABLE", "원문을 불러오지 못했습니다.", 503)
        if res.is_error:
            fail("DB_UNAVAILABLE", "원문을 불러오지 못했습니다.", 503)
        rows = res.json()
        if not rows:
            fail("NOT_FOUND", "학습 자료를 찾을 수 없습니다.", 404)
        return rows[0]

    async def load(self, user, session):
        result = await self._rpc("learning_session_read", {"p_user": user, "p_session": session})
        if not result:
            fail("NOT_FOUND", "학습 세션을 찾을 수 없습니다.", 404)
        return result

    async def command(self, user, key):
        return await self._rpc("learning_session_find_command", {"p_user": user, "p_key": key})

    async def cached_pack(self, user, key):
        return await self._rpc("learning_session_cached_pack", {"p_user": user, "p_key": key})

    async def open_pack(self, user, key):
        return await self._rpc("learning_session_open", {"p_user": user, "p_key": key})

    async def listing(self, user, limit):
        return await self._rpc("learning_session_list", {"p_user": user, "p_limit": limit})

    async def save(self, user, bundle, expected_version):
        return await self._rpc("learning_session_write", {
            "p_user": user, "p_bundle": bundle, "p_expected_version": expected_version,
        })

    async def history(self, user, limit):
        return await self._rpc("learning_session_history", {"p_user": user, "p_limit": limit})
