// @vitest-environment jsdom
import { act,createElement as h } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:{user:{id:'owner'}},request:vi.fn()}));
vi.mock('../../AuthContext',()=>({useAuth:()=>mocks.auth}));
vi.mock('../../services/workflow',()=>({workflowRequest:mocks.request}));
import ConceptGraph from './ConceptGraph';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();vi.clearAllMocks();});
it('shows separate source histories and only links equivalent concepts after confirmation',async()=>{
 const graph={groups:[{id:'a',title:'프로세스',evidence_count:1,members:[{id:'a',title:'프로세스',course_name:'운영체제',material_name:'강의1',state:'needs_review',source_changed:false}]},{id:'b',title:'프로세스',evidence_count:2,members:[{id:'b',title:'프로세스',course_name:'시스템',material_name:'강의2',state:'recent_stable',source_changed:false}]}],links:[],prerequisites:[],suggestions:[{source_id:'a',target_id:'b',title:'프로세스'}],recommendations:[]};
 mocks.request.mockResolvedValue(graph);
 await act(async()=>root.render(h(MemoryRouter,null,h(ConceptGraph))));
 expect(container.textContent).toContain('운영체제');expect(container.textContent).toContain('시스템');expect(mocks.request).toHaveBeenCalledTimes(1);
 const confirm=[...container.querySelectorAll('button')].find(b=>b.textContent==='같은 개념으로 연결')!;
 await act(async()=>confirm.click());
 expect(mocks.request).toHaveBeenLastCalledWith('/learning-graph/links','POST',expect.objectContaining({source_id:'a',target_id:'b',relation:'equivalent'}));
});
