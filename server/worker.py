"""Durable learning worker. Run separately with: python -m worker [--once]."""
import argparse
import asyncio
import logging
import signal
from learning_sessions.repository import Repository
from learning_sessions.service import Service, concept_for
from learning_sessions.generation import Generator
from workflow import durable_enabled

logger = logging.getLogger('tongkk.worker')


async def run_one(repo=None, generator=None):
    repo = repo or Repository()
    job = await repo._rpc('workflow_claim', {})
    if not job:
        return False
    feedback, metrics, error = None, {}, None
    try:
        if job['kind'] == 'session':
            await Service(repository=repo, generator=generator).run(job['user_id'], job['session_id'], job['target_id'])
        elif job['kind'] == 'review':
            ctx = await repo._rpc('review_context', {'p_user': job['user_id'], 'p_card': job['review_card_id']})
            entry = next(a for a in ctx['attempts'] if a['id'] == job['target_id'])
            if ctx['source_changed']:
                error = 'SOURCE_CHANGED'
            else:
                feedback, metrics = await (generator or Generator()).evaluate(ctx['pack'], ctx['concept'], entry['answer'])
        elif job['kind'] == 'revision':
            ctx = await repo._rpc('explanation_read', {'p_user': job['user_id'], 'p_id': job['revision_id']})
            r = ctx['revision']
            if ctx['source_changed']:
                error = 'SOURCE_CHANGED'
            else:
                bundle = await repo.load(job['user_id'], r['session_id'])
                item = next(i for i in bundle['items'] if i['id'] == r['item_id'])
                feedback, metrics = await (generator or Generator()).evaluate(bundle['pack'], concept_for(bundle, item), r['answer'])
        else:
            error = 'UNSUPPORTED_JOB'
    except Exception as exc:
        error, metrics = 'WORKER_FAILED', getattr(exc, 'metrics', {})
        logger.warning('job_failed kind=%s error_type=%s', job['kind'], type(exc).__name__)
    await repo._rpc('workflow_complete', {'p_job': job['id'], 'p_token': job['lease_token'],
        'p_feedback': feedback, 'p_metrics': metrics, 'p_error': error})
    return True


async def main(once=False):
    if not durable_enabled():
        raise SystemExit('Set LEARNING_WORKER_ENABLED=true on both API and worker before starting.')
    repo = Repository()
    repo.available()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    while not stop.is_set():
        try:
            processed = await run_one(repo)
        except Exception as exc:
            logger.warning('worker_unavailable error_type=%s', type(exc).__name__)
            processed = False
        if once:
            return
        if not processed:
            try:
                await asyncio.wait_for(stop.wait(), timeout=2)
            except TimeoutError:
                pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main(args.once))
