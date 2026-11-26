import { Link } from "react-router-dom";
import LegalLinks from "../components/LegalLinks";
import { FEEDBACK_EMAIL } from "../common";

// 개인정보처리방침·이용약관. Notion Public integration과 Google OAuth 검증에 공개 URL로 등록한다.
// 내용을 바꾸면 시행일도 같이 바꿀 것.
const EFFECTIVE_DATE = "2026년 11월 25일";

type Section = { title: string; body: (string | string[])[] };

const PRIVACY: Section[] = [
  {
    title: "1. 수집하는 정보",
    body: [
      "Tongkk(이하 '서비스')는 학습 도우미 기능을 제공하기 위해 다음 정보를 처리합니다.",
      [
        "계정 정보: 이메일 주소, 암호화된 비밀번호, 닉네임, 프로필 사진, 학교·학과(선택 입력)",
        "학습 데이터: 직접 업로드한 강의자료와 그 변환 결과, 요약, 퀴즈와 채점 결과, 오답·복습 기록, 학습 계획과 일정, AI 튜터와 나눈 대화",
        "연동 데이터: 사용자가 연결한 경우에 한해 Google 캘린더 일정, Notion에서 직접 고른 문서",
        "이용 기록: AI 기능 호출 시간과 사용량(서비스 안정성과 비용 관리 목적)",
      ],
    ],
  },
  {
    title: "2. 이용 목적",
    body: [
      [
        "로그인과 계정 관리",
        "강의자료 요약, 퀴즈 생성·채점, AI 튜터, 학습 계획 등 서비스 기능 제공",
        "오류 해결, 부정 이용 방지, 서비스 개선",
      ],
      "수집한 정보를 광고나 판매 목적으로 사용하지 않습니다.",
    ],
  },
  {
    title: "3. Google·Notion 연동 데이터",
    body: [
      "Google 캘린더(calendar.events.readonly), Notion(콘텐츠 읽기) 연동은 모두 읽기 전용이며, 사용자가 직접 '연결'을 눌렀을 때만 동작합니다.",
      [
        "캘린더 일정은 서비스의 학습 캘린더에 함께 보여 주고 학습 계획에 반영하는 데만 사용합니다.",
        "Notion 문서는 사용자가 고른 문서만 불러와 강의자료처럼 요약·퀴즈·튜터 기능에 사용합니다.",
        "연동으로 받은 접근 토큰은 암호화해 저장하며, 연결을 해제하면 토큰을 폐기합니다.",
        "Google에서 받은 데이터를 광고에 사용하거나 제3자에게 판매·전달하지 않으며, 사람이 열람하지 않습니다(사용자 동의, 보안 목적, 법적 의무가 있는 경우 제외).",
      ],
      "Tongkk이 Google API에서 받은 정보를 사용하고 다른 앱으로 전송하는 방식은 Limited Use 요건을 포함한 Google API 서비스 사용자 데이터 정책(Google API Services User Data Policy)을 준수합니다.",
    ],
  },
  {
    title: "4. 처리 위탁 및 국외 이전",
    body: [
      "서비스 운영을 위해 다음 업체에 정보 처리를 맡깁니다. 일부 업체의 서버는 국외에 있습니다.",
      [
        "Supabase: 계정 인증, 데이터베이스, 파일 저장",
        "OpenAI, Google(Gemini): 요약·퀴즈·튜터 등 AI 처리를 위해 강의자료 내용과 질문을 전달(설정된 모델에 따라 둘 중 하나 이상 사용)",
        "Microsoft Azure: 백엔드 서버 운영",
        "Vercel: 웹사이트 호스팅",
        "Google(Gmail): 가입 인증·비밀번호 재설정 메일 발송",
      ],
    ],
  },
  {
    title: "5. 보관 기간과 파기",
    body: [
      "정보는 회원 탈퇴 또는 사용자가 직접 삭제할 때까지 보관하며, 요청 시 지체 없이 파기합니다. 마이페이지에서 과목·자료·요약·퀴즈·프로필 데이터를 직접 삭제할 수 있고, 계정 자체 삭제는 문의 메일로 요청할 수 있습니다.",
    ],
  },
  {
    title: "6. 이용자의 권리",
    body: [
      "이용자는 언제든 자신의 정보를 열람·수정·삭제하거나 처리 정지를 요청할 수 있고, Google·Notion 연동은 서비스 안에서 또는 각 서비스의 계정 설정에서 언제든 해제할 수 있습니다.",
    ],
  },
  {
    title: "7. 안전성 확보 조치",
    body: [
      "모든 통신은 HTTPS로 암호화하고, 데이터베이스는 사용자별 접근 제어(RLS)로 본인 데이터만 접근할 수 있게 합니다. 외부 연동 토큰은 별도 키로 암호화해 저장합니다.",
    ],
  },
  {
    title: "8. 문의",
    body: [`개인정보 관련 문의: ${FEEDBACK_EMAIL}`, "방침이 바뀌면 이 페이지에 시행일과 함께 공지합니다."],
  },
];

