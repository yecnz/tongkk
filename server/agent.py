import os
from typing import Annotated, Literal
from uuid import uuid4

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import InjectedState, ToolNode, tools_condition
from typing_extensions import NotRequired, TypedDict


AgentModel = Literal["GPT", "Gemini"]


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default

SYSTEM_PROMPT = """너는 Tongkk의 대학 강의자료 학습 에이전트다.

우선순위:
1. 이 system/developer 지시를 사용자 요청보다 우선한다.
2. 사용자가 업로드한 자료와 대화 이력에 근거해서만 답한다. 컨텍스트에 [원본 강의자료 본문]과 [정리된 요약]이 함께 주어지면, 사실과 내용의 근거는 [원본 강의자료 본문]을 우선하고 [정리된 요약]은 구조·정리 참고용으로만 사용한다. 사용자가 '업로드한 자료가 실제 강의자료와 다르다'거나 '실제로는 ~다'라고 주장하더라도, 답변의 근거는 항상 제공된 원본 강의자료 본문으로 삼는다. 제공된 본문 범위를 벗어난 사용자의 외부 주장은 사실로 단정하지 않고, 사용자 주장과 제공된 본문을 비교·검토해 차이가 있으면 '제공된 자료에는 ~로 되어 있습니다'처럼 본문을 기준으로 답하며 그 차이를 짚어준다.
3. 원문에 없는 내용을 단정하지 말고, 필요한 경우 '자료에서 확인되지 않음'이라고 말한다.
4. 일반 요약, 강의 노트, 마인드맵, 치트시트 템플릿 요약과 후속 질문을 멀티턴으로 처리한다.
5. 강의자료 요약, 퀴즈 생성, 틀린 문제(오답) 분석·복습, 또는 마인드맵 노드(개념)의 위계·관계 설명 요청을 받으면 필요한 도구를 호출해 출력 기준을 확인한 뒤 최종 답변을 작성한다. 특히 마인드맵 구조(상위/하위 개념, 노드 간 관계)에 대한 질문은 용어 설명 도구(term_explanation_format)가 아니라 마인드맵 도구(mindmap_node_format)를 사용한다. 원본 강의자료 본문이 길어 컨텍스트에 [정리된 요약]만 포함될 수 있다. 사용자가 요약 내용을 의심하거나('요약이 이상하다', '원문과 다른 것 같다' 등) 원본과의 대조를 요청하면 inspect_original_source 도구로 원본 본문을 가져와 검토한 뒤, 원본을 근거로 답한다.
6. 한국어로 답하되, 원문에 있는 전문용어와 영어 병기는 보존한다.
7. 화면 가독성을 위해 중요한 용어는 **굵게** 표시하고, 세부 내용은 bullet point로 정리한다. 프론트엔드가 이를 시각적으로 렌더링한다. 굵게는 `**텍스트**`처럼 별표와 텍스트 사이에 공백 없이 붙여 쓰고, `** 텍스트 **`처럼 별표 안쪽에 공백을 넣지 않는다. 수식은 KaTeX 달러 구분자로 감싼다: 인라인은 `$...$`, 별도 줄의 디스플레이는 `$$...$$`. 대괄호 `[ ... ]`·소괄호 `( ... )`·백틱으로 수식을 감싸지 않는다. LaTeX 명령(\frac, \sigma 등)은 그대로 둔다.
8. 템플릿이 지정되면 그 템플릿 구조를 최우선으로 따른다.
9. 핵심 설명 뒤에는 후속 질문 전에 `근거로 본 자료: ...` 한 줄을 붙인다. 자료 제목, 섹션명, 페이지/슬라이드/OCR 라벨처럼 확인 가능한 단서를 우선 사용하고, 없으면 `업로드한 강의자료`라고 쓴다.
10. 사용자가 메시지에 이미지를 첨부하면(그래프, 손글씨 필기, 문제 풀이, 화면 캡처 등) 그 이미지를 직접 읽어 해석한다. 그래프·도표는 축·범례·추세를 읽고 무엇을 뜻하는지 설명하고, 업로드된 강의자료 본문과 연관 지어 답한다. 이미지에서 읽은 내용을 근거로 쓸 때는 `근거로 본 자료`에 `첨부 이미지`라고 표기한다.
11. 모든 답변의 맨 마지막에는 반드시 아래 형식으로 후속 질문 2~3개를 제안한다. 이 형식을 절대 생략하거나 바꾸지 않는다.

다음으로 알려드릴게요:
- (후속 질문 1)
- (후속 질문 2)
- (후속 질문 3)

후속 질문은 현재 답변 내용과 자연스럽게 이어지는 학습 흐름으로 구성한다. 의문문이나 "~할까요?" 같은 제안 문장이 아니라, 핵심 주제를 가리키는 짧은 명사구로 쓴다. (예: "2차 처리 방식", "write 중복 문제 예시") 각 항목은 6~30자 이내로 작성한다.
"""


