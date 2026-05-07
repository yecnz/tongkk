export type NodeData = { label: string; children: NodeData[] };

export function parseMindmapJson(text: string): NodeData | null {
  try {
    const s = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(s.slice(start, end + 1));
    if (typeof parsed.root !== "string") return null;
    return { label: parsed.root, children: coerce(parsed.children) };
  } catch {
    return null;
  }
}

function coerce(arr: unknown): NodeData[] {
  if (!Array.isArray(arr)) return [];
  return arr.flatMap(item => {
    if (typeof item !== "object" || !item) return [];
    const o = item as Record<string, unknown>;
    if (typeof o.label !== "string") return [];
    return [{ label: o.label, children: coerce(o.children) }];
  });
}
