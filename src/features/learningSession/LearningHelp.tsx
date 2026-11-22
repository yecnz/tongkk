import { Card } from '../../common';
import type { LearningSession } from '../../services/learningSessions';
import Markdown from './LearningMarkdown';

type Props = { item: NonNullable<LearningSession['current']>; blocked: boolean; selfCheck: boolean;
  onHelp: (type: string) => void; onSelfCheck: (value: string) => void };
export default function LearningHelp({ item, blocked, selfCheck, onHelp, onSelfCheck }: Props) {
  return <Card className="learning-card learning-help-card">
    <details className="learning-help-disclosure">
      <summary><span><strong>막혔을 때 도움 받기</strong><small>필요한 만큼만 확인해요</small></span><span className="learning-disclosure-arrow" aria-hidden="true">⌄</span></summary>
      <div className="learning-help-content">
        <p className="learning-caption">열어본 도움은 수행 결과에 함께 기록돼요.</p>
        {!item.help.hint1 ? <button type="button" className="learning-full-button" disabled={blocked} onClick={() => onHelp('hint1')}>첫 힌트</button>
          : <section><h3>첫 힌트</h3><Markdown text={item.help.hint1} /></section>}
        {item.help.hint1 && (!item.help.hint2 ? <button type="button" className="learning-full-button" disabled={blocked} onClick={() => onHelp('hint2')}>다음 힌트</button>
          : <section><h3>추가 힌트</h3><Markdown text={item.help.hint2} /></section>)}
        {(item.help.hint2 || selfCheck) && !item.help.reference && <button type="button" className="learning-full-button" disabled={blocked} onClick={() => onHelp('reference')}>모범 설명</button>}
        {item.help.reference && <section><h3>모범 설명</h3><Markdown text={item.help.reference} /></section>}
        <details className="learning-source"><summary>관련 원문 확인</summary>
          {item.help.source ? <Markdown text={item.help.source} /> : <button type="button" disabled={blocked} onClick={() => onHelp('source')}>관련 원문 불러오기</button>}
        </details>
        {selfCheck && item.help.reference && <fieldset className="learning-self-check" disabled={blocked}><legend>설명과 비교해서 직접 점검해주세요.</legend>
          {[['understood', '설명을 이해했어요'], ['needs_review', '추가 확인이 필요해요'], ['unknown', '아직 모르겠어요']].map(([value, label]) =>
            <button type="button" key={value} onClick={() => onSelfCheck(value)}>{label}</button>)}
        </fieldset>}
      </div>
    </details>
  </Card>;
}
