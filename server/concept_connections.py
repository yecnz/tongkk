"""Source-grounded connections and study order; never transfer mastery between sources."""
import re
from collections import defaultdict, deque

NEEDS_STUDY = {'unassessed', 'needs_review', 'needs_confirmation', 'awaiting_reassessment'}
PRIORITY = {'needs_review': 0, 'unassessed': 1, 'needs_confirmation': 2, 'awaiting_reassessment': 3, 'recent_stable': 4}


def normalized(text):
    return re.sub(r'\W+', '', text.casefold())


def automatic_connections(nodes):
    active = sorted((n for n in nodes if not n['source_changed']), key=lambda n: n['id'])
    aliases, related, definitions, source_units = {}, {}, {}, {}
    by_course = defaultdict(list)
    def connect(a, b, reason):
        if a['id'] == b['id']:
            return
        source, target = sorted((a['id'], b['id']))
        related[(source, target)] = {'source_id': source, 'target_id': target, 'relation': 'related',
                                    'origin': 'automatic', 'reason': reason}
    for n in active:
        name = normalized(n['title'])
        for ref in n.get('source_refs', []):
            quote = normalized(ref['quote'])
            # Identical names alone are insufficient: the cited definition must also match.
            if name and len(quote) >= 20:
                first = definitions.setdefault((name, quote), n)
                if first['id'] != n['id']:
                    pair = (first['id'], n['id'])
                    aliases[pair] = {'source_id': first['id'], 'target_id': n['id'], 'relation': 'equivalent',
                                     'origin': 'automatic', 'reason': '같은 이름과 원문 정의가 확인된 개념이에요.'}
            if n.get('course_id') and n.get('material_id') and n.get('source_hash'):
                key = (n['course_id'], n['material_id'], n['source_hash'], ref['unit_id'])
                first = source_units.setdefault(key, n)
                connect(first, n, '같은 원문 구간에서 함께 다루는 개념이에요.')
        if n.get('course_id'):
            by_course[n['course_id']].append(n)
    # Index literal titles once per course instead of comparing every pair of definitions.
    for members in by_course.values():
        titles = defaultdict(list)
        for n in members:
            if len(n['title'].strip()) >= 2:
                titles[n['title'].strip().casefold()].append(n)
        if not titles:
            continue
        pattern = re.compile(r'(?<![A-Za-z0-9])(?:' + '|'.join(re.escape(t) for t in sorted(titles, key=len, reverse=True)) + r')(?![A-Za-z0-9])', re.I)
        for n in members:
            for ref in n.get('source_refs', []):
                for mention in pattern.finditer(ref['quote']):
                    for other in titles.get(mention.group().casefold(), []):
                        connect(other, n, '원문에서 함께 설명되는 개념이에요.')
    return list(aliases.values()), list(related.values())


