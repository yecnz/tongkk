import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { workflowRequest } from '../../services/workflow';
import { fetchCourses, type CourseRecord } from '../../services/courses';
import { invalidateMaterialsCache } from '../../services/materials';
import type { CalendarConnection } from '../../services/calendarIntegration';
type Provider='google-drive'|'notion';
type Draft={id:string;course_id:string;external_id:string;title:string;markdown:string;status:'ready'|'applied'|'discarded';material_id:string|null;source_modified:string;notices:string[]};
type State={configured:boolean;connection:CalendarConnection|null;drafts:Draft[]};
type Document={id:string;title:string;modified:string;kind:string};
export function SourceProvider({provider}:{provider:Provider}) {
  const { user }=useAuth();const [data,setData]=useState<State|null>(null);const [courses,setCourses]=useState<CourseRecord[]>([]);
  const [course,setCourse]=useState('');const [query,setQuery]=useState('');const [docs,setDocs]=useState<Document[]>([]);const [cursor,setCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [retry,setRetry]=useState(0);const [searched,setSearched]=useState(false);
  const title=provider==='google-drive'?'Google Drive':'Notion';const base=`/source-integrations/${provider}`;
  useEffect(()=>{if(!user)return;let active=true;Promise.all([workflowRequest<State>(base),fetchCourses()]).then(([d,c])=>{if(active){setData(d);setCourses(c);setCourse(previous=>previous||c[0]?.id||'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[user,base,retry]);
  async function act(action:()=>Promise<void>) {if(busy)return;setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'자료 서비스를 이용하지 못했어요.');}finally{setBusy(false);}}
  async function search(next=false) {await act(async()=>{const result=await workflowRequest<{documents:Document[];cursor:string|null}>(`${base}/documents?${new URLSearchParams({q:query,...(next&&cursor?{cursor}:{})})}`);setDocs(previous=>next?[...previous,...result.documents]:result.documents);setCursor(result.cursor);setSearched(true);});}
  async function connect() {await act(async()=>{const result=await workflowRequest<{url:string}>(base+'/connect','POST');const url=new URL(result.url);if(url.origin!==(provider==='google-drive'?'https://accounts.google.com':'https://api.notion.com'))throw new Error('연결 주소를 확인하지 못했어요.');window.location.assign(result.url);});}
  async function preview(id:string) {await act(async()=>{const draft=await workflowRequest<Draft>(base+'/imports','POST',{external_id:id,course_id:course});setNotice(draft.status==='applied'?'이미 같은 내용으로 저장한 자료예요.':'가져온 내용을 검토하고 저장해 주세요.');setRetry(n=>n+1);});}
  async function action(draft:Draft,name:'apply'|'discard') {await act(async()=>{await workflowRequest(`/source-integrations/drafts/${draft.id}/actions`,'POST',{action:name});invalidateMaterialsCache(courses.find(c=>c.id===draft.course_id)?.name);setRetry(n=>n+1);setNotice(name==='apply'?'과목에 새 자료 버전으로 저장했습니다.':'초안을 폐기했어요.');});}
  if(!user)return null;
  const connected=data?.connection?.status==='connected';
  return <Card className="workflow-surface workflow-panel workflow-stack"><div className="workflow-card-heading"><h2 className="workflow-panel-title">{title} 자료 연결</h2>{data && <span className="workflow-badge" data-state={connected?'connected':'disconnected'}>{connected?'연결됨':'연결되지 않음'}</span>}</div><p className="workflow-muted">{provider==='google-drive'?'Google 문서·텍스트·PDF·PPTX·DOCX를 가져옵니다.':'허용한 Notion 페이지를 가져옵니다. 하위 페이지는 별도로 선택해 주세요.'} 원본은 유지되며, 변경 내용은 새 버전으로 저장됩니다.</p>
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>다시 확인</button></p>}{notice&&<p role="status">{notice}</p>}
    {!data?<p role="status">연결을 확인하는 중…</p>:<>
      <div className="workflow-actions">{!data.configured?<p>서버의 {title} OAuth 앱 설정이 필요해요.</p>:<button type="button" className={connected?undefined:'workflow-primary'} disabled={busy} onClick={()=>{void connect();}}>{connected?'다른 계정으로 연결':`${title} 연결`}</button>}
      {data.connection&&data.connection.status!=='disconnected'&&<button type="button" className="workflow-danger" disabled={busy} onClick={()=>{void act(async()=>{const result=await workflowRequest<{provider_revoked:boolean}>(base+'/disconnect','POST',{revision:data.connection!.revision});setNotice(result.provider_revoked?'서비스 권한과 앱 연결을 해제했습니다.':'앱 연결을 해제했습니다. 외부 서비스의 권한 관리에서도 접근 권한을 확인해 주세요.');setDocs([]);setSearched(false);setRetry(n=>n+1);});}}>연결 해제</button>}</div>
      {connected&&<><label className="workflow-field">저장할 과목<select value={course} onChange={e=>setCourse(e.target.value)} disabled={busy}>{courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{!courses.length&&<p>자료를 저장하려면 과목을 먼저 만들어 주세요.</p>}
        <form onSubmit={e=>{e.preventDefault();void search();}} className="workflow-search"><label className="workflow-field">자료 제목 검색<input placeholder="가져올 자료의 제목을 입력해 주세요" value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} disabled={busy}/></label><button disabled={busy} type="submit">자료 찾기</button></form>
        {docs.map(d=><div className="workflow-subsection" key={d.id}><strong>{d.title}</strong><p className="workflow-meta">{d.modified?new Date(d.modified).toLocaleString('ko-KR'):''}</p><button type="button" disabled={busy||!course} onClick={()=>{void preview(d.id);}}>최신 본문 가져와 비교</button></div>)}
        {searched&&!docs.length&&<p>검색 결과가 없습니다. 검색어와 접근 권한을 확인해 주세요.</p>}{cursor&&<button type="button" disabled={busy} onClick={()=>{void search(true);}}>다음 자료 보기</button>}
      </>}
      {busy&&<p role="status">외부 자료를 처리하는 중…</p>}
      <h3>가져온 자료와 버전</h3>{data.drafts.filter(d=>d.status!=='discarded').map(d=><details className="workflow-details" key={d.id}><summary>{d.title} · {courses.find(c=>c.id===d.course_id)?.name||'과목'} · {d.status==='applied'?'저장됨':'검토 대기'}</summary>
        <p className="workflow-meta">외부 수정 시각: {d.source_modified?new Date(d.source_modified).toLocaleString('ko-KR'):'정보 없음'}</p>{d.notices.map(n=><p className="workflow-muted" key={n}>{n}</p>)}
        <pre className="workflow-source-preview">{d.markdown}</pre>
        {data.drafts.filter(old=>old.id!==d.id&&old.external_id===d.external_id&&old.course_id===d.course_id&&old.status==='applied').slice(0,1).map(old=><details key={old.id}><summary>앞서 저장한 본문</summary><pre className="workflow-source-preview">{old.markdown}</pre></details>)}
        {d.status==='ready'&&<div className="workflow-actions"><button type="button" className="workflow-primary" disabled={busy||!connected} onClick={()=>{void action(d,'apply');}}>새 자료 버전으로 저장</button><button type="button" disabled={busy} onClick={()=>{void action(d,'discard');}}>초안 폐기</button></div>}
        {d.status==='applied'&&<Link to="/summary" state={{selectedCourse:courses.find(c=>c.id===d.course_id)?.name}}>과목 자료로 이동 →</Link>}
      </details>)}
    </>}
  </Card>;
}
export default function SourceConnections(){return <div className="workflow-stack"><SourceProvider provider="notion"/></div>;}
