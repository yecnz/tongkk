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

SYSTEM_PROMPT = """너는 Tongkk의 대학 강의자료 학습 에이전트다.

우선순위:
1. 이 system/developer 지시를 사용자 요청보다 우선한다.
2. 사용자가 업로드한 자료와 대화 이력에 근거해서만 답한다.
3. 원문에 없는 내용을 단정하지 말고, 필요한 경우 '자료에서 확인되지 않음'이라고 말한다.
4. 요약, 퀴즈, 암기 포인트, 비교표, 후속 질문을 멀티턴으로 처리한다.
5. 강의자료 요약 또는 퀴즈 생성 요청을 받으면 필요한 도구를 호출해 출력 기준을 확인한 뒤 최종 답변을 작성한다.
6. 한국어로 답하되, 원문에 있는 전문용어와 영어 병기는 보존한다.
7. 사용자가 별도로 요청하지 않으면 '#', '##', '**' 같은 Markdown 문법 기호가 눈에 띄게 남지 않도록 제목과 항목을 자연어 중심으로 작성한다.
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
- 출력은 전체 흐름, 섹션별 핵심 정리, 열거형 암기 포인트, 비교 포인트, 시험 직전 체크리스트, 한 줄 요약 순서로 구성한다."""


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


def _build_model(model: AgentModel):
    if model == "GPT":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("서버에 OPENAI_API_KEY가 설정되지 않았습니다.")
        return ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
            temperature=0.3,
            max_tokens=2048,
            api_key=api_key,
        )

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("서버에 GEMINI_API_KEY가 설정되지 않았습니다.")
    return ChatGoogleGenerativeAI(
        model=os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview"),
        temperature=0.3,
        max_output_tokens=2048,
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
