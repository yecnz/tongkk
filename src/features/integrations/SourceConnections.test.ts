// @vitest-environment jsdom
import { act,createElement as h } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:{user:{id:'owner'}},request:vi.fn(),invalidate:vi.fn()}));
vi.mock('../../AuthContext',()=>({useAuth:()=>mocks.auth}));
vi.mock('../../services/workflow',()=>({workflowRequest:mocks.request}));
vi.mock('../../services/courses',()=>({fetchCourses:async()=>[{id:'course',name:'운영체제'}]}));
vi.mock('../../services/materials',()=>({invalidateMaterialsCache:mocks.invalidate}));
import {SourceProvider} from './SourceConnections';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();vi.clearAllMocks();});
it('keeps imported content as a draft until the user approves a new version',async()=>{
 const state={configured:true,connection:{status:'connected',revision:1},drafts:[{id:'draft',course_id:'course',external_id:'doc',title:'외부 강의',markdown:'검토할 본문',status:'ready',source_modified:'2026-11-23',notices:['텍스트만 가져왔어요.']}]};
 mocks.request.mockImplementation(async(_path:string,method?:string)=>method==='POST'?{}:state);
 await act(async()=>root.render(h(MemoryRouter,null,h(SourceProvider,{provider:'google-drive'}))));
 expect(container.textContent).toContain('검토할 본문');expect(container.textContent).toContain('텍스트만 가져왔어요.');expect(mocks.request).toHaveBeenCalledTimes(1);
 const approve=[...container.querySelectorAll('button')].find(b=>b.textContent==='새 자료 버전으로 저장')!;
 await act(async()=>approve.click());
 expect(mocks.request).toHaveBeenCalledWith('/source-integrations/drafts/draft/actions','POST',{action:'apply'});
 expect(mocks.invalidate).toHaveBeenCalledWith('운영체제');
});
