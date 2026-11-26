import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../AuthContext';
import { PdfViewer } from '../../components/PdfViewer';
import { createCourseMaterialFileUrl, invalidateMaterialsCache, invalidateSignedUrlCache, loadCourseMaterialsFromServer, type CourseMaterial } from '../../services/materials';
import { createPdfPreviewFromUrl } from '../../services/documentPreview';
import { buildSourceUrl, parseSourcePage, sourcePageExcerpt } from './sourceNavigation';
import './Sources.css';

export default function SourcePage() {
  const { user } = useAuth();
  const [query] = useSearchParams();
  const courseName = query.get('course') || '';
  const materialId = query.get('material') || '';
  const page = parseSourcePage(query.get('page'));
  const hash = query.get('hash') || '';
  const version = query.get('version') || '';
  const candidates = query.getAll('candidate');
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [changed, setChanged] = useState(false);
  const sourceKey = JSON.stringify([user?.id, courseName, materialId, page, retry]);
  const [loadedKey, setLoadedKey] = useState('');
  const currentMaterials = loadedKey === sourceKey ? materials : [];
  const material = currentMaterials.find(item => item.id === materialId);
  const [file, setFile] = useState<{ url: string; isPdf: boolean; isImage: boolean; cacheKey?: string | null } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState('');

  useEffect(() => {
    let active = true;
    setMaterials([]); setError('');
    if (!user || !courseName || page === null) { setLoading(false); return; }
    setLoading(true);
    // A citation may outlive its file. Check current ownership/existence instead of using stale SWR data.
    invalidateMaterialsCache(courseName);
    loadCourseMaterialsFromServer(courseName, { includeMarkdown: true })
      .then(value => { if (active) { setMaterials(value); setLoadedKey(sourceKey); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : '자료를 불러오지 못했습니다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, courseName, materialId, page, retry, sourceKey]);

  useEffect(() => {
    let active = true;
    setChanged(Boolean(material && version && String(material.updatedAt) !== version));
    if (material && hash) {
      if (!globalThis.crypto?.subtle) { setChanged(true); return; }
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(material.markdown)).then(value => {
        const actual = [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (active) setChanged(actual !== hash);
      }).catch(() => { if (active) setChanged(true); });
    }
    return () => { active = false; };
  }, [material, hash, version]);

  useEffect(() => {
    let active = true;
    let temporaryUrl: string | null = null;
    setFile(null); setFileError('');
    if (!material?.filePath) { setFileLoading(false); return; }
    setFileLoading(true);
    async function load() {
      // Files can be replaced from another device; tie the byte cache to the freshly loaded version.
      const cacheKey = `${material!.filePath}::source-version:${material!.updatedAt}`;
      invalidateSignedUrlCache(material!.filePath!);
      const url = await createCourseMaterialFileUrl(material!);
      if (!url || !active) return;
      const isPdf = material!.type === 'pdf' || /\.pdf$/i.test(material!.name);
      const convert = /\.(?:pptx?|docx)$/i.test(material!.name);
      if (convert) {
        temporaryUrl = await createPdfPreviewFromUrl(url, material!.name, cacheKey);
        if (!active) { URL.revokeObjectURL(temporaryUrl); return; }
      }
      if (active) setFile({ url: temporaryUrl || url, isPdf: isPdf || convert, isImage: material!.type === 'img', cacheKey: convert ? undefined : cacheKey });
    }
    void load().catch(e => { if (active) setFileError(e instanceof Error ? e.message : '원본 파일을 열지 못했습니다.'); })
      .finally(() => { if (active) setFileLoading(false); });
    return () => { active = false; if (temporaryUrl) URL.revokeObjectURL(temporaryUrl); };
  }, [material, retry]);

  if (!user) return <Navigate to="/" replace />;
  const backUrl = `/summary?${new URLSearchParams({ course: courseName, view: materialId ? 'material' : 'upload', ...(materialId ? { material: materialId } : {}) })}`;
  const excerpt = material && page ? sourcePageExcerpt(material.markdown, page) : null;
  const choices = currentMaterials.filter(item => candidates.includes(item.id));
  const pageCount = material?.pages || material?.slides;
  const outOfRange = Boolean(page && pageCount && page > pageCount);
  return <main className="source-page">
    <header><div><h1>{material?.name || '출처 원문'}</h1><span>{courseName}{page ? ` · p.${page}` : ''}</span></div><Link to={courseName ? backUrl : '/'}>자료 화면으로</Link></header>
    {!courseName || page === null ? <p role="alert">올바른 과목과 페이지 정보가 없는 출처 링크입니다.</p>
      : loading || (loadedKey !== sourceKey && !error) ? <p role="status">원문 자료를 확인하는 중…</p>
        : error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>다시 시도</button></p>
          : !materialId ? <section className="source-choice" aria-label="원문 자료 선택"><p>여러 자료에 같은 페이지가 있어요. 답변의 자료명을 확인하고 원문을 선택하세요.</p>
            {choices.map(item => <Link key={item.id} to={buildSourceUrl({ courseName, materialId: item.id, page: page!, updatedAt: item.updatedAt })}>{item.name} · p.{page}</Link>)}
            {!choices.length && <p role="alert">연결된 자료가 삭제되었거나 접근할 수 없습니다. 자료 화면에서 다시 선택하세요.</p>}
          </section>
            : !material ? <p role="alert">자료가 삭제되었거나 접근할 수 없습니다. 자료 화면에서 다시 선택하세요.</p>
              : <>
                {changed && <p className="source-notice" role="status">출처를 저장한 뒤 자료가 변경되었어요. 현재 원문을 표시하므로 인용 내용과 페이지를 다시 확인하세요.</p>}
                {outOfRange && !file?.isPdf && !fileLoading && <p className="source-notice" role="alert">자료의 페이지 정보는 총 {pageCount}페이지입니다. 인용된 p.{page}는 범위를 벗어나므로 아래 원문에서 내용을 확인하세요.</p>}
                {fileLoading && <p role="status">원본을 여는 중…</p>}
                {fileError && <p role="alert">{fileError} <button type="button" onClick={() => setRetry(n => n + 1)}>다시 시도</button></p>}
                {file?.isPdf ? <div className="source-viewer"><PdfViewer key={file.url} url={file.url} title={material.name} cacheKey={file.cacheKey} initialPage={page!} /></div>
                  : file?.isImage ? <img className="source-image" src={file.url} alt={material.name} />
                    : !fileLoading && <section className="source-text" aria-label="변환된 원문"><p className="source-notice">{excerpt !== null ? '해당 페이지의 변환된 원문입니다.' : '페이지 위치를 확인할 수 없어 전체 변환 원문을 표시합니다.'}{!material.filePath ? ' 저장된 원본 파일이 없습니다.' : ''}</p>
                      {file && <p><a href={file.url} target="_blank" rel="noopener noreferrer">원본 파일 열기</a></p>}
                      <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>{(excerpt ?? material.markdown) || '표시할 원문이 없습니다.'}</ReactMarkdown>
                    </section>}
              </>}
  </main>;
}
