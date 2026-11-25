"""Per-provider-call telemetry. No prompts, answers, tokens/keys or error text are stored."""
import json
import logging
import math
import os
import sqlite3
import time
from contextvars import ContextVar
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from langchain_core.callbacks import BaseCallbackHandler

log = logging.getLogger('tongkk.usage')
request_usage = ContextVar('request_usage', default=None)
FEATURES = {'summarize': 'summary', 'quiz': 'quiz', 'grade': 'grading', 'wrong': 'wrong_analysis',
            'study-plan': 'planning', 'agent': 'tutor', 'convert': 'document_vision', 'preview': 'document_vision', 'vision': 'document_vision',
            'learning-sessions': 'learning', 'reviews': 'review', 'flashcards': 'flashcards',
            'study-paths': 'study_path'}


class UsageMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path = scope.get('path', '').strip('/')
        feature = {'quiz/grade-subjective':'grading', 'quiz/analyze-wrong':'wrong_analysis'}.get(path, FEATURES.get(path.split('/')[0], 'other'))
        token = request_usage.set({'owner': None, 'feature': feature, 'request_id': str(uuid4())})
        try:
            await self.app(scope, receive, send)
        finally:
            request_usage.reset(token)


def identify(owner):
    context = request_usage.get()
    if context is not None:
        context['owner'] = owner


@contextmanager
def connect():
    path = Path(os.getenv('AI_USAGE_DB', str(Path(__file__).with_name('ai_usage.sqlite3'))))
    db = sqlite3.connect(path, timeout=5)
    db.execute('pragma journal_mode=WAL')
    db.execute('''create table if not exists ai_calls (
      id text primary key, owner text, request_id text, feature text not null, model text not null,
      created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      duration_ms integer not null, failed integer not null, input_tokens integer, output_tokens integer,
      estimated_usd real)''')
    db.execute('create index if not exists ai_calls_owner_time on ai_calls(owner,created_at)')
    try:
        yield db
        db.commit()
    finally:
        db.close()


def token_count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def estimate(model, input_tokens, output_tokens):
    if input_tokens is None or output_tokens is None:
        return None
    try:
        price = json.loads(os.getenv('AI_MODEL_PRICES_JSON', '{}')).get(model)
        if not price:
            return None
        rates = [float(price[key]) for key in ('input_per_million', 'output_per_million')]
        if any(not math.isfinite(rate) or rate < 0 for rate in rates):
            return None
        return (input_tokens*rates[0]+output_tokens*rates[1])/1_000_000
    except (ValueError, TypeError, KeyError, AttributeError):
        return None


def record(model, started, failed=False, usage=None, context=None, feature=None):
    context = context if context is not None else (request_usage.get() or {})
    usage = usage or {}
    inp = token_count(usage.get('input_tokens', usage.get('prompt_tokens')))
    out = token_count(usage.get('output_tokens', usage.get('completion_tokens')))
    try:
        with connect() as db:
            db.execute('insert into ai_calls(id,owner,request_id,feature,model,duration_ms,failed,input_tokens,output_tokens,estimated_usd) values(?,?,?,?,?,?,?,?,?,?)',
                       (str(uuid4()), context.get('owner'), context.get('request_id'), feature or context.get('feature', 'other'),
                        model, max(0, int((time.monotonic()-started)*1000)), int(failed), inp, out, estimate(model, inp, out)))
    except (sqlite3.Error, OSError):
        # A telemetry outage must never turn a paid successful request into a retry.
        log.warning('AI usage storage unavailable')


class UsageCallback(BaseCallbackHandler):
    run_inline = True

    def __init__(self, model):
        self.model = model
        self.context = dict(request_usage.get() or {})
        self.started = {}

    def on_chat_model_start(self, serialized, messages, *, run_id, **kwargs):
        self.started[run_id] = time.monotonic()

    def on_llm_start(self, serialized, prompts, *, run_id, **kwargs):
        self.started[run_id] = time.monotonic()

    def on_llm_end(self, response, *, run_id, **kwargs):
        started = self.started.pop(run_id, None)
        if started is None:
            return
        output = response.llm_output or {}
        usage = output.get('token_usage') or output.get('usage') or {}
        model = output.get('model_name') or self.model
        for generations in response.generations:
            for generation in generations:
                message = getattr(generation, 'message', None)
                if message:
                    usage = getattr(message, 'usage_metadata', None) or usage
                    model = (getattr(message, 'response_metadata', {}) or {}).get('model_name') or model
        record(model, started, usage=usage, context=self.context)

    def on_llm_error(self, error, *, run_id, **kwargs):
        started = self.started.pop(run_id, None)
        if started is not None:
            record(self.model, started, failed=True, context=self.context)


def track_generation(function):
    """Wrap raw SDK prepare/evaluate, including output validation failures."""
    from functools import wraps

    @wraps(function)
    async def tracked(self, *args, **kwargs):
        started, metrics, failed = time.monotonic(), {}, False
        context_feature = (request_usage.get() or {}).get('feature')
        feature = 'study_path' if context_feature == 'study_path' and function.__name__ == 'draft' else 'review_question' if function.__name__ == 'review_question' else 'learning_prepare' if function.__name__ == 'prepare' else ('review_grade' if context_feature in {'review', 'learning_review'} else 'explanation_grade' if context_feature == 'learning_revision' else 'learning_grade')
        try:
            result, metrics = await function(self, *args, **kwargs)
            return result, metrics
        except BaseException as exc:
            failed = True
            metrics = getattr(exc, 'metrics', {})
            raise
        finally:
            record(metrics.get('model_id') or self.model, started, failed=failed, usage=metrics.get('usage'), feature=feature)
    return tracked


def summary(owner):
    with connect() as db:
        db.row_factory = sqlite3.Row
        return [dict(row) for row in db.execute('''select feature,model,count(*) calls,sum(failed) failures,
          round(avg(duration_ms)) average_ms,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,
          sum(estimated_usd) estimated_usd,count(estimated_usd) priced_calls,
          count(input_tokens) token_known_calls from ai_calls where owner=? and created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
          group by feature,model order by calls desc,feature,model''', (owner,))]
