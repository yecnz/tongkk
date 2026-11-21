import agent


def test_oldest_thread_evicted(monkeypatch):
    monkeypatch.setattr(agent, "MAX_THREADS", 2)
    monkeypatch.setattr(agent, "_recent_threads", agent.OrderedDict())
    deleted = []
    monkeypatch.setattr(agent.CHECKPOINTER, "delete_thread", deleted.append)

    for key in ["a", "b", "a", "c"]:
        agent._touch_thread(key)

    assert deleted == ["b"]  # a는 다시 사용돼 최신, b가 가장 오래됨
    assert list(agent._recent_threads) == ["a", "c"]


def test_thread_exists_only_with_checkpoint():
    # 서버 재시작 직후처럼 체크포인트가 없으면 False → /agent가 409로 히스토리 재전송을 요구한다.
    assert not agent.thread_exists("u1", "missing-thread")
