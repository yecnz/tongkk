// @vitest-environment jsdom
import { act,createElement as h } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../../AuthContext',()=>({useAuth:()=>({user:{id:'user'}})}));
vi.mock('../../services/reviews',async original=>({...await original<typeof import('../../services/reviews')>(),reviewRequest:request}));
import ReviewPractice from './ReviewPractice';
import { ReviewError,type ReviewView } from '../../services/reviews';
let root:Root;let container:HTMLDivElement;let response:ReviewView;
function initial():ReviewView{return {id:'card',title:'분산 학습',question:'핵심을 설명하세요',due_at:'2020-01-01T00:00:00Z',source_changed:false,latest:null,check:null,baseline:null,previous:null};}
async function click(label:string){await act(async()=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent===label);expect(button).toBeTruthy();button!.click();});}
async function render(){await act(async()=>root.render(h(MemoryRouter,{initialEntries:['/learn/review/card']},h(Routes,null,h(Route,{path:'/learn/review/:cardId',element:h(ReviewPractice)})))));}
async function type(text:string){await act(async()=>{const input=container.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));});}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();response=initial();request.mockReset();request.mockImplementation(async()=>structuredClone(response));container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('runs recall, polling, feedback, a check and comparison with the baseline',async()=>{
 await render();await type('시간을 두고 반복해요');
 response.latest={id:'attempt',answer:'시간을 두고 반복해요',status:'pending',assisted:false,feedback:null,check_result:null,eligible_for_schedule:true};
 await click('설명 제출');expect(container.textContent).toContain('설명 평가 중');
 response.latest.status='graded';response.latest.feedback={criteria:[{criterion_id:'c',status:'met',student_quote:'시간',reason:'간격을 설명했어요',source_refs:[{unit_id:'u0',quote:'원문'}]}]};
 response.check={question:'방법 선택',options:['시간 간격','몰아서']};response.baseline={answer:'처음 답안',feedback:null};
 await act(async()=>vi.advanceTimersByTimeAsync(1500));expect(container.textContent).toContain('기초 확인');
 await act(async()=>(container.querySelector('input[name="review-check"][value="0"]') as HTMLInputElement).click());
 response.latest.check_result={selected:0,answer_index:0,correct:true,explanation:'간격이 근거예요'};
 // A deferred judgment may keep a past due date; still show this submission's result.
 await click('답안 제출');expect(container.textContent).toContain('정답이에요.');expect(container.textContent).toContain('처음 학습과 비교');
 await click('다시 연습하기');expect(container.querySelector('textarea')?.value).toBe('');
});
it('replays an ambiguous submission with the exact same attempt id and answer',async()=>{
 await render();await type('보존할 답변');request.mockRejectedValueOnce(new ReviewError('서버 오류',503));
 await click('설명 제출');const first=request.mock.calls.at(-1);expect(container.textContent).toContain('이전 제출 결과 확인');
 await click('이전 제출 결과 확인');expect(request.mock.calls.at(-1)).toEqual(first);
 expect(localStorage.getItem('tongkk:review:user:card')).toContain('보존할 답변');
});
it('blocks stale-source practice and preserves ungraded answers for editing',async()=>{
 response.source_changed=true;await render();expect(container.querySelector('textarea')).toBeNull();expect(container.textContent).toContain('원문이 바뀌었어요');
 await act(async()=>root.unmount());root=createRoot(container);response=initial();response.latest={id:'failed',answer:'원래 답변',status:'ungraded',assisted:false,feedback:null,check_result:null,eligible_for_schedule:true};
 await render();expect(container.querySelector('textarea')?.value).toBe('원래 답변');await type('');expect(container.querySelector('textarea')?.value).toBe('');
});
