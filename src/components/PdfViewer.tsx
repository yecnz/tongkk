import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import {
  getDocument,
  setLayerDimensions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import { initPdfWorker } from "../services/pdfWorker";
import { CYAN } from "../common";
import "./PdfViewer.css";

initPdfWorker();

// PDF에 폰트가 임베드되지 않은 경우(특히 한글 CID/Identity-H 폰트) pdfjs가 글자를 렌더하려면
// cMap·표준폰트 데이터가 필요하다. 이 데이터는 vite.config의 copy-pdfjs-assets가 public/pdfjs로 복사한다.
const PDFJS_CMAP_URL = `${import.meta.env.BASE_URL}pdfjs/cmaps/`;
const PDFJS_FONTS_URL = `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`;

type PdfViewerProps = {
  url: string;
  title?: string;
};

// 스크롤로 들어오기 직전 페이지까지 미리 그려 빈 화면이 잠깐 보이는 것을 막는다.
const RENDER_ROOT_MARGIN = "600px 0px";
// 페이지 크기를 아직 모를 때 쓰는 임시 종횡비(스크롤바 추정용). 측정되면 실제 비율로 대체된다.
const FALLBACK_RATIO = 1.3;

export function PdfViewer({ url, title }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [pageWidth, setPageWidth] = useState(0);

  // 문서 로드: signed URL(만료 1h)·blob URL 모두 fetch→arrayBuffer로 읽어 차이를 없앤다.
  // url이 바뀌거나 언마운트되면 진행 중 요청·문서를 취소/해제한다.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let loaded: PDFDocumentProxy | null = null;

    setStatus("loading");
    setErrorMsg("");
    setPdf(null);

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        if (cancelled) return;
        loaded = await getDocument({
          data,
          cMapUrl: PDFJS_CMAP_URL,
          cMapPacked: true,
          standardFontDataUrl: PDFJS_FONTS_URL,
        }).promise;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        setPdf(loaded);
        setStatus("ready");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setErrorMsg(err instanceof Error ? err.message : "알 수 없는 오류");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      void loaded?.destroy();
    };
  }, [url]);

  // 컨테이너 폭 추적 → 페이지를 이 폭에 맞춘다(AI 튜터 가로 분할 드래그/창 리사이즈/화면 크기 변경 대응).
  // 드래그 중 과도한 재렌더를 막으려 디바운스한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: number | undefined;
    const measure = () => {
      const styles = getComputedStyle(el);
      const pad = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      setPageWidth(Math.max(0, Math.floor(el.clientWidth - pad)));
    };
    measure();
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 150);
    });
    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      style={{
        height: "100%",
        minHeight: 0,
        overflow: "auto",
        background: "var(--color-surface)",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      {status === "loading" && <div style={messageStyle}>원본 PDF를 불러오는 중입니다.</div>}
      {status === "error" && (
        <div style={messageStyle}>
          <div style={{ color: "var(--color-danger)", fontWeight: 700, marginBottom: 10 }}>
            원본 PDF를 불러오지 못했습니다.
          </div>
          <div style={{ color: "var(--color-muted)", fontSize: 13, marginBottom: 14 }}>{errorMsg}</div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title={title}
            style={{ color: CYAN, fontWeight: 800, fontSize: 13, textDecoration: "none" }}
          >
            새 탭에서 원본 열기
          </a>
        </div>
      )}
      {status === "ready" &&
        pdf &&
        pageWidth > 0 &&
        Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPageView key={i + 1} pdf={pdf} pageNumber={i + 1} pageWidth={pageWidth} scrollRef={scrollRef} />
        ))}
    </div>
  );
}

const messageStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  color: "var(--color-text-secondary)",
  fontSize: 14,
};

type PdfPageViewProps = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  pageWidth: number;
  scrollRef: RefObject<HTMLDivElement | null>;
};

function PdfPageView({ pdf, pageNumber, pageWidth, scrollRef }: PdfPageViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [size, setSize] = useState({ w: pageWidth, h: Math.round(pageWidth * FALLBACK_RATIO) });
  const [visible, setVisible] = useState(false);

  // 한 번 화면에 들어오면 계속 그려둔다(스크롤 백 시 즉시 표시). 무거운 canvas는 visible일 때만 그린다.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) setVisible(true);
      },
      { root: scrollRef.current, rootMargin: RENDER_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRef]);

  // 페이지 크기 측정 + 텍스트 레이어 렌더. 텍스트 레이어는 전체 페이지에 항상 깔아
  // 브라우저 Ctrl+F 전체 검색·복사를 보장한다(canvas 비트맵보다 가벼움). 폭이 바뀌면 재배치.
  useEffect(() => {
    if (!pageWidth) return;
    let cancelled = false;
    let textLayer: TextLayer | null = null;
    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const nextScale = pageWidth / base.width;
      const viewport = page.getViewport({ scale: nextScale });
      setScale(nextScale);
      setSize({ w: viewport.width, h: viewport.height });

      const container = textRef.current;
      if (!container) return;
      container.replaceChildren();
      setLayerDimensions(container, viewport);
      const textContent = await page.getTextContent();
      if (cancelled) return;
      textLayer = new TextLayer({ textContentSource: textContent, container, viewport });
      await textLayer.render();
    })();
    return () => {
      cancelled = true;
      textLayer?.cancel();
    };
  }, [pdf, pageNumber, pageWidth]);

  // canvas 렌더: 화면에 보이고 스케일이 정해졌을 때. 레티나 선명도를 위해 dpr을 반영한다.
  useEffect(() => {
    if (!visible || !scale) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      try {
        await task.promise;
      } catch (err) {
        // 재렌더·언마운트로 인한 취소는 정상 흐름이므로 무시한다.
        if ((err as { name?: string })?.name !== "RenderingCancelledException") throw err;
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, scale, pdf, pageNumber]);

  const cssVars = { "--total-scale-factor": String(scale || 1) } as CSSProperties;

  return (
    <div ref={wrapRef} className="pdf-page" style={{ width: size.w, height: size.h, ...cssVars }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      <div ref={textRef} className="textLayer" />
    </div>
  );
}