def make_graph(value):
    nodes = value['nodes']
    by_id = {n['id']: n for n in nodes}
    parents = {key: key for key in by_id}
    def root(key):
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key
    links = [dict(e, origin='saved') for e in value['links'] if e['source_id'] in by_id and e['target_id'] in by_id
             and not by_id[e['source_id']]['source_changed'] and not by_id[e['target_id']]['source_changed']]
    def merge(edge):
        a, b = root(edge['source_id']), root(edge['target_id'])
        parents[max(a, b)] = min(a, b)
    for edge in links:
        if edge['relation'] == 'equivalent':
            merge(edge)
    aliases, related = automatic_connections(nodes)
    def ordered_path(start, end):
        seen, todo = set(), [root(start)]
        while todo:
            key = todo.pop()
            if key == root(end):
                return True
            if key in seen:
                continue
            seen.add(key)
            todo.extend(root(e['target_id']) for e in links if e['relation'] == 'prerequisite' and root(e['source_id']) == key)
        return False
    for edge in aliases:
        if root(edge['source_id']) == root(edge['target_id']):
            continue
        if ordered_path(edge['source_id'], edge['target_id']) or ordered_path(edge['target_id'], edge['source_id']):
            continue
        merge(edge)
        links.append(edge)
    groups = {}
    for n in nodes:
        gid = root(n['id'])
        groups.setdefault(gid, {'id': gid, 'title': n['title'], 'members': [], 'evidence_count': 0})
        groups[gid]['members'].append({k: v for k, v in n.items() if k != 'source_refs'})
        groups[gid]['evidence_count'] += n['evidence_count']
    prerequisites = sorted({(root(e['source_id']), root(e['target_id'])) for e in links if e['relation'] == 'prerequisite' and root(e['source_id']) != root(e['target_id'])})
    connections = {}
    for e in related:
        a, b = sorted((root(e['source_id']), root(e['target_id'])))
        if a != b and (a, b) not in prerequisites and (b, a) not in prerequisites:
            connections[(a, b)] = {**e, 'source': a, 'target': b}
    recommendations = []
    for source, target in prerequisites:
        candidates = [m for m in groups[source]['members'] if not m['source_changed'] and m['state'] in NEEDS_STUDY]
        if candidates and any(m['state'] in NEEDS_STUDY and not m['source_changed'] for m in groups[target]['members']):
            member = min(candidates, key=lambda m: (PRIORITY.get(m['state'], 5), m['id']))
            recommendations.append({'group_id': source, 'concept_id': member['id'], 'title': groups[source]['title'], 'reason': groups[target]['title'] + '를 배우기 전에 확인할 기초 개념이에요.'})
    return {'groups': list(groups.values()), 'links': links, 'prerequisites': [{'source': a, 'target': b} for a, b in prerequisites],
            'connections': list(connections.values()), 'suggestions': [], 'recommendations': list({r['group_id']: r for r in recommendations}.values())[:5]}


def study_plan(graph, target_id=None):
    groups = {g['id']: g for g in graph['groups']}
    member_group = {m['id']: g['id'] for g in groups.values() for m in g['members'] if not m['source_changed']}
    if not member_group:
        return []
    adjacent = defaultdict(set)
    for edge in graph['prerequisites'] + graph['connections']:
        adjacent[edge['source']].add(edge['target'])
        adjacent[edge['target']].add(edge['source'])
    def representative(gid):
        return min((m for m in groups[gid]['members'] if not m['source_changed']), key=lambda m: (PRIORITY.get(m['state'], 5), m['id']))
    if target_id is None:
        target_group = min(set(member_group.values()), key=lambda gid: (PRIORITY.get(representative(gid)['state'], 5), -len(adjacent[gid]), gid))
        target_id = representative(target_group)['id']
    elif target_id not in member_group:
        return []
    target_group = member_group[target_id]
    # Bounded connected neighbourhood; prerequisite ancestors remain before dependants.
    distance, queue = {target_group: 0}, deque([target_group])
    while queue and len(distance) < 12:
        gid = queue.popleft()
        neighbours = sorted(adjacent[gid], key=lambda g: (PRIORITY.get(representative(g)['state'], 5), g))
        for other in neighbours:
            if other not in distance and len(distance) < 12:
                distance[other] = distance[gid] + 1
                queue.append(other)
    remaining, ordered = set(distance), []
    while remaining:
        ready = [g for g in remaining if not any(e['target'] == g and e['source'] in remaining for e in graph['prerequisites'])]
        if not ready:  # Reject cyclic legacy data rather than inventing a learning order.
            return []
        gid = min(ready, key=lambda g: (PRIORITY.get(representative(g)['state'], 5), distance[g], g))
        remaining.remove(gid)
        member = representative(gid)
        if gid == target_group:
            member = next(m for m in groups[gid]['members'] if m['id'] == target_id)
        if member['state'] == 'recent_stable' and gid != target_group:
            continue
        incoming = any(e['source'] == gid and e['target'] in distance for e in graph['prerequisites'])
        ordered.append({'concept_id': member['id'], 'title': member['title'], 'course_name': member.get('course_name', ''),
                        'material_name': member.get('material_name', ''), 'is_target': gid == target_group, 'reason': '다음 개념에 필요한 기초부터 확인해요.' if incoming else '관련 개념을 설명하고 이해를 확인해요.'})
    return ordered
