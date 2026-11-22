// @vitest-environment jsdom
import {act,createElement as h} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const request=vi.hoisted(()=>vi.fn());
const auth=vi.hoisted(()=>({user:{id:'user'} as {id:string}|null}));
vi.mock('../../AuthContext',()=>({useAuth:()=>auth}));
vi.mock('../../services/reviews',()=>({reviewRequest:request}));
import ReviewOverview from './ReviewOverview';
let root:Root,container:HTMLDivElement;
const stats={completed_sessions:3,initial_checks:4,initial_correct:3,due_cards:1,changed_cards:1,retention_checks:2,retention_correct:1};
async function render(variant:'dashboard'|'stats'='dashboard'){await act(async()=>root.render(h(MemoryRouter,null,h(ReviewOverview,{variant}))));}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);auth.user={id:'user'};container=document.createElement('div');root=createRoot(container);request.mockReset();request.mockImplementation(async path=>path==='/stats'?stats:{cards:[{id:'card',title:'분산 학습',due_at:'2020-01-01',source_changed:false},{id:'stale',title:'변경됨',due_at:'2020-01-01',source_changed:true}]});});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('links due cards to practice and changed sources to new learning',async()=>{await render();expect(container.querySelector('a[href="/learn/review/card"]')).toBeTruthy();expect(container.querySelector('a[href="/learn/review/stale"]')).toBeNull();expect(container.textContent).toContain('원문 변경');});
it('separates immediate and delayed results with their denominators',async()=>{await render('stats');expect(container.textContent).toContain('학습 직후 확인: 3/4회');expect(container.textContent).toContain('시간을 둔 독립 수행: 1/2회');});
it('shows retrieval errors instead of empty state and skips guest requests',async()=>{request.mockRejectedValue(new Error());await render();expect(container.querySelector('[role="alert"]')).toBeTruthy();auth.user=null;request.mockClear();await render();expect(request).not.toHaveBeenCalled();expect(container.textContent).toBe('');});
