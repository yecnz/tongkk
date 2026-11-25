import { Card } from '../../common';
import type { SessionResult } from '../../services/learningSessions';
import LearningLink from './LearningLink';

const recallLabels = { sufficient: '확인됨', needs_review: '보완 필요', uncertain: '추가 확인', ungraded: '미평가', self_report: '자기 점검' };
const checkLabels = { correct: '맞힘', incorrect: '다시 확인', ungraded: '미평가' };
export default function LearningResults({ results }: { results: SessionResult[] }) {
  const evaluated = results.filter(r => ['sufficient', 'needs_review', 'uncertain'].includes(r.recall)).length;
  const review = results.filter(r => ['needs_review', 'uncertain'].includes(r.recall) || r.check === 'incorrect').length;
  const checked = results.filter(r => r.check !== 'ungraded').length;
  return <>
    <div className="learning-result-stats" aria-label="이번 학습 요약">
      {[['설명 평가됨', `${evaluated}개`], ['보완·추가 확인', `${review}개`], ['확인 문제 맞힘', `${results.filter(r => r.check === 'correct').length} / ${checked}개`]].map(([label, value]) =>
        <Card className="learning-card learning-stat" key={label}><span>{label}</span><strong>{value}</strong></Card>)}
    </div>
    <Card className="learning-card" role="region" aria-labelledby="learning-results-title">
      <h2 id="learning-results-title">개념별 학습 기록</h2>
      <details className="learning-note"><summary>결과 해석 안내</summary>
        <p>이번 설명과 확인 문제의 결과입니다. 장기 기억이나 응용 능력을 평가한 결과는 아닙니다.</p>
      </details>
      <div className="learning-results-list">{results.map((result, index) => <section className="learning-result-row" key={index}>
        <div className="learning-section-heading"><h3>{result.title}</h3>
          <span className={`learning-badge${result.skipped || ['needs_review', 'uncertain'].includes(result.recall) || result.check === 'incorrect' ? ' is-pink' : ''}`}>
            {result.skipped ? (result.recall === 'ungraded' && result.check === 'ungraded' ? '건너뜀' : '일부 건너뜀') : result.recall === 'ungraded' && result.check === 'ungraded' ? '미평가' : '학습 기록'}</span></div>
        <dl className="learning-result-details"><div><dt>자기 설명</dt><dd>{recallLabels[result.recall]}</dd></div>
          <div><dt>확인 문제</dt><dd>{checkLabels[result.check]}</dd></div></dl>
        <p className="learning-caption">{result.assisted ? '도움 사용' : '앱 내 도움 미사용'}{result.prior_instruction ? ' · 설명·보완 후 수행' : ''}{result.repeated ? ' · 이전에 학습한 내용' : ''}{result.reported ? ' · 내용 확인 필요' : ''}</p>
      </section>)}</div>
      <div className="learning-notice">원문을 확인하고 다시 설명하세요.</div>
      <div className="learning-actions"><LearningLink to="/learn" className="learning-button primary">다른 범위 학습하기 →</LearningLink>
        <LearningLink to="/review?tab=issues" className="learning-button">학습 이슈 보기</LearningLink>
        <LearningLink to="/" className="learning-button">대시보드로 돌아가기</LearningLink></div>
    </Card>
  </>;
}
