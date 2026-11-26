// Prepared examples for the same sorting material used by the product demo.
// This is intentionally local: the promotional page never calls the AI service.
export type TutorSample = {
  key: string;
  question: string;
  answer: string;
  followups: string[];
};

export const tutorSamples: TutorSample[] = [
  {
    key: 'selection',
    question: '선택 정렬은 왜 O(n²)인가요?',
    answer: `선택 정렬은 **남은 원소 전체에서 최솟값을 찾는 과정**을 반복해요.

원소가 5개라면 비교 횟수는 이렇게 줄어듭니다.

- 첫 번째 자리를 정할 때: 4번
- 두 번째 자리를 정할 때: 3번
- 이후: 2번, 1번

총 비교 횟수는 $4 + 3 + 2 + 1 = 10$번이에요. 원소가 $n$개라면

$$ (n-1) + (n-2) + \\cdots + 1 = \\frac{n(n-1)}{2} $$

가 됩니다. 가장 빠르게 커지는 항이 $n^2$이므로 **평균·최악 시간 복잡도는 $O(n^2)$**예요. 이미 정렬되어 있어도 매번 최솟값을 찾아야 한다는 점이 핵심이에요.

**확인해 보기:** 입력이 2배가 되면 비교 횟수는 대략 4배가 됩니다. 그래서 평균이 $O(n \\log n)$인 병합·퀵·힙 정렬과 구분해야 해요.

근거로 본 자료: 알고리즘 3주차 강의자료.pdf · 대표 정렬 알고리즘`,
    followups: ['퀵 정렬도 최악에는 O(n²)인가요?', 'Big-O를 쉬운 예시로 설명해줘'],
  },
  {
    key: 'quick',
    question: '퀵 정렬도 최악에는 O(n²)인가요?',
    answer: `네. 퀵 정렬은 **평균 $O(n \\log n)$, 최악 $O(n^2)$**입니다. 둘을 구분해야 해요.

- **균형 있게 나뉠 때:** 피벗을 기준으로 원소가 비슷한 크기의 두 그룹으로 나뉘면, 분할 깊이가 약 $\\log n$이에요.
- **한쪽으로 치우칠 때:** 피벗이 계속 최솟값이나 최댓값이면, 한쪽에는 0개, 다른 쪽에는 $n-1$개가 남아요.

두 번째 상황이 반복되면 처리할 크기가 $n, n-1, n-2, \\ldots$처럼 줄어들어 전체 비용이 $O(n^2)$까지 커집니다.

따라서 **“입력과 무관하게 항상 $O(n \\log n)$이다”는 X**예요. 평균 성능이 좋다는 말이 모든 입력에서 같은 성능을 보장한다는 뜻은 아닙니다.

근거로 본 자료: 알고리즘 3주차 강의자료.pdf · 대표 정렬 알고리즘`,
    followups: ['병합 정렬과 퀵 정렬은 언제 쓰나요?', 'Big-O를 쉬운 예시로 설명해줘'],
  },
  {
    key: 'stable',
    question: '안정 정렬은 무슨 뜻인가요?',
    answer: `**안정 정렬은 값이 같은 원소들의 원래 순서를 유지하는 정렬**이에요. 값만 정렬되는 것이 아니라, 같은 값을 가진 항목의 순서도 살펴봐야 합니다.

같은 값 2를 구분해서 $[2_A, 2_B, 1]$이라고 해볼게요.

선택 정렬은 최솟값 1과 맨 앞의 $2_A$를 교환하므로 $[1, 2_B, 2_A]$가 될 수 있어요. 처음에는 A가 B보다 앞이었는데, 정렬 뒤에는 순서가 바뀌었죠. 그래서 **선택 정렬은 불안정**합니다.

샘플 자료에서는 버블·삽입·병합 정렬을 안정 정렬로, 선택·퀵·힙 정렬을 불안정 정렬로 분류해요. 일반적인 구현을 기준으로 하며, 같은 값은 교환하지 않는 등 각 알고리즘의 조건을 지켜야 합니다.

**확인해 보기:** 이름순으로 정리된 학생을 점수순으로 다시 정렬한다면, 안정 정렬은 같은 점수의 학생들끼리 이름순을 유지해요.

근거로 본 자료: 알고리즘 3주차 강의자료.pdf · 대표 정렬 알고리즘 / 어떤 정렬을 언제 쓰나`,
    followups: ['병합 정렬과 퀵 정렬은 언제 쓰나요?', '선택 정렬은 왜 O(n²)인가요?'],
  },
  {
    key: 'complexity',
    question: 'Big-O를 쉬운 예시로 설명해줘',
    answer: `Big-O는 **입력이 많아질수록 필요한 연산이 얼마나 빠르게 늘어나는지**를 나타내요. 정확히 몇 초 걸리는지보다는 증가하는 모양을 비교합니다.

- **$O(1)$:** 배열의 특정 번호를 바로 읽기. 입력이 늘어도 한 번의 접근이에요.
- **$O(\\log n)$:** 정렬된 목록에서 이진 탐색하기. 한 번 비교할 때마다 찾을 범위가 절반으로 줄어요.
- **$O(n)$:** 목록 전체를 한 번 확인하기. 입력이 2배면 연산도 대략 2배예요.
- **$O(n^2)$:** 모든 원소를 서로 비교하는 형태. 입력이 2배면 연산은 대략 4배가 돼요.

**이해했는지 확인하는 방법:** “선택 정렬은 $O(n^2)$”를 외우는 데서 끝내지 않고, 왜 비교 횟수가 $(n-1)+(n-2)+\\cdots+1$인지 설명해보세요.

근거로 본 자료: 알고리즘 3주차 강의자료.pdf · 시간 복잡도와 Big-O 표기`,
    followups: ['선택 정렬은 왜 O(n²)인가요?', '퀵 정렬도 최악에는 O(n²)인가요?'],
  },
  {
    key: 'compare',
    question: '병합 정렬과 퀵 정렬은 언제 쓰나요?',
    answer: `**안정성, 최악 시간, 추가 메모리**를 함께 비교하면 선택 이유를 설명할 수 있어요.

| 기준 | 병합 정렬 | 퀵 정렬 |
| --- | --- | --- |
| 평균 시간 | $O(n \\log n)$ | $O(n \\log n)$ |
| 최악 시간 | $O(n \\log n)$ | $O(n^2)$ |
| 안정성 | 안정 | 불안정 |
| 추가 공간 | 병합용 배열 $O(n)$ | 보통 별도 배열 없이 제자리 분할 |

같은 값의 원래 순서를 유지해야 하면 **병합 정렬**을 고려해요. 추가 배열을 아끼고 평균적인 성능을 활용하려면 **퀵 정렬**을 고려할 수 있어요. 단, 퀵 정렬도 재귀 호출 스택 공간은 사용합니다.

**확인해 보기:** “평균 시간이 같으니 둘은 똑같다”라고 할 수 있을까요? 안정성·최악 시간·메모리 조건이 다르기 때문에, 상황에 따라 선택이 달라져요.

근거로 본 자료: 알고리즘 3주차 강의자료.pdf · 대표 정렬 알고리즘 / 어떤 정렬을 언제 쓰나`,
    followups: ['안정 정렬은 무슨 뜻인가요?', '퀵 정렬도 최악에는 O(n²)인가요?'],
  },
];

