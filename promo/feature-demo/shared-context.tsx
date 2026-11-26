import type { ReactNode } from 'react';

const user = { id: 'demo-user', email: 'demo@tongkk.example', user_metadata: { nickname: '통크크 체험' } };
const nothing = () => {};
const auth = { user, session: { user }, loading: false, recoveryMode: false, authCallbackError: '', signIn: async () => ({}), signUp: async () => ({}), signOut: async () => {}, resetPassword: async () => ({}), resendConfirmation: async () => ({}), verifySignupCode: async () => ({}), updatePassword: async () => ({}), updateEmail: async () => ({}), endRecovery: nothing };
const gate = { requireAuth: () => true, openLogin: nothing };
const tutorial = { open: nothing, maybeShow: nothing, ready: nothing, close: nothing, activeKey: null };
export const useAuth = () => auth;
export const useAuthGate = () => gate;
export const useTutorial = () => tutorial;
export const useSampleDemo = () => ({ openSampleDemo: nothing });
export const AuthProvider = ({ children }: { children: ReactNode }) => children;
export const AuthGateProvider = AuthProvider;
export const TutorialProvider = AuthProvider;
export const SampleDemoProvider = AuthProvider;