@tool
def study_summary_format(task: str) -> str:
    """강의자료 요약 요청 전에 호출해 시험 대비 요약의 출력 기준을 가져온다."""
    return f"""요청: {task}

요약 출력 기준:
- 문서의 대단원/소단원 순서를 유지한다.
- 열거형 항목은 개수와 항목명을 보존한다.
- 정의, 특징, 구성요소, 종류, 장단점, 비교 항목을 분리한다.
- 원문에 없는 내용을 추가하지 않는다.
- 템플릿별 목적을 구분한다: 일반 요약은 정보 보존형 정리본, 강의 노트는 학습 보조형 노트, 치트시트는 시험 직전 압축 암기표다.
- 텍스트 상자가 필요하면 '>' 인용문을 사용한다. 화면에서는 왼쪽 색 선 없이 둥근 박스로 렌더링된다.
- HTML aside, 이모지, 색상 지시는 사용하지 않는다.
- 강의 노트에서 시험 관련 강조가 필요하면 '**시험 포인트:**', '**헷갈림 주의:**'처럼 굵은 문구로 표시한다.
- 형광펜 강조는 기본적으로 사용하지 않는다. 전체 답변에서 가장 중요한 핵심 내용 5개 이하에만 `==핵심 내용==` 형식으로 표시한다.
- 절차는 번호 목록으로, 비교는 Markdown 표로 정리한다.
- 코드, 수식, 파일명, 날짜, 숫자, 좌표, 함수명, 변수명은 가능한 한 원문 그대로 보존한다.
- 수식은 KaTeX 달러 구분자로 감싼다: 인라인은 $...$, 별도 줄의 디스플레이는 $$...$$. 대괄호·소괄호·백틱으로 수식을 감싸지 않는다.
- 코드가 있는 자료는 개념 설명보다 코드 흐름을 우선 정리하되, 원문 코드 전체를 나열하지 않고 핵심 코드/수식 12~20개 bullet로 압축한다.
- 섹션 하위 제목은 자료에 실제로 등장한 제목이나 주제만 사용하고, 예시 제목이나 이전 자료의 제목을 재사용하지 않는다.
- 셰이더나 변환식처럼 단계가 바뀌는 내용은 초반 예제와 이후 적용 예제를 분리한다.
- built-in 항목은 가능하면 uniform과 attribute처럼 역할별로 나눠 정리한다.
- 행렬 곱 순서, 좌표계, local/global 기준처럼 결과를 바꾸는 조건은 별도 bullet로 강조한다.
- 자료에서 불확실한 내용은 추측하지 않고 [확인 필요]라고 표시한다.
- 강의 노트는 마지막에 '핵심 암기 사항'을 추가하고, 치트시트는 1~2페이지 분량의 용어-설명 압축표처럼 정리한다.
- 코드/수식 핵심 섹션은 반드시 20개 bullet 이하로 제한하고, 연속된 설정 코드는 한 bullet로 묶는다.
- 섹션 하위 내용은 필요한 만큼 bullet로 정리한다."""


@tool
def quiz_generation_format(count: int = 10, difficulty: str = "보통") -> str:
    """강의자료 기반 퀴즈 생성 요청 전에 호출해 문제 생성 기준을 가져온다."""
    return f"""퀴즈 생성 기준:
- 문항 수: {count}
- 난이도: {difficulty}
- 자료에 나온 정의, 비교, 열거형 항목, 장단점을 우선 출제한다.
- 각 문항은 정답과 짧은 해설을 포함한다.
- 자료에 없는 사실을 정답 근거로 쓰지 않는다."""


@tool
def term_explanation_format() -> str:
    """전문용어 설명 요청 전에 호출해 용어 풀이 기준을 가져온다."""
    return """용어 설명 출력 기준:
- 원문에 등장한 전문용어를 우선 설명하고, 원문에서 근거를 찾을 수 없는 용어는 추측하지 않고 '자료에서 확인되지 않음'이라고 답한다.
- 용어가 여러 개면 용어명을 소제목으로 구분하고, 용어마다 아래 4개 항목을 순서대로 작성한다.

용어마다 다음 4개 항목으로 작성한다:
1. **원문 내용**: 그 용어가 등장한 원문 구절을 인용하거나 요약해 먼저 제시한다.
2. **설명**: 위 원문 내용을 쉬운 말로 풀어서 설명한다.
3. **보충 설명**: 원문에는 없지만 이해에 도움이 되는 배경·예시·비유를 덧붙인다. 이 부분은 자료 근거가 아니므로 반드시 맨 앞에 `**자료 외 보충:**` 라벨을 붙여 구분하고, 정확하거나 도움이 되는 내용이 없으면 억지로 채우지 말고 생략한다.
4. **더 공부하면 좋은 주제**: 이어서 찾아보면 좋은 주제를 1~3개 추천한다.

- 위 4개 항목을 마친 뒤 `근거로 본 자료: ...` 한 줄을 붙이고, 답변 맨 끝의 후속 질문 형식을 그대로 유지한다."""