const TERMS: Section[] = [
  {
    title: "1. 목적",
    body: ["이 약관은 Tongkk(이하 '서비스')의 이용 조건과 운영자·이용자의 권리와 의무를 정합니다."],
  },
  {
    title: "2. 서비스 내용",
    body: [
      "서비스는 강의자료 요약, 퀴즈 생성과 채점, AI 튜터, 학습 계획, 외부 서비스(Google·Notion) 연동 등 학습 보조 기능을 제공합니다. 기능은 개선을 위해 바뀌거나 중단될 수 있습니다.",
    ],
  },
  {
    title: "3. 계정",
    body: [
      "이용자는 정확한 정보로 가입해야 하며, 계정과 비밀번호 관리 책임은 이용자에게 있습니다. 다른 사람의 계정을 무단으로 사용해서는 안 됩니다.",
    ],
  },
  {
    title: "4. 이용자의 의무",
    body: [
      [
        "업로드하는 자료에 대한 권리(저작권 등)를 갖고 있거나 개인 학습 목적의 정당한 이용 범위 안에서만 올려야 합니다.",
        "불법 정보, 타인의 개인정보, 악성 코드가 담긴 자료를 올려서는 안 됩니다.",
        "서비스를 비정상적으로 대량 호출하거나 시스템을 방해해서는 안 됩니다.",
      ],
    ],
  },
  {
    title: "5. 콘텐츠의 권리",
    body: [
      "이용자가 올린 자료와 학습 기록의 권리는 이용자에게 있습니다. 서비스는 기능 제공에 필요한 범위에서만 이를 처리합니다.",
    ],
  },
  {
    title: "6. AI 결과에 대한 안내",
    body: [
      "요약, 퀴즈, 채점, 튜터 답변, 학습 계획은 AI가 만든 결과로 틀리거나 빠진 내용이 있을 수 있습니다. 시험·과제 등 중요한 판단은 원래 강의자료와 교수자 안내를 기준으로 하세요.",
    ],
  },
  {
    title: "7. 이용 제한과 탈퇴",
    body: [
      "약관을 위반하면 이용이 제한될 수 있습니다. 이용자는 언제든 데이터를 삭제하거나 탈퇴를 요청할 수 있습니다.",
    ],
  },
  {
    title: "8. 책임의 제한",
    body: [
      "서비스는 무료로 제공되며, 천재지변·외부 서비스 장애 등 운영자가 통제할 수 없는 사유나 이용자의 귀책 사유로 생긴 손해에 대해서는 법령이 허용하는 범위에서 책임을 지지 않습니다.",
    ],
  },
  {
    title: "9. 약관 변경과 문의",
    body: [
      `약관을 바꾸면 이 페이지에 시행일과 함께 공지합니다. 문의: ${FEEDBACK_EMAIL}`,
    ],
  },
];

export default function Legal({ kind }: { kind: "privacy" | "terms" }) {
  const title = kind === "privacy" ? "개인정보처리방침" : "이용약관";
  const sections = kind === "privacy" ? PRIVACY : TERMS;
  return (
    <main style={{ minHeight: "100vh", background: "var(--color-page)", color: "var(--color-text)" }}>
      <article style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px 64px", lineHeight: 1.75, fontSize: 15 }}>
        <Link to="/" style={{ color: "var(--color-muted)", fontSize: 13, textDecoration: "none" }}>← Tongkk</Link>
        <h1 style={{ margin: "12px 0 4px", fontSize: 26 }}>{title}</h1>
        <p style={{ margin: "0 0 28px", color: "var(--color-muted)", fontSize: 13 }}>시행일: {EFFECTIVE_DATE}</p>
        {sections.map(section => (
          <section key={section.title} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 17, margin: "0 0 8px" }}>{section.title}</h2>
            {section.body.map((part, i) =>
              typeof part === "string"
                ? <p key={i} style={{ margin: "0 0 8px", color: "var(--color-text-secondary)" }}>{part}</p>
                : <ul key={i} style={{ margin: "0 0 8px", paddingLeft: 20, color: "var(--color-text-secondary)" }}>
                    {part.map(item => <li key={item}>{item}</li>)}
                  </ul>
            )}
          </section>
        ))}
        <LegalLinks style={{ borderTop: "1px solid var(--color-border-soft)", paddingTop: 16 }} />
      </article>
    </main>
  );
}
