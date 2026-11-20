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