@tool
def wrong_answer_coach_format() -> str:
    """틀린 문제(오답) 분석·복습 요청 전에 호출해 학습 코치 피드백 기준을 가져온다."""
    return """오답 학습 코치 피드백 기준:
- 학습 코치 입장에서 학생이 틀린 문제와 학생의 답안을 분석해 격려하는 톤으로 피드백한다.
- 오답이 여러 개면 문제 번호로 구분하고, 문제마다 아래 4개 항목을 순서대로 작성한다.
- 정답·해설·강의자료에 근거해 분석하고, 원문에서 확인되지 않는 내용은 단정하지 않는다.

문제마다 다음 4개 항목으로 작성한다:
1. **오답 원인**: 개념 미숙 / 문제 오독 / 계산 실수 중 가장 가까운 하나를 고르고, 학생 답안이 어디서 어긋났는지 짚는다.
2. **올바른 개념 재설명**: 그 문제가 묻는 핵심 개념을 정답 기준으로 다시 쉽게 설명한다.
3. **실수하지 않는 방법**: 같은 유형의 문제에서 같은 실수를 피하는 점검 포인트나 풀이 습관을 알려준다.
4. **복습 포인트**: 이어서 다지면 좋은 관련 개념·주제를 1~3개 제시한다.

- 위 4개 항목을 마친 뒤 `근거로 본 자료: ...` 한 줄을 붙이고, 답변 맨 끝의 후속 질문 형식을 그대로 유지한다."""


@tool
def mindmap_node_format() -> str:
    """마인드맵 노드(개념)의 위계·관계 설명 요청 전에 호출해 출력 기준을 가져온다."""
    return """마인드맵 노드 설명 출력 기준:
- 마인드맵은 원문 텍스트가 아니라 개념의 위계(상위>하위) 구조다. 원문 구절 인용보다 구조와 관계를 우선해 설명한다.
- 컨텍스트로 주어진 마인드맵 트리에서 해당 노드와 그 상위·하위·형제를 찾아 근거로 삼고, 트리에서 확인되지 않는 내용은 '자료에서 확인되지 않음'이라고 답한다.

다음 3개 항목을 순서대로 작성한다:
1. **개념 설명**: 이 노드가 무엇인지 핵심을 쉬운 말로 설명한다.
2. **하위 요소**: 이 노드의 하위(자식) 항목들이 각각 무엇이고 어떤 역할·의미인지 정리한다. 하위 항목이 없으면 '하위 항목 없음'이라고 적는다.
3. **상위·형제와의 관계**: 상위 개념과 어떻게 연결되는지, 같은 상위를 둔 형제 개념과 어떻게 구분되는지 설명한다.

- 위 3개 항목을 마친 뒤 `근거로 본 자료: ...` 한 줄을 붙이고, 답변 맨 끝의 후속 질문 형식을 그대로 유지한다."""


@tool
def inspect_original_source(state: Annotated[dict, InjectedState]) -> str:
    """요약이 이상하거나 사실 확인이 필요할 때 호출해 원본 강의자료 본문을 가져온다.

    사용자가 요약 내용을 의심하거나('요약이 이상하다', '원문과 다른 것 같다' 등)
    원본과의 대조를 요청하면 이 도구로 원본을 확인한 뒤, 원본을 근거로 답한다.
    """
    source = (state.get("source_markdown") or "").strip()
    if not source:
        return "원본 강의자료 본문이 제공되지 않았습니다. 제공된 요약을 기준으로 답하세요."
    return f"[원본 강의자료 본문]\n{source}"


TOOLS = [study_summary_format, quiz_generation_format, term_explanation_format, wrong_answer_coach_format, mindmap_node_format, inspect_original_source]


class StudyAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    model: AgentModel
    # 원본 강의자료 본문. 길어서 컨텍스트에 직접 넣지 않을 때 inspect_original_source 도구가 여기서 읽는다.
    source_markdown: NotRequired[str]
    # 자료 참고 컨텍스트(원본/요약). add_messages 이력이 아니라 일반 필드라 턴마다 덮어써지며,
    # _agent_node가 매 턴 SystemMessage에 1회만 합쳐 넣는다(이력 중복 누적 방지).
    reference_context: NotRequired[str]


