"""Bound heavy conversions per worker, including work continuing after cancellation."""
import asyncio
import json
import logging
import os
import time
import weakref
from fastapi import HTTPException
from usage import request_usage

logger = logging.getLogger('uvicorn.error.conversion')


def env_number(name, default, minimum, maximum):
    try: value = float(os.getenv(name, str(default)))
    except ValueError: return default
    return min(maximum, max(minimum, value)) if value == value else default


def event(kind, suffix, status, started, waited=0, error=None):
    context = request_usage.get() or {}
    cause = getattr(error, '__cause__', None) or error
    logger.info(json.dumps({'event':'conversion','request_id':context.get('request_id'), 'kind':kind,
                           'extension':suffix,'status':status,'wait_ms':int(waited*1000),
                           'duration_ms':max(0,int((time.monotonic()-started-waited)*1000)),
                           'total_ms':int((time.monotonic()-started)*1000),
                           'error_type':type(cause).__name__ if cause else None}, ensure_ascii=False))


class ConversionLimiter:
    def __init__(self, limit=1, max_waiters=4, timeout=10):
        self.semaphore = asyncio.BoundedSemaphore(limit)
        self.limit, self.max_waiters, self.timeout, self.waiters, self.outstanding = limit, max_waiters, timeout, 0, 0

    async def run(self, kind, suffix, work):
        started = time.monotonic()
        if self.outstanding >= self.limit + self.max_waiters:
            event(kind,suffix,'queue_full',started)
            raise HTTPException(429,'변환 요청이 많아요. 잠시 후 다시 시도해주세요.',headers={'Retry-After':'5'})
        self.waiters += 1
        self.outstanding += 1
        acquired = False
        try:
            try:
                await asyncio.wait_for(self.semaphore.acquire(), timeout=self.timeout)
                acquired = True
            except TimeoutError:
                event(kind,suffix,'queue_timeout',started,time.monotonic()-started)
                raise HTTPException(429,'다른 문서를 처리 중이에요. 잠시 후 다시 시도해주세요.',headers={'Retry-After':'5'}) from None
            except asyncio.CancelledError:
                event(kind,suffix,'cancelled_wait',started)
                raise
        finally:
            self.waiters -= 1
            if not acquired:
                self.outstanding -= 1
        waited = time.monotonic()-started
        async def execute():
            try:
                result = await work()
                event(kind,suffix,'completed',started,waited)
                return result
            except BaseException as exc:
                event(kind,suffix,'failed',started,waited,exc)
                raise
            finally:
                self.semaphore.release()
                self.outstanding -= 1
        task = asyncio.create_task(execute())
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            # run_in_threadpool cannot stop LibreOffice/OCR. Keep its slot and input
            # files until the real work is finished, even if the client disconnects.
            while not task.done():
                try: await asyncio.shield(task)
                except asyncio.CancelledError: continue
                except BaseException: break
            if not task.cancelled():
                task.exception()  # retrieve failures even when the caller has gone
            event(kind,suffix,'caller_cancelled',started,waited)
            raise


_limiters = weakref.WeakKeyDictionary()


def limiter():
    loop = asyncio.get_running_loop()
    if loop not in _limiters:
        _limiters[loop] = ConversionLimiter(int(env_number('CONVERSION_MAX_CONCURRENT',1,1,8)),
                                          int(env_number('CONVERSION_MAX_WAITERS',4,0,32)),
                                          env_number('CONVERSION_WAIT_SECONDS',10,.01,60))
    return _limiters[loop]


async def run_conversion(kind, suffix, work):
    return await limiter().run(kind,suffix,work)


def cache_hit(kind,suffix):
    event(kind,suffix,'cache_hit',time.monotonic())
