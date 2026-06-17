// 단답형 채점용 순서 독립 토큰 매처.
// 기존 채점은 normalizeAnswer(공백·문장부호를 지운 뒤 단일 문자열 정확 일치)뿐이라
// "유독성 2차 대사산물"과 "2차 대사산물, 유독성"처럼 같은 답을 순서가 다르다는 이유로 오답 처리했다.
// 여기서는 답을 구분자(쉼표·세미콜론·슬래시·가운뎃점·공백 등)로 토큰화해 멀티셋(순서 무관)으로 비교하고,
// 긴 라틴 단어에 한해 1글자 오타(편집거리 1)만 허용한다. 한국어·숫자·짧은 토큰은 반의어/근접쌍
// 오인을 막기 위해 정확 일치만 인정한다.

// 오타 허용을 적용할 라틴 단어의 최소 길이. penicillium(11)은 통과하되, serene/serine(6)·
// 아미노산명(serine·valine·alanine 등 6~7자)처럼 한 글자 차로 의미가 갈리는 근접쌍은 정확 일치만 보게 한다.
const MIN_FUZZY_LEN = 8;

// 기존 Quiz.tsx의 normalizeAnswer와 같은 문자 클래스(소문자화·공백 제거·문장부호 제거)를 쓰되
// 전각/반각 차이를 흡수하도록 NFKC 정규화를 먼저 적용한다. 따라서 기존에 정답이던 답은 회귀하지 않는다.
const normalize = (value: string): string =>
  value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[.,:;!?()[\]{}'"`]/g, "");

// 답을 토큰으로 쪼갠다: 쉼표(,，)·일본어 쉼표(、)·세미콜론(;；)·슬래시(/)·가운뎃점(·・)·공백 기준.
const tokenize = (value: string): string[] =>
  value
    .split(/[,，、;；/·・\s]+/)
    .map(normalize)
    .filter(token => token.length > 0);

// 순수 라틴 알파벳 단어만 오타 허용 대상. 한국어·숫자·혼합 토큰은 정확 일치만 인정한다.
const isLatinWord = (token: string): boolean => /^[a-z]+$/.test(token);

// 편집거리(Levenshtein). 입력이 짧아 표준 2행 DP로 충분하다.
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
};

// 두 토큰이 같은가: 정확히 같으면 true. 둘 다 길이 MIN_FUZZY_LEN 이상의 라틴 단어면 1글자 오타까지 허용.
const tokensEqual = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (!isLatinWord(a) || !isLatinWord(b)) return false; // 한국어·숫자·혼합 토큰은 정확 일치만
  if (Math.min(a.length, b.length) < MIN_FUZZY_LEN) return false; // 짧은 단어는 근접쌍 오수용 위험
  return levenshtein(a, b) <= 1;
};

// 단답형 정답 여부. 순서를 무시하고 토큰 멀티셋이 1:1로 대응하면 정답으로 본다.
export const isShortAnswerCorrect = (student: string, reference: string): boolean => {
  // (a) 통째 정확 일치 경로: 기존 동작을 그대로 보존(현재 정답인 답은 회귀 없음).
  if (normalize(student) === normalize(reference)) return true;

  // (b) 멀티셋 경로: 토큰 수가 같아야 하고(부분답·잉여 토큰 차단), 모든 정답 토큰이
  //     서로 다른 학생 토큰과 1:1로 짝지어져야 한다.
  const studentTokens = tokenize(student);
  const referenceTokens = tokenize(reference);
  if (studentTokens.length === 0 || referenceTokens.length === 0) return false;
  if (studentTokens.length !== referenceTokens.length) return false;

  const used = new Array<boolean>(studentTokens.length).fill(false);
  const unmatched: string[] = [];

  // 1차: 정확 일치만 소비(오타 허용이 정확 짝을 가로채지 않도록).
  for (const ref of referenceTokens) {
    const idx = studentTokens.findIndex((token, i) => !used[i] && token === ref);
    if (idx >= 0) used[idx] = true;
    else unmatched.push(ref);
  }

  // 2차: 남은 정답 토큰을 오타 허용으로 소비.
  for (const ref of unmatched) {
    const idx = studentTokens.findIndex((token, i) => !used[i] && tokensEqual(token, ref));
    if (idx < 0) return false;
    used[idx] = true;
  }

  return true;
};
