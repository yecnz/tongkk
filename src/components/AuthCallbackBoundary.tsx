import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { RESET_PASSWORD_PATH } from '../services/authFlow';

export default function AuthCallbackBoundary({ children }: { children: ReactNode }) {
  const { loading, recoveryMode, authCallbackError } = useAuth();
  const { pathname } = useLocation();
  // 기존 메일이 /auth 또는 / 로 돌아오더라도 복구 링크는 전용 화면으로 모은다.
  if (!loading && recoveryMode && pathname !== RESET_PASSWORD_PATH) return <Navigate to={RESET_PASSWORD_PATH} replace />;
  if (!loading && authCallbackError && pathname !== '/auth' && pathname !== RESET_PASSWORD_PATH) {
    return <Navigate to="/auth?auth_error=invalid_link" replace />;
  }
  return children;
}
