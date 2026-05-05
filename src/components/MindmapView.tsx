import { useState, useMemo } from "react";
import { CYAN } from "../common";

type NodeData = { label: string; children: NodeData[] };
type LayoutNode = {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  children: LayoutNode[];
  hasChildren: boolean;
};

const NODE_W = 162;
const NODE_H = 38;
const H_GAP = 68;
const V_GAP = 14;
const PAD = 20;

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

function layoutTree(
  node: NodeData,
  depth: number,
  leafIdx: number,
  id: string,
  collapsed: Set<string>,
): [LayoutNode, number] {
  const x = PAD + depth * (NODE_W + H_GAP);
  if (collapsed.has(id) || node.children.length === 0) {
    return [
      { id, label: node.label, depth, x, y: PAD + leafIdx * (NODE_H + V_GAP), children: [], hasChildren: node.children.length > 0 },
      leafIdx + 1,
    ];
  }
  const kids: LayoutNode[] = [];
  let cur = leafIdx;
  node.children.forEach((child, i) => {
    const [k, next] = layoutTree(child, depth + 1, cur, `${id}.${i}`, collapsed);
    kids.push(k);
    cur = next;
  });
  const midY = (kids[0].y + kids[kids.length - 1].y) / 2;
  return [{ id, label: node.label, depth, x, y: midY, children: kids, hasChildren: true }, cur];
}

function flatNodes(node: LayoutNode): LayoutNode[] {
  return [node, ...node.children.flatMap(flatNodes)];
}

function flatEdges(node: LayoutNode): Array<[LayoutNode, LayoutNode]> {
  return node.children.flatMap(c => [[node, c] as [LayoutNode, LayoutNode], ...flatEdges(c)]);
}

const DEPTH_COLORS = [
  { bg: "#EDE9FF", border: "#C4B5FD", text: "#5B21B6" },
  { bg: "#f5f5f5", border: "#e0e0e0", text: "#333" },
  { bg: "#E0F5F7", border: `${CYAN}60`, text: "#0E7490" },
];

export function MindmapView({ data }: { data: NodeData }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [root] = useMemo(
    () => layoutTree(data, 0, 0, "root", collapsed),
    [data, collapsed],
  );

  const nodes = flatNodes(root);
  const edges = flatEdges(root);

  const svgW = Math.max(...nodes.map(n => n.x + NODE_W)) + PAD;
  const svgH = Math.max(...nodes.map(n => n.y + NODE_H)) + PAD;

  return (
    <div style={{ position: "relative", width: svgW, height: svgH }}>
      <svg
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        width={svgW}
        height={svgH}
      >
        {edges.map(([p, c], i) => {
          const sx = p.x + NODE_W, sy = p.y + NODE_H / 2;
          const tx = c.x, ty = c.y + NODE_H / 2;
          const mx = (sx + tx) / 2;
          return (
            <path
              key={i}
              d={`M${sx} ${sy} C${mx} ${sy},${mx} ${ty},${tx} ${ty}`}
              fill="none"
              stroke="#CBD5E1"
              strokeWidth={1.5}
            />
          );
        })}
      </svg>

      {nodes.map(node => {
        const c = DEPTH_COLORS[Math.min(node.depth, 2)];
        return (
          <div
            key={node.id}
            style={{
              position: "absolute",
              left: node.x,
              top: node.y,
              width: NODE_W,
              height: NODE_H,
              background: c.bg,
              border: `1.5px solid ${c.border}`,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              paddingLeft: 12,
              paddingRight: node.hasChildren ? 4 : 12,
              gap: 4,
              boxSizing: "border-box",
            }}
          >
            <span style={{
              flex: 1,
              fontSize: 13,
              fontWeight: node.depth === 0 ? 700 : 500,
              color: c.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {node.label}
            </span>
            {node.hasChildren && (
              <button
                onClick={() => toggle(node.id)}
                style={{
                  background: "rgba(0,0,0,0.06)",
                  border: "none",
                  borderRadius: 6,
                  width: 22,
                  height: 22,
                  cursor: "pointer",
                  fontSize: 12,
                  color: "#888",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {collapsed.has(node.id) ? "›" : "‹"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
