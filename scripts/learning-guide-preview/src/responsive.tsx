/* eslint-disable react-refresh/only-export-components -- Standalone preview entry point. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CustomSelect from '../../../src/components/CustomSelect';
import '../../../src/index.css';
import './responsive.css';

const screens = [
  { value: '/mypage?panel=drive', label: 'Google Drive' }, { value: '/mypage?panel=notion', label: 'Notion' },
  { value: '/mypage?panel=review', label: '복습 설정' }, { value: '/mypage?panel=calendar', label: '캘린더 연동' },
  { value: '/review?tab=today', label: '복습 관리' }, { value: '/review?tab=issues&issueId=issue-process', label: '학습 이슈' },
  { value: '/stats?view=graph', label: '개념 지도' }, { value: '/stats?view=concepts&conceptId=concept-process', label: '개념 기록' },
  { value: '/summary?panel=preparation', label: '자료 자동 준비' }, { value: '/summary', label: '학습 메이트' },
  { value: '/learn/review/review-process', label: '복습 풀이' },
  { value: '/learn/session-process/revisions/revision-process', label: '설명 개선' },
];
function ResponsivePreview() {
  const [screen, setScreen] = useState(screens[0].value);
  return <><header className="guide-responsive-header"><strong>390px 모바일 미리보기</strong><label>화면
    <CustomSelect aria-label="미리볼 화면" value={screen} onChange={setScreen} options={screens} />
  </label></header><iframe title="390px 모바일 화면" src={screen} /></>;
}
createRoot(document.getElementById('root')!).render(<ResponsivePreview />);
