import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { countDueFlashcards } from '../../services/flashcards';
import './Flashcards.css';

export default function StudyTools() {
  const { user } = useAuth();
  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    if (!user) return;
    countDueFlashcards().then(count => { if (active) setDue(count); }).catch(() => { if (active) setDue(null); });
    return () => { active = false; };
  }, [user]);
  return <nav className="study-tools" aria-label="학습 도구">
    <Link to="/flashcards"><strong>오늘의 5분 암기</strong><span>{due === null ? '질문 카드로 짧게 복습하기' : due ? `지금 복습할 카드 ${due}개` : '새 카드 만들고 기억하기'}</span></Link>
    <Link to="/study-paths"><strong>학습 코스</strong><span>여러 자료를 단원별로 이어서 학습하기</span></Link>
  </nav>;
}
