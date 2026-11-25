"""User-confirmed equivalence preserves each source version and its evidence."""
import re
from uuid import UUID
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from typing import Literal
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.errors import fail

router = APIRouter(prefix='/learning-graph', tags=['learning-graph'])

def repository():
    return Repository()


def graph_view(value):
    nodes, links = value['nodes'], value['links']
    parents = {n['id']: n['id'] for n in nodes}
    def root(key):
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key
    for edge in links:
        if edge['relation'] == 'equivalent':
            a, b = root(edge['source_id']), root(edge['target_id'])
            parents[max(a, b)] = min(a, b)
    groups = {}
    for n in nodes:
        gid = root(n['id'])
        groups.setdefault(gid, {'id': gid, 'title': n['title'], 'members': [], 'evidence_count': 0})
        groups[gid]['members'].append(n)
        groups[gid]['evidence_count'] += n['evidence_count']
    prerequisites = sorted({(root(e['source_id']), root(e['target_id'])) for e in links if e['relation'] == 'prerequisite'})
    suggestions = []
    by_title = {}
    for n in nodes:
        if n['source_changed']:
            continue
        name = re.sub(r'\W+', '', n['title'].casefold())
        by_title.setdefault(name, {}).setdefault(root(n['id']), n)
    for matches in by_title.values():
        candidates = [matches[k] for k in sorted(matches)]
        if len(candidates) > 1:
            suggestions.extend({'source_id': candidates[0]['id'], 'target_id': n['id'], 'title': n['title']} for n in candidates[1:])
    recommendations = []
    for source, target in prerequisites:
        prerequisite = groups[source]
        if any(m['state'] in {'needs_review', 'needs_confirmation', 'awaiting_reassessment'} and not m['source_changed'] for m in prerequisite['members']) and any(m['state'] == 'needs_review' for m in groups[target]['members']):
            recommendations.append({'group_id': source, 'concept_id': next(m['id'] for m in prerequisite['members'] if not m['source_changed'] and m['state'] in {'needs_review','needs_confirmation','awaiting_reassessment'}), 'title': prerequisite['title'], 'reason': groups[target]['title'] + '의 선수 개념'})
    return {'groups': list(groups.values()), 'links': links, 'prerequisites': [{'source': a, 'target': b} for a,b in prerequisites], 'suggestions': suggestions[:20], 'recommendations': list({r['group_id']:r for r in recommendations}.values())[:5]}

class Link(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    source_id: UUID
    target_id: UUID
    relation: Literal['equivalent', 'prerequisite']

@router.get('')
async def read(auth=Depends(session_user), repo=Depends(repository)):
    return graph_view(await repo._rpc('learning_graph_read', {'p_user': auth[0]}))

@router.post('/links')
async def link(request: Link, auth=Depends(session_user), repo=Depends(repository)):
    try:
        await repo._rpc('learning_graph_link', {'p_user': auth[0], 'p_id': str(request.id), 'p_source': str(request.source_id), 'p_target': str(request.target_id), 'p_relation': request.relation})
    except WriteConflict:
        fail('CONFLICT', '연결할 개념과 관계를 다시 확인해주세요.', 409)
    return await read(auth, repo)

@router.delete('/links/{link_id}')
async def unlink(link_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    await repo._rpc('learning_graph_unlink', {'p_user': auth[0], 'p_id': str(link_id)})
    return await read(auth, repo)