export const initialTutorQuestions = [tutorSamples[0].question, tutorSamples[1].question, tutorSamples[2].question];

export function findTutorSample(question: string): TutorSample | undefined {
  const exact = tutorSamples.find(sample => sample.question === question.trim());
  if (exact) return exact;
  const query = question.toLowerCase().replace(/\s+/g, '');
  // These routes select prepared examples; they do not pretend to interpret any question.
  const key = /안정|stable/.test(query) ? 'stable'
    : /병합|merge|메모리|공간|비교해|차이/.test(query) ? 'compare'
    : /퀵|quick|피벗|pivot/.test(query) ? 'quick'
    : /선택|selection|아닌.*정렬|정렬.*아닌/.test(query) ? 'selection'
    : /big.?o|복잡도|증가율|이진탐색/.test(query) ? 'complexity' : undefined;
  return tutorSamples.find(sample => sample.key === key);
}

export const unsupportedTutorAnswer = `이 체험은 **준비된 질문과 답변**으로 학습 흐름을 보여드려요. 입력하신 질문에 대한 새 AI 답변은 생성하지 않습니다.

선택 정렬의 시간 복잡도, 퀵 정렬의 최악 상황, 안정 정렬에 대해 아래 예시 질문을 눌러보세요. 실제 서비스에서는 내 자료를 바탕으로 AI 튜터에게 질문할 수 있어요.`;
