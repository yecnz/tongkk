import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import html2canvas from "html2canvas";
import { CYAN } from "../common";
import type { NodeData } from "./mindmapData";

type LayoutNode = {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  children: LayoutNode[];
  hasChildren: boolean;
  dir: number; // 펼침 방향: 1=오른쪽, -1=왼쪽, 0=루트
};

type Offset = { dx: number; dy: number };
type OffsetMap = Record<string, Offset>;

const NODE_W = 162;
const NODE_H = 38;
const H_GAP = 68;
const V_GAP = 14;
const PAD = 20;

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const STORE_PREFIX = "tongkk:mindmap-offsets:";

// 한 방향(dir=1 오른쪽 / -1 왼쪽)으로만 뻗는 서브트리를 배치한다. 좌표는 루트(0,0) 기준 상대값.
function layoutDir(
  node: NodeData,
  depth: number,
  leafIdx: number,
  id: string,
  collapsed: Set<string>,
  dir: number,
): [LayoutNode, number] {
  const x = dir * depth * (NODE_W + H_GAP);
  if (collapsed.has(id) || node.children.length === 0) {
    return [
      { id, label: node.label, depth, x, y: leafIdx * (NODE_H + V_GAP), children: [], hasChildren: node.children.length > 0, dir },
      leafIdx + 1,
    ];
  }
  const kids: LayoutNode[] = [];
  let cur = leafIdx;
  node.children.forEach((child, i) => {
    const [k, next] = layoutDir(child, depth + 1, cur, `${id}.${i}`, collapsed, dir);
    kids.push(k);
    cur = next;
  });
  const midY = (kids[0].y + kids[kids.length - 1].y) / 2;
  return [{ id, label: node.label, depth, x, y: midY, children: kids, hasChildren: true, dir }, cur];
}

function shiftTree(node: LayoutNode, dx: number, dy: number) {
  node.x += dx;
  node.y += dy;
  node.children.forEach(c => shiftTree(c, dx, dy));
}

// 루트의 1단계 자식을 좌/우로 나눠 양방향으로 펼친다(앞 절반 오른쪽, 뒤 절반 왼쪽).
function layoutBidirectional(data: NodeData, collapsed: Set<string>): LayoutNode {
  const rootId = "root";
  if (collapsed.has(rootId) || data.children.length === 0) {
    return { id: rootId, label: data.label, depth: 0, x: 0, y: 0, children: [], hasChildren: data.children.length > 0, dir: 0 };
  }
  const n = data.children.length;
  const rightCount = Math.ceil(n / 2);

  const rightKids: LayoutNode[] = [];
  let cur = 0;
  for (let i = 0; i < rightCount; i++) {
    const [k, next] = layoutDir(data.children[i], 1, cur, `${rootId}.${i}`, collapsed, 1);
    rightKids.push(k);
    cur = next;
  }
  const rightLeaves = Math.max(cur, 1);

  const leftKids: LayoutNode[] = [];
  cur = 0;
  for (let i = rightCount; i < n; i++) {
    const [k, next] = layoutDir(data.children[i], 1, cur, `${rootId}.${i}`, collapsed, -1);
    leftKids.push(k);
    cur = next;
  }
  const leftLeaves = Math.max(cur, 1);

  // 양쪽 그룹을 공통 세로 중심에 맞춰 루트를 가운데에 둔다.
  const rowH = NODE_H + V_GAP;
  const rightH = rightLeaves * rowH;
  const leftH = leftLeaves * rowH;
  const center = Math.max(rightH, leftH) / 2;
  rightKids.forEach(k => shiftTree(k, 0, center - rightH / 2));
  leftKids.forEach(k => shiftTree(k, 0, center - leftH / 2));

  return {
    id: rootId,
    label: data.label,
    depth: 0,
    x: 0,
    y: center - NODE_H / 2,
    children: [...rightKids, ...leftKids],
    hasChildren: true,
    dir: 0,
  };
}

// 사용자가 끌어 둔 오프셋을 자동 좌표에 누적 적용한다. 부모를 옮기면 서브트리가 함께 따라온다.
function applyOffsets(node: LayoutNode, offsets: OffsetMap, accDx = 0, accDy = 0) {
  const o = offsets[node.id];
  const dx = accDx + (o ? o.dx : 0);
  const dy = accDy + (o ? o.dy : 0);
  node.x += dx;
  node.y += dy;
  node.children.forEach(c => applyOffsets(c, offsets, dx, dy));
}

