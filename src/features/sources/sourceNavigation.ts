import type { CourseMaterial } from '../../services/materials';

export type SourceTarget = { courseName: string; materialId?: string; page: number; sourceHash?: string; updatedAt?: number; candidates?: string[] };
export type CitationScope = { courseName: string; materials: Pick<CourseMaterial, 'id' | 'name' | 'updatedAt'>[]; materialIds: string[]; sourceHashes?: Record<string, string> };

export function parseSourcePage(value: string | number | null): number | null {
  if (value === null || !/^\d+$/.test(String(value))) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : null;
}

export function buildSourceUrl({ courseName, materialId, page, sourceHash, updatedAt, candidates = [] }: SourceTarget): string {
  const query = new URLSearchParams({ course: courseName, page: String(page) });
  if (materialId) query.set('material', materialId);
  if (sourceHash) query.set('hash', sourceHash);
  if (updatedAt) query.set('version', String(updatedAt));
  if (!materialId) [...new Set(candidates)].forEach(id => query.append('candidate', id));
  return `/source?${query}`;
}

// A bare p.N in a combined answer requires a choice. Never silently use the first file.
export function resolveCitationTarget(textBeforePage: string, page: number, scope: CitationScope): SourceTarget | null {
  if (!scope.courseName || !scope.materialIds.length || !parseSourcePage(page)) return null;
  const materials = scope.materials.filter(item => scope.materialIds.includes(item.id));
  const segment = textBeforePage.split(/[;\n]|\(\s*출처\s*:/).at(-1) || '';
  const normalized = segment.toLocaleLowerCase();
  const fileMentions = [...segment.matchAll(/\.(?:pdf|pptx?|docx?|txt|md|png|jpe?g|webp)\b/gi)];
  const lastFile = fileMentions.at(-1);
  const lastFileEnd = lastFile ? lastFile.index! + lastFile[0].length : 0;
  const named = materials.flatMap(item => {
    const index = normalized.lastIndexOf(item.name.toLocaleLowerCase());
    const end = index + item.name.length;
    // Distinguish 1강.pdf from 11강.pdf and avoid carrying a previous file into a later citation.
    if (index < 0 || end < lastFileEnd || /[\p{L}\p{N}_.-]/u.test(segment[index - 1] || '') || /[\p{L}\p{N}_.-]/u.test(segment[end] || '')) return [];
    return [{ material: item, end, length: item.name.length }];
  }).sort((a, b) => b.end - a.end || b.length - a.length);
  const first = named[0];
  const matching = first && !named.some((item, index) => index > 0 && item.end === first.end && item.length === first.length) ? first.material : null;
  const sole = scope.materialIds.length === 1 ? materials.find(item => item.id === scope.materialIds[0]) : null;
  // A different explicit filename must not become a link to the only surviving file.
  const mentionsFile = fileMentions.length > 0;
  const material = matching || (!mentionsFile ? sole : null);
  return material
    ? { courseName: scope.courseName, materialId: material.id, page, updatedAt: material.updatedAt, sourceHash: scope.sourceHashes?.[material.id] }
    : { courseName: scope.courseName, page, candidates: scope.materialIds };
}

export function sourcePageExcerpt(markdown: string, page: number): string | null {
  const markers = [...markdown.matchAll(/<!--\s*(?:p\.|Slide number:\s*)(\d+)\s*-->/g)];
  const index = markers.findIndex(marker => Number(marker[1]) === page);
  if (index < 0) return null;
  const marker = markers[index];
  return markdown.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? markdown.length).trim();
}

type MarkdownNode = { type: string; value?: string; url?: string; title?: string; children?: MarkdownNode[] };
export function remarkSourceCitations(scope: CitationScope) {
  return (tree: MarkdownNode) => {
    const plainText = (node: MarkdownNode): string => node.value || node.children?.map(plainText).join('') || '';
    function walk(parent: MarkdownNode, inheritedPrefix = '') {
      if (!parent.children || ['link', 'linkReference', 'code', 'inlineCode', 'html', 'math', 'inlineMath'].includes(parent.type)) return;
      const children: MarkdownNode[] = [];
      let prefix = inheritedPrefix;
      for (const child of parent.children) {
        if (child.type !== 'text' || !child.value) {
          walk(child, ['strong', 'emphasis', 'delete'].includes(child.type) ? prefix : ''); children.push(child);
          prefix += plainText(child);
          continue;
        }
        let cursor = 0;
        const value = child.value;
        for (const match of value.matchAll(/\bpp?\.\s*(\d+)(?:\s*[-–~]\s*(?:pp?\.\s*)?\d+)?/gi)) {
          const target = resolveCitationTarget(prefix + value.slice(0, match.index), Number(match[1]), scope);
          if (!target) continue;
          if (match.index! > cursor) children.push({ type: 'text', value: value.slice(cursor, match.index) });
          children.push({ type: 'link', url: buildSourceUrl(target), title: target.materialId ? `원문 ${match[0]} 열기 (새 탭)` : `원문 자료 선택 · ${match[0]} (새 탭)`, children: [{ type: 'text', value: match[0] }] });
          cursor = match.index! + match[0].length;
        }
        if (cursor < value.length) children.push({ type: 'text', value: value.slice(cursor) });
        prefix += value;
      }
      parent.children = children;
    }
    walk(tree);
  };
}
