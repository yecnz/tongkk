import asyncio
import io
import json
import logging
import threading
import zipfile
from pathlib import Path
from types import SimpleNamespace
import httpx
import pytest
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
import main
from conversion_jobs import ConversionLimiter


def test_running_jobs_bounded_and_queue_capped_before_acquire_yields():
    async def scenario():
        limiter=ConversionLimiter(1,1,1);release=asyncio.Event();entered=asyncio.Event();active=0;peak=0
        async def work():
            nonlocal active,peak
            active+=1;peak=max(peak,active);entered.set()
            await release.wait();active-=1;return 'done'
        first=asyncio.create_task(limiter.run('markdown','.pdf',work))
        second=asyncio.create_task(limiter.run('preview','.docx',work))
        await asyncio.sleep(0)
        with pytest.raises(HTTPException) as exc:await limiter.run('markdown','.pdf',work)
        assert exc.value.status_code==429 and exc.value.headers['Retry-After']=='5'
        await entered.wait();release.set()
        assert await asyncio.gather(first,second)==['done','done'] and peak==1
        assert limiter.outstanding==0
    asyncio.run(scenario())


def test_timeout_releases_queue_and_errors_release_slot(caplog):
    caplog.set_level(logging.INFO,logger='uvicorn.error.conversion')
    async def scenario():
        limiter=ConversionLimiter(1,1,.02);release=asyncio.Event();entered=asyncio.Event()
        async def work():entered.set();await release.wait()
        first=asyncio.create_task(limiter.run('preview','.pptx',work));await entered.wait()
        with pytest.raises(HTTPException) as exc:await limiter.run('markdown','.pdf',work)
        assert exc.value.status_code==429
        release.set();await first
        async def error():raise ValueError('private filename or body')
        with pytest.raises(ValueError):await limiter.run('preview','.docx',error)
        assert limiter.outstanding==0
        async def success():return 'ok'
        assert await limiter.run('markdown','.pdf',success)=='ok'
    asyncio.run(scenario())
    logs=[json.loads(r.message) for r in caplog.records if r.name=='uvicorn.error.conversion']
    assert any(r['status']=='queue_timeout' for r in logs)
    assert any(r['error_type']=='ValueError' for r in logs)
    assert 'private filename' not in str(logs)


def test_cancellation_holds_slot_until_real_thread_and_cleanup_complete(tmp_path):
    async def scenario():
        limiter=ConversionLimiter(1,0,1);started=threading.Event();release=threading.Event();path=tmp_path/'input.pdf'
        def slow():started.set();release.wait(2);assert path.exists()
        async def work():
            path.write_text('fixture')
            try:await run_in_threadpool(slow)
            finally:path.unlink()
        first=asyncio.create_task(limiter.run('markdown','.pdf',work))
        while not started.is_set():await asyncio.sleep(.001)
        first.cancel();await asyncio.sleep(0)
        with pytest.raises(HTTPException):await limiter.run('preview','.docx',work)
        assert path.exists() and not first.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):await first
        assert not path.exists() and limiter.outstanding==0
    asyncio.run(scenario())


def office():
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as archive:
        archive.writestr('[Content_Types].xml','<Types/>')
        archive.writestr('word/document.xml','<document/>')
    return out.getvalue()


def test_real_routes_share_limiter_skip_hits_and_cleanup(monkeypatch):
    paths=[];kinds=[]
    main.app.dependency_overrides[main.require_api_user]=lambda:{'id':'test'}
    async def wrapper(kind,suffix,work):
        kinds.append(kind)
        return await ConversionLimiter().run(kind,suffix,work)
    def convert(path):paths.append(path);assert Path(path).exists();return SimpleNamespace(text_content='문서 본문')
    def preview(path):paths.append(path);assert Path(path).exists();return b'%PDF-preview'
    monkeypatch.setattr(main,'run_conversion',wrapper)
    monkeypatch.setattr(main.convert_cache,'get_markdown',lambda key:None)
    monkeypatch.setattr(main.convert_cache,'set_markdown',lambda *args:None)
    monkeypatch.setattr(main.convert_cache,'get_preview',lambda key:None)
    monkeypatch.setattr(main.convert_cache,'set_preview',lambda *args:None)
    monkeypatch.setattr(main.md_converter,'convert',convert)
    monkeypatch.setattr(main,'_analyze_document_visuals',lambda *args:'')
    monkeypatch.setattr(main,'_convert_presentation_to_pdf',preview)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),base_url='http://test') as client:
            assert (await client.post('/convert',files={'file':('test.docx',office())})).json()['markdown']=='문서 본문'
            assert (await client.post('/preview/pdf',files={'file':('test.docx',office())})).content==b'%PDF-preview'
            monkeypatch.setattr(main.convert_cache,'get_markdown',lambda key:'cached')
            assert (await client.post('/convert',files={'file':('test.docx',office())})).json()['markdown']=='cached'
        assert kinds==['markdown','preview'] and paths and all(not Path(p).exists() for p in paths)
    try:asyncio.run(scenario())
    finally:main.app.dependency_overrides.clear()
