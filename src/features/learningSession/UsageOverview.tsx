import { Button, InlineAlert } from '../../components/ui';
import { useEffect, useState } from 'react';
import { Card } from '../../common';
import { useAuth } from '../../AuthContext';
import { BACKEND_URL, getJsonRequestHeaders } from '../../services/backend';
import './LearningResume.css';
type Group = { feature: string; model: string; calls: number; failures: number; average_ms: number; input_tokens: number | null;
  output_tokens: number | null; estimated_usd: number | null; priced_calls: number; token_known_calls: number };
const labels: Record<string,string> = {source_import:'외부 자료 가져오기',review_question:'새 복습 문제',summary:'요약',quiz:'퀴즈',grading:'채점',wrong_analysis:'오답 분석',planning:'학습 계획',tutor:'튜터',document_vision:'문서 분석',learning_prepare:'학습 준비',learning_grade:'학습 평가',review_grade:'복습 평가',explanation_grade:'설명 개선 평가',preparation_summary:'준비 요약',preparation_quiz:'준비 퀴즈',learning_preparation:'자료 준비',learning_revision:'설명 개선'};
export default function UsageOverview() {
  const { user } = useAuth();
  const userId = user?.id;
  const [groups,setGroups] = useState<Group[] | null>(null);
  const [error,setError] = useState('');
  const [retry,setRetry] = useState(0);
  useEffect(()=>{
    if (!userId) return;
    const controller=new AbortController();
    setGroups(null);setError('');
    (async()=>{
      const response=await fetch(`${BACKEND_URL}/usage`,{headers:await getJsonRequestHeaders(),signal:controller.signal});
      if(!response.ok) throw new Error();
      const data=await response.json();if(!controller.signal.aborted)setGroups(data.groups);
    })().catch(()=>{if(!controller.signal.aborted)setError('사용량을 불러오지 못했어요.');});
    return ()=>controller.abort();
  },[userId,retry]);
  if(!userId)return null;
  return <Card className="learning-resume"><h2>AI 사용량 · 최근 30일</h2>
    <p className="learning-resume-message">서버 호출 기준이에요. 토큰이나 단가가 확인되지 않은 비용은 계산에서 제외해요. 실제 청구액과 다를 수 있습니다.</p>
    {error?<InlineAlert tone="error" >{error}<Button type="button" onClick={()=>setRetry(v=>v+1)}>다시 불러오기</Button></InlineAlert>:!groups?<p role="status">불러오는 중…</p>:groups.length===0?<p>기록이 없습니다.</p>:
      <ul className="learning-resume-list">{groups.map(g=><li key={`${g.feature}:${g.model}`}><p><strong>{labels[g.feature]||g.feature}</strong> · {g.model}</p>
        <p className="learning-resume-message">{g.calls}회 · 실패 {g.failures}회 · 평균 {(g.average_ms/1000).toFixed(1)}초<br/>
          입력 {g.input_tokens?.toLocaleString()??'미확인'} / 출력 {g.output_tokens?.toLocaleString()??'미확인'} 토큰 (확인 {g.token_known_calls}/{g.calls}회)<br/>
          비용 추정 {g.estimated_usd===null?'단가·토큰 미설정':`$${g.estimated_usd.toFixed(4)} (계산 ${g.priced_calls}/${g.calls}회)`}</p></li>)}</ul>}
  </Card>;
}
