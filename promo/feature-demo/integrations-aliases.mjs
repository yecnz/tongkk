import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const tutorMarkdown = path.join(here, '.integrations-tutor-markdown.tsx');
export const integrationAliases = Object.fromEntries([
  ['services/agent.ts', 'integrations-agent.ts'],
  ['services/menubarSettings.ts', 'integrations-menubar.ts'],
  ['services/appVersion.ts', 'integrations-native.ts'],
  ['services/oauthPopup.ts', 'integrations-oauth.ts'],
].map(([source, replacement]) => [path.join(root, 'src', source), path.join(here, replacement)]));

function replaceRequired(source, from, to, filename) {
  if (!source.includes(from)) throw new Error(`Promo integration adapter needs updating: ${filename}`);
  return source.replace(from, to);
}

export const integrationPlugins = [{
  name: 'promo-integrations-local-services', enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@tauri-apps/api/core') return path.join(here, 'integrations-native.ts');
    if (source === 'promo:integrations-tutor-markdown') return tutorMarkdown;
    if (source.endsWith('/AITutorDrawer') && importer?.replaceAll('\\', '/').endsWith('/src/pages/MiniTutor.tsx')) return tutorMarkdown;
  },
  async load(id) {
    if (id !== tutorMarkdown) return;
    const source = await readFile(path.join(root, 'src/components/AITutorDrawer.tsx'), 'utf8');
    const start = source.indexOf('const markdownStyles ='); const end = source.indexOf('const formatSessionDate =');
    if (start < 0 || end <= start) throw new Error('Actual tutor Markdown renderer changed; update the local preview extraction.');
    return [
      'import type { CSSProperties } from "react";',
      'import ReactMarkdown, { type Components } from "react-markdown";',
      'import remarkGfm from "remark-gfm"; import remarkMath from "remark-math"; import rehypeKatex from "rehype-katex";',
      'import { normalizeBoldSpacing, normalizeMathDelimiters, escapeStrayMultiplication } from "../../src/common";',
      'import { useSourceCitationScope } from "../../src/features/sources/citationContext";',
      'import { remarkSourceCitations } from "../../src/features/sources/sourceNavigation";',
      'import { SourceCitationAnchor } from "../../src/features/sources/SourceCitationAnchor";',
      source.slice(start, end),
    ].join('\n');
  },
  transform(code, id) {
    code = code.replaceAll('\r\n', '\n');
    const normalized = id.replaceAll('\\', '/');
    if (/\/src\/pages\/(Mini|MiniTutor|MenubarSettings)\.tsx$/.test(normalized)) {
      return code.replace('import LoginModal from "../components/LoginModal";', 'const LoginModal = (_props: unknown) => null;')
        .replace('window.open("/", "_blank");', 'navigate("/");')
        .replaceAll('onSwitchAccount={() => setShowLogin(true)}', 'onSwitchAccount={() => window.dispatchEvent(new Event("promo:integration-account-demo"))}')
        .replace('onClick={() => void runAction(signOut, "로그아웃하지 못했어요.")}', 'onClick={() => window.dispatchEvent(new Event("promo:integration-account-demo"))}');
    }
    if (normalized.endsWith('/src/components/MiniAccount.tsx')) {
      return code.replace('onClick={() => void logout()}', 'onClick={() => { setOpen(false); window.dispatchEvent(new Event("promo:integration-account-demo")); }}');
    }
    if (normalized.endsWith('/src/features/integrations/SourceConnections.tsx')) {
      return replaceRequired(code,
        `const popup=openOAuthPopup();await act(async()=>{try{const result=await workflowRequest<{url:string}>(base+'/connect','POST');const url=new URL(result.url);if(url.origin!==(provider==='google-drive'?'https://accounts.google.com':'https://api.notion.com'))throw new Error('연결 주소를 확인하지 못했어요.');goToOAuth(popup,result.url);}catch(e){popup?.close();throw e;}});`,
        `await act(async()=>{await workflowRequest(base+'/connect','POST');setNotice('예시 계정 연결을 준비했습니다. 실제 외부 계정에 연결하지 않습니다.');setRetry(n=>n+1);});`, id);
    }
    if (normalized.endsWith('/src/features/integrations/CalendarConnections.tsx')) {
      const updated = replaceRequired(code,
        `const value = await workflowRequest<{ url: string }>('/integrations/google-calendar/connect', 'POST');\n        const url = new URL(value.url);\n        if (url.origin !== 'https://accounts.google.com') throw new Error('연결 주소를 확인하지 못했어요.');\n        goToOAuth(popup, value.url);`,
        `await workflowRequest('/integrations/google-calendar/connect', 'POST');\n        setNotice('예시 캘린더 계정이 연결되었습니다. 실제 Google 계정에 연결하지 않습니다.'); setRetry(n => n + 1);`, id);
      return updated.replace("setNotice('일정 가져오기를 예약했어요.');", "setNotice('예시 일정 2개를 가져왔어요. 실제 캘린더에는 접근하지 않습니다.');");
    }
    if (normalized.endsWith('/src/pages/Mini.css')) {
      // Use the bundled font instead of a runtime Google Fonts request.
      return code.replace(/^@import url\("https:\/\/fonts\.googleapis\.com[^\n]+\n/m, '@import "@fontsource-variable/noto-sans-kr";\n').replace('font-family: "Noto Sans KR", sans-serif;', 'font-family: "Noto Sans KR Variable", "Noto Sans KR", sans-serif;');
    }
  },
}];