// 음수 좌표(왼쪽 가지·왼쪽으로 끈 노드)를 PAD 기준 양수 좌표로 정규화한다.
function normalizeTree(root: LayoutNode): LayoutNode {
  const all = flatNodes(root);
  const minX = Math.min(...all.map(n => n.x));
  const minY = Math.min(...all.map(n => n.y));
  shiftTree(root, PAD - minX, PAD - minY);
  return root;
}

function flatNodes(node: LayoutNode): LayoutNode[] {
  return [node, ...node.children.flatMap(flatNodes)];
}

function flatEdges(node: LayoutNode): Array<[LayoutNode, LayoutNode]> {
  return node.children.flatMap(c => [[node, c] as [LayoutNode, LayoutNode], ...flatEdges(c)]);
}

function collapsibleIds(node: NodeData, id = "root"): string[] {
  if (node.children.length === 0) return [];
  return [id, ...node.children.flatMap((child, index) => collapsibleIds(child, `${id}.${index}`))];
}

// 점표기 id로 서브트리 루트를 찾는다(포커스 모드용). collapsed/toggle와 같은 id 체계를 유지한다.
function findNodeById(node: NodeData, targetId: string, id = "root"): NodeData | null {
  if (id === targetId) return node;
  for (let i = 0; i < node.children.length; i++) {
    const found = findNodeById(node.children[i], targetId, `${id}.${i}`);
    if (found) return found;
  }
  return null;
}

// 루트부터 해당 노드까지의 라벨 경로(점표기 id 기준). 예: ["서비스 서버","다수데이터운영","트래픽 대응"]
function nodePathLabels(root: NodeData, id: string): string[] {
  const parts = id.split(".");
  const labels: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const found = findNodeById(root, parts.slice(0, i).join("."));
    if (found) labels.push(found.label);
  }
  return labels;
}

function loadOffsets(persistKey?: string): OffsetMap {
  if (!persistKey) return {};
  try {
    return JSON.parse(localStorage.getItem(STORE_PREFIX + persistKey) || "{}");
  } catch {
    return {};
  }
}

const DEPTH_COLORS = [
  { bg: "var(--color-tint-violet)", border: "color-mix(in srgb, var(--color-violet) 45%, transparent)", text: "var(--color-violet-deep)" },
  { bg: "var(--color-muted-surface)", border: "var(--color-border-soft)", text: "var(--color-text-strong)" },
  { bg: "var(--color-tint-cyan)", border: "color-mix(in srgb, var(--color-cyan) 38%, transparent)", text: "var(--color-cyan-deep)" },
  { bg: "var(--color-surface)", border: "var(--color-border-soft)", text: "var(--color-text)" },
];

const toolBtn: CSSProperties = {
  height: 30,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border-soft)",
  background: "var(--color-card)",
  color: "var(--color-text)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  flexShrink: 0,
};
const iconBtn: CSSProperties = { ...toolBtn, width: 30, padding: 0, fontSize: 16, lineHeight: 1 };
const divider: CSSProperties = { width: 1, height: 18, background: "var(--color-border-soft)", margin: "0 2px", flexShrink: 0 };

type MindmapViewProps = {
  data: NodeData;
  // 노드를 포커스(단독 학습)할 때 부모에 알린다. 부모는 이 정보로 AI 튜터를 옆에 띄운다.
  // pathLabels는 루트부터 이 노드까지의 라벨 경로 — 튜터 질문에 마인드맵 흐름을 싣는 데 쓴다.
  onNodeFocus?: (label: string, pathLabels: string[]) => void;
  // PDF 캡처용 정적 렌더. 툴바·pan/zoom 없이 전체 트리를 그대로 그린다.
  printMode?: boolean;
  // 사용자가 끌어 둔 노드 위치를 localStorage에 저장할 키(보통 요약 id). 없으면 세션 메모리에만 유지.
  persistKey?: string;
};