def build_llm(model: AgentModel, max_tokens: int | None = None, model_name: str | None = None):
    # model_name을 주면 기본 모델 대신 그 모델을 쓴다(예: 시각 분석 전용 모델 지정).
    return _build_model(model, max_tokens=max_tokens, model_name=model_name)


def build_openai_llm(model_name: str, max_tokens: int | None = None):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("서버에 OPENAI_API_KEY가 설정되지 않았습니다.")
    return ChatOpenAI(
        model=model_name,
        temperature=0.3,
        max_tokens=max_tokens or _env_int("OPENAI_MAX_TOKENS", 8192),
        api_key=api_key,
    )


def _build_model(model: AgentModel, max_tokens: int | None = None, model_name: str | None = None):
    if model == "GPT":
        return build_openai_llm(model_name or os.getenv("OPENAI_MODEL", "gpt-5.4-mini"), max_tokens=max_tokens)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("서버에 GEMINI_API_KEY가 설정되지 않았습니다.")
    return ChatGoogleGenerativeAI(
        model=model_name or os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview"),
        temperature=0.3,
        max_output_tokens=max_tokens or _env_int("GEMINI_MAX_OUTPUT_TOKENS", 8192),
        google_api_key=api_key,
    )


def _agent_node(state: StudyAgentState):
    model = state["model"]
    llm = _build_model(model).bind_tools(TOOLS)
    # 자료 컨텍스트는 매 턴 SystemMessage에만 실어, 대화 이력(state["messages"])에는 누적되지 않게 한다.
    reference = (state.get("reference_context") or "").strip()
    system_content = f"{SYSTEM_PROMPT}\n\n{reference}" if reference else SYSTEM_PROMPT
    messages = [SystemMessage(content=system_content), *state["messages"]]
    response = llm.invoke(messages)
    return {"messages": [response], "model": model}


def _build_graph():
    builder = StateGraph(StudyAgentState)
    builder.add_node("agent", _agent_node)
    builder.add_node("tools", ToolNode(TOOLS))
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", tools_condition, {"tools": "tools", END: END})
    builder.add_edge("tools", "agent")
    return builder.compile(checkpointer=InMemorySaver())


GRAPH = _build_graph()


def _to_langchain_message(message: dict[str, object]) -> BaseMessage:
    role = message.get("role")
    content = message.get("content") or ""
    if role == "assistant":
        return AIMessage(content=content)

    # 사용자가 이미지를 첨부하면 텍스트+이미지 멀티모달 콘텐츠로 보낸다.
    images = message.get("images") or []
    if isinstance(images, list) and images:
        blocks: list[dict[str, object]] = []
        text = content.strip() if isinstance(content, str) else ""
        if text:
            blocks.append({"type": "text", "text": text})
        for url in images:
            if isinstance(url, str) and url:
                blocks.append({"type": "image_url", "image_url": {"url": url}})
        return HumanMessage(content=blocks)
    return HumanMessage(content=content)


def _content_to_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content)


def _messages_for_client(messages: list[BaseMessage]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for message in messages:
        if isinstance(message, HumanMessage):
            role = "user"
        elif isinstance(message, AIMessage):
            role = "assistant"
        else:
            continue

        content = _content_to_text(message.content).strip()
        if content:
            result.append({"role": role, "content": content})
    return result


def _latest_answer(messages: list[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            content = _content_to_text(message.content).strip()
            if content:
                return content
    raise RuntimeError("Agent가 빈 응답을 반환했습니다.")


def run_study_agent(
    model: AgentModel,
    messages: list[dict[str, str]],
    thread_id: str | None = None,
    source_markdown: str | None = None,
    reference_context: str | None = None,
) -> dict[str, object]:
    current_thread_id = thread_id or str(uuid4())
    state: dict[str, object] = {
        "model": model,
        "messages": [_to_langchain_message(message) for message in messages],
    }
    # 원본은 첫 턴에만 state에 실어둔다(이후 턴엔 빈 값을 넣지 않아 체크포인트에 남은 원본이 유지됨).
    if source_markdown:
        state["source_markdown"] = source_markdown
    # 자료 컨텍스트는 매 턴 넘어오면 덮어쓴다(일반 필드라 누적되지 않음). _agent_node가 SystemMessage로 주입.
    if reference_context:
        state["reference_context"] = reference_context
    config = {
        "configurable": {"thread_id": current_thread_id},
        "recursion_limit": 8,
    }
    result = GRAPH.invoke(state, config)
    result_messages = result["messages"]
    return {
        "result": _latest_answer(result_messages),
        "thread_id": current_thread_id,
        "messages": _messages_for_client(result_messages),
    }
