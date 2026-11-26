import { Button } from '../../components/ui';
import { Card } from '../../common';
import type { LearningSession } from '../../services/learningSessions';
import Markdown from './LearningMarkdown';

type Props = { item: NonNullable<LearningSession['current']>; blocked: boolean; selfCheck: boolean;
  onHelp: (type: string) => void; onSelfCheck: (value: string) => void };
export default function LearningHelp({ item, blocked, selfCheck, onHelp, onSelfCheck }: Props) {
  const steps = [
    { type: 'hint1', title: '첫 힌트', number: 1 },
    { type: 'hint2', title: '추가 힌트', number: 2 },
    { type: 'reference', title: '모범 설명', number: 3 },
  ];
  const revealed = steps.filter(step => item.help[step.type]);
  const next = !item.help.hint1 ? { type: 'hint1', label: '첫 힌트' }
    : !item.help.hint2 ? { type: 'hint2', label: '다음 힌트' }
      : !item.help.reference ? { type: 'reference', label: '모범 설명' } : null;
  return <Card className="learning-card learning-help-card" role="region" aria-label="도움 받기">
    <div className="learning-section-heading"><h2>도움 받기</h2><span className="learning-badge is-pink">필요할 때</span></div>
    <p className="learning-caption learning-help-intro">힌트부터 차근차근 확인해 보세요.</p>
    <div className="learning-help-content" aria-live="polite">
      {revealed.length > 0 && <ol className="learning-help-steps">{revealed.map(step => <li key={step.type}>
        <span className="learning-help-number" aria-hidden="true">{step.number}</span><section><h3>{step.title}</h3><Markdown text={item.help[step.type]!} /></section>
      </li>)}</ol>}
      {next && <Button type="button" variant="primary" className="learning-full-button" disabled={blocked} onClick={() => onHelp(next.type)}>{next.label}<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Button>}
      {selfCheck && !item.help.reference && next?.type !== 'reference' && <Button type="button" className="learning-full-button" disabled={blocked} onClick={() => onHelp('reference')}>모범 설명</Button>}
      <section className="learning-source" aria-label="원문 근거"><h3>원문 근거</h3>
        {item.help.source ? <Markdown text={item.help.source} /> : <Button type="button" className="learning-source-button" disabled={blocked} onClick={() => onHelp('source')}>관련 원문 보기</Button>}
      </section>
      {selfCheck && item.help.reference && <fieldset className="learning-self-check" disabled={blocked}><legend>직접 점검하기</legend>
        {[['understood', '설명을 이해했어요'], ['needs_review', '추가 확인이 필요해요'], ['unknown', '아직 모르겠어요']].map(([value, label]) =>
          <Button type="button" key={value} onClick={() => onSelfCheck(value)}>{label}</Button>)}
      </fieldset>}
    </div>
    <p className="learning-caption learning-help-policy">도움 사용 여부가 학습 기록에 남아요.</p>
  </Card>;
}