export function MindmapView({ data, onNodeFocus, printMode = false, persistKey }: MindmapViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(collapsibleIds(data)));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tf, setTf] = useState({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [offsets, setOffsets] = useState<OffsetMap>(() => loadOffsets(persistKey));
  const [studyMode, setStudyMode] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  const nodeDragRef = useRef<{ id: string; sx: number; sy: number; bx: number; by: number } | null>(null);
  const movedRef = useRef(false);

  const toggle = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 끌어 둔 위치를 localStorage에 저장한다(persistKey가 있을 때만).
  useEffect(() => {
    if (!persistKey) return;
    try {
      if (Object.keys(offsets).length) localStorage.setItem(STORE_PREFIX + persistKey, JSON.stringify(offsets));
      else localStorage.removeItem(STORE_PREFIX + persistKey);
    } catch {
      // 저장 실패는 무시(프라이빗 모드 등)
    }
  }, [offsets, persistKey]);

  // 포커스된 노드를 루트로 삼아 레이아웃한다. 못 찾으면(데이터 교체 등) 전체를 그린다.
  const focusNode = focusId ? findNodeById(data, focusId) : null;
  const activeId = focusNode ? (focusId as string) : "root";

  const root = useMemo(() => {
    // 포커스 중에는 그 서브트리를 한 방향(오른쪽)으로 단독 렌더한다(오프셋 미적용).
    if (focusNode) {
      const [r] = layoutDir(focusNode, 0, 0, activeId, collapsed, 1);
      return normalizeTree(r);
    }
    // 전체 보기에서는 좌/우 양방향으로 펼치고, 사용자 오프셋을 입힌 뒤 다시 정규화한다.
    const r = normalizeTree(layoutBidirectional(data, collapsed));
    applyOffsets(r, offsets);
    return normalizeTree(r);
  }, [focusNode, activeId, collapsed, data, offsets]);

  const nodes = flatNodes(root);
  const edges = flatEdges(root);

  const svgW = Math.max(...nodes.map(n => n.x + NODE_W)) + PAD;
  const svgH = Math.max(...nodes.map(n => n.y + NODE_H)) + PAD;

  // 휠 줌: React onWheel은 passive라 preventDefault가 막히므로 native 리스너로 등록한다.
  useEffect(() => {
    if (printMode) return;
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setTf(t => {
        const k = clamp(t.k * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
        const ratio = k / t.k;
        // 커서 아래 좌표를 고정한 채 확대/축소한다.
        return { k, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [printMode]);

  const resetView = () => setTf({ x: 0, y: 0, k: 1 });

  // 뷰포트 중심을 기준으로 한 단계 확대/축소(버튼용).
  const zoomBy = (factor: number) =>
    setTf(t => {
      const k = clamp(t.k * factor, MIN_SCALE, MAX_SCALE);
      const rect = viewportRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      const ratio = k / t.k;
      return { k, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio };
    });

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const ids = new Set(collapsibleIds(data));
    if (focusId) ids.delete(focusId); // 포커스 중이면 그 루트는 펼친 채로 둬 직속 자식이 보이게 한다.
    setCollapsed(ids);
  };

  const enterFocus = (node: LayoutNode) => {
    if (movedRef.current) return; // 직전 동작이 드래그(이동)였으면 클릭(포커스)을 무시한다.
    setFocusId(node.id);
    setCollapsed(prev => {
      const next = new Set(prev);
      next.delete(node.id); // 포커스한 노드는 펼쳐 자식이 바로 보이게 한다.
      return next;
    });
    resetView();
    // 루트부터 이 노드까지의 라벨 경로를 함께 넘겨 튜터 질문에 마인드맵 흐름을 싣는다.
    onNodeFocus?.(node.label, nodePathLabels(data, node.id));
  };

  const clearFocus = () => {
    setFocusId(null);
    resetView();
  };

  // 학습 모드: 켜면 노드 클릭으로 포커스+AI 튜터 질문, 끄면 노드 드래그로 위치를 조정한다.
  const toggleStudyMode = () =>
    setStudyMode(prev => {
      if (prev) {
        setFocusId(null); // 끄면 포커스를 해제해 전체 보기로 되돌린다.
        resetView();
      }
      return !prev;
    });

  const hasOffsets = Object.keys(offsets).length > 0;
  const resetLayout = () => setOffsets({});

  // ── 뷰포트 pan: 빈 공간 드래그로 전체를 이동한다 ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, bx: tf.x, by: tf.y };
    movedRef.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!movedRef.current && Math.hypot(dx, dy) > 5) {
      movedRef.current = true; // 임계값을 넘으면 드래그로 확정 → 노드 클릭과 구분된다.
      setDragging(true);
    }
    if (movedRef.current) setTf(t => ({ ...t, x: d.bx + dx, y: d.by + dy }));
  };
  const endPan = () => {
    dragRef.current = null;
    setDragging(false);
  };

  // ── 노드 재배치: 전체 보기에서 노드를 끌어 위치를 미세 조정한다(엣지는 좌표 기반이라 자동으로 따라옴) ──
  const onNodePointerDown = (e: React.PointerEvent, node: LayoutNode) => {
    if (printMode || studyMode || focusId || e.button !== 0) return; // 학습 모드가 아닐 때만 재배치 허용
    e.stopPropagation(); // 뷰포트 pan 시작을 막는다
    const o = offsets[node.id];
    nodeDragRef.current = { id: node.id, sx: e.clientX, sy: e.clientY, bx: o ? o.dx : 0, by: o ? o.dy : 0 };
    movedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onNodePointerMove = (e: React.PointerEvent) => {
    const d = nodeDragRef.current;
    if (!d) return;
    const dxPix = e.clientX - d.sx;
    const dyPix = e.clientY - d.sy;
    if (!movedRef.current && Math.hypot(dxPix, dyPix) > 5) movedRef.current = true;
    if (!movedRef.current) return;
    // 화면 픽셀 이동량을 현재 줌 배율로 나눠 콘텐츠 좌표 오프셋으로 환산한다.
    setOffsets(prev => ({ ...prev, [d.id]: { dx: d.bx + dxPix / tf.k, dy: d.by + dyPix / tf.k } }));
  };
  const onNodePointerUp = (e: React.PointerEvent) => {
    if (nodeDragRef.current) e.currentTarget.releasePointerCapture?.(e.pointerId);
    nodeDragRef.current = null;
  };

  const exportPng = useCallback(async () => {
    const src = contentRef.current;
    if (!src || exporting) return;
    setExporting(true);
    // transform이 걸린 래퍼 안의 노드를 그대로 캡처하면 html2canvas가 좌표를 잘못 잡아 글자가 잘린다.
    // transform을 없앤 클론을 라이트 톤으로 화면 밖에 띄워 캡처한다.
    const holder = document.createElement("div");
    try {
      await document.fonts.ready;
      const clone = src.cloneNode(true) as HTMLElement;
      clone.style.transform = "none";
      clone.style.letterSpacing = "0.01px"; // 한글 글자 겹침/잘림을 막는 html2canvas 회피책
      // +/- 토글 버튼은 정적 이미지에 불필요하므로 빼고, 라벨은 line-height로 세로 중앙을 잡아 글자 윗부분 잘림을 막는다.
      clone.querySelectorAll("button").forEach(b => b.remove());
      clone.querySelectorAll("span").forEach(s => { s.style.lineHeight = `${NODE_H}px`; });
      holder.setAttribute("data-theme", "light"); // CSS 변수를 라이트 톤으로 고정(엣지 색 등)
      holder.style.cssText = "position:fixed;left:-10000px;top:0;background:#fff;"; // hex-ok: PDF 캡처 라이트 고정
      holder.appendChild(clone);
      document.body.appendChild(holder);
      const canvas = await html2canvas(clone, { backgroundColor: "#ffffff", scale: 3, useCORS: true }); // hex-ok: PDF 캡처 라이트 고정
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "tongkk-mindmap.png";
      a.click();
    } catch {
      // 실패 시 조용히 종료(사용자가 다시 시도할 수 있음).
    } finally {
      holder.remove();
      setExporting(false);
    }
  }, [exporting]);

  // 노드 + 엣지 묶음. transform 래퍼의 자식이자 PNG 캡처 대상이다.
  const canvasInner = (
    <div ref={contentRef} style={{ position: "relative", width: svgW, height: svgH }}>
      <svg
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        width={svgW}
        height={svgH}
      >
        {edges.map(([p, c], i) => {
          // 자식이 왼쪽 가지면 부모 왼쪽변 → 자식 오른쪽변으로 잇는다.
          const right = c.dir >= 0;
          const sx = right ? p.x + NODE_W : p.x;
          const sy = p.y + NODE_H / 2;
          const tx = right ? c.x : c.x + NODE_W;
          const ty = c.y + NODE_H / 2;
          const mx = (sx + tx) / 2;
          return (
            <path
              key={i}
              d={`M${sx} ${sy} C${mx} ${sy},${mx} ${ty},${tx} ${ty}`}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={1.5}
            />
          );
        })}
      </svg>

      {nodes.map(node => {
        const c = DEPTH_COLORS[Math.min(node.depth, DEPTH_COLORS.length - 1)];
        return (
          <div
            key={node.id}
            onClick={printMode ? undefined : () => { if (studyMode) enterFocus(node); }}
            onPointerDown={printMode ? undefined : e => onNodePointerDown(e, node)}
            onPointerMove={printMode ? undefined : onNodePointerMove}
            onPointerUp={printMode ? undefined : onNodePointerUp}
            title={node.label}
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
              cursor: printMode ? "default" : studyMode ? "pointer" : "move",
              touchAction: "none",
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
              <button type="button"
                onClick={e => { e.stopPropagation(); toggle(node.id); }}
                onPointerDown={e => e.stopPropagation()}
                aria-label={collapsed.has(node.id) ? `${node.label} 펼치기` : `${node.label} 접기`}
                title={collapsed.has(node.id) ? "펼치기" : "접기"}
                style={{
                  background: "rgba(0,0,0,0.06)",
                  border: "none",
                  borderRadius: 6,
                  width: 22,
                  height: 22,
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--color-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {collapsed.has(node.id) ? "+" : "-"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  // PDF 캡처용: 정적 전체 렌더(툴바·뷰포트 없이 기존 동작을 그대로 보존).
  if (printMode) {
    return <div style={{ position: "relative", width: svgW, height: svgH }}>{canvasInner}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {focusId && (
          <button type="button" onClick={clearFocus} style={toolBtn}>← 전체 보기</button>
        )}
        <button type="button" onClick={expandAll} style={toolBtn}>모두 펼치기</button>
        <button type="button" onClick={collapseAll} style={toolBtn}>모두 접기</button>
        {!focusId && hasOffsets && (
          <button type="button" onClick={resetLayout} style={toolBtn} title="끌어 둔 노드 위치를 자동 정렬로 되돌립니다">정렬 초기화</button>
        )}
        <span style={divider} />
        <button type="button" onClick={() => zoomBy(1 / 1.2)} style={iconBtn} aria-label="축소">−</button>
        <button type="button" onClick={resetView} style={toolBtn} title="100%로 초기화">{Math.round(tf.k * 100)}%</button>
        <button type="button" onClick={() => zoomBy(1.2)} style={iconBtn} aria-label="확대">+</button>
        <span style={{ flex: 1, minWidth: 8 }} />
        {focusId && (
          <span style={{
            fontSize: 12,
            color: CYAN,
            fontWeight: 700,
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            단독 학습: {root.label}
          </span>
        )}
        <button type="button"
          onClick={toggleStudyMode}
          aria-pressed={studyMode}
          title="켜면 노드를 클릭해 AI 튜터에게 질문할 수 있어요"
          style={{
            ...toolBtn,
            background: studyMode ? "var(--color-tint-cyan)" : "var(--color-card)",
            color: studyMode ? CYAN : "var(--color-text)",
            border: studyMode ? "1px solid color-mix(in srgb, var(--color-cyan) 33%, transparent)" : "1px solid var(--color-border-soft)",
          }}
        >
          {studyMode ? "학습 모드 켜짐" : "학습 모드"}
        </button>
        <button type="button"
          onClick={exportPng}
          disabled={exporting}
          style={{ ...toolBtn, opacity: exporting ? 0.6 : 1, cursor: exporting ? "default" : "pointer" }}
        >
          {exporting ? "PNG 생성 중…" : "PNG 저장"}
        </button>
      </div>

      {studyMode && !focusId && (
        <div style={{
          fontSize: 12,
          color: "var(--color-text-secondary)",
          padding: "8px 12px",
          borderRadius: 8,
          background: "var(--color-surface)",
          border: "1px solid var(--color-border-soft)",
        }}>
          💡 노드를 클릭하면 그 주제에 집중하고, AI 튜터에게 바로 질문할 수 있어요.
        </div>
      )}

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerLeave={endPan}
        style={{
          position: "relative",
          height: "min(640px, 68vh)",
          overflow: "hidden",
          border: "1px solid var(--color-border-soft)",
          borderRadius: 12,
          background: "var(--color-surface)",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.k})`,
          transformOrigin: "0 0",
        }}>
          {canvasInner}
        </div>
      </div>
    </div>
  );
}
