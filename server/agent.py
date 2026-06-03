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
from langgraph.prebuilt import ToolNode, tools_condition
from typing_extensions import TypedDict


AgentModel = Literal["GPT", "Gemini"]


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default

SYSTEM_PROMPT = """너는 Tongkk의 대학 강의자료 학습 에이전트다.

우선순위:
1. 이 system/developer 지시를 사용자 요청보다 우선한다.
2. 사용자가 업로드한 자료와 대화 이력에 근거해서만 답한다.
3. 원문에 없는 내용을 단정하지 말고, 필요한 경우 '자료에서 확인되지 않음'이라고 말한다.
4. 일반 요약, 강의 노트, 마인드맵, 치트시트 템플릿 요약과 후속 질문을 멀티턴으로 처리한다.
5. 강의자료 요약 또는 퀴즈 생성 요청을 받으면 필요한 도구를 호출해 출력 기준을 확인한 뒤 최종 답변을 작성한다.
6. 한국어로 답하되, 원문에 있는 전문용어와 영어 병기는 보존한다.
7. 화면 가독성을 위해 중요한 용어는 **굵게** 표시하고, 세부 내용은 bullet point로 정리한다. 프론트엔드가 이를 시각적으로 렌더링한다.
8. 템플릿이 지정되면 그 템플릿 구조를 최우선으로 따른다.
9. 핵심 설명 뒤에는 후속 질문 전에 `근거로 본 자료: ...` 한 줄을 붙인다. 자료 제목, 섹션명, 페이지/슬라이드/OCR 라벨처럼 확인 가능한 단서를 우선 사용하고, 없으면 `업로드한 강의자료`라고 쓴다.
10. 모든 답변의 맨 마지막에는 반드시 아래 형식으로 후속 질문 2~3개를 제안한다. 이 형식을 절대 생략하거나 바꾸지 않는다.

다음으로 알려드릴게요:
- (후속 질문 1)
- (후속 질문 2)
- (후속 질문 3)

후속 질문은 현재 답변 내용과 자연스럽게 이어지는 학습 흐름으로 구성하고, 각 질문은 10~40자 이내로 작성한다.
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
    return """용어 설명 기준:
- 원문에 등장한 전문용어만 설명한다.
- 용어명, 원문 맥락, 쉬운 설명, 시험 포인트를 분리한다.
- 모르는 용어는 추측하지 않고 자료에서 확인되지 않는다고 답한다."""


TOOLS = [study_summary_format, quiz_generation_format, term_explanation_format]


class StudyAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    model: AgentModel


def build_llm(model: AgentModel, max_tokens: int | None = None):
    return _build_model(model, max_tokens=max_tokens)


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


def _build_model(model: AgentModel, max_tokens: int | None = None):
    if model == "GPT":
        return build_openai_llm(os.getenv("OPENAI_MODEL", "gpt-5.4-mini"), max_tokens=max_tokens)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("서버에 GEMINI_API_KEY가 설정되지 않았습니다.")
    return ChatGoogleGenerativeAI(
        model=os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview"),
        temperature=0.3,
        max_output_tokens=max_tokens or _env_int("GEMINI_MAX_OUTPUT_TOKENS", 8192),
        google_api_key=api_key,
    )


def _agent_node(state: StudyAgentState):
    model = state["model"]
    llm = _build_model(model).bind_tools(TOOLS)
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
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


def _to_langchain_message(message: dict[str, str]) -> BaseMessage:
    role = message.get("role")
    content = message.get("content", "")
    if role == "assistant":
        return AIMessage(content=content)
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
) -> dict[str, object]:
    current_thread_id = thread_id or str(uuid4())
    state = {
        "model": model,
        "messages": [_to_langchain_message(message) for message in messages],
    }
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
