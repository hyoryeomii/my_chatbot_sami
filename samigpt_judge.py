import os

import requests
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult


class SamiGPTJudge(BaseChatModel):
    api_url: str
    api_key: str
    model_name: str
    timeout_seconds: int = 180

    @property
    def _llm_type(self) -> str:
        return "samigpt-judge"

    def _generate(
        self,
        messages,
        stop=None,
        run_manager=None,
        **kwargs,
    ) -> ChatResult:
        # RAGAS가 만든 평가 질문을 SamiGPT 메시지로 변환
        converted_messages = []

        roles = {
            "system": "system",
            "human": "user",
            "ai": "assistant",
        }

        for message in messages:
            role = roles.get(message.type)

            if role is None:
                raise RuntimeError(
                    f"지원하지 않는 평가 메시지 유형: {message.type}"
                )

            if not isinstance(message.content, str):
                raise RuntimeError("평가 메시지가 텍스트 형식이 아닙니다.")

            converted_messages.append({
                "role": role,
                "content": message.content,
            })

        token = self.api_key.strip()

        if token.lower().startswith("bearer "):
            token = token[7:].strip()

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
            "Organization": "sami",
            "X-Organization-Code": "sami",
        }

        cookie = os.getenv("RAGAS_JUDGE_COOKIE", "").strip()
        session_id = os.getenv(
            "RAGAS_JUDGE_CHAT_SESSION_ID", ""
        ).strip()

        if cookie:
            headers["Cookie"] = cookie

        if session_id:
            headers["Chat-Session-Id"] = session_id

        payload = {
            "model": self.model_name,
            "messages": converted_messages,
            "reasoning_effort": "medium",
            "temperature": 0,
            "stream": False,
            "org_code": "sami",
            "organization": "sami",
        }

        if stop:
            payload["stop"] = stop

        response = requests.post(
            self.api_url,
            headers=headers,
            json=payload,
            timeout=self.timeout_seconds,
        )

        # 인증 정보나 응답 본문은 오류 메시지에 출력하지 않음
        if not response.ok:
            raise RuntimeError(
                f"SamiGPT 평가 API 오류: HTTP {response.status_code}"
            )

        try:
            data = response.json()
        except ValueError as exc:
            raise RuntimeError(
                "SamiGPT 평가 API가 JSON 응답을 반환하지 않았습니다."
            ) from exc

        choices = data.get("choices")

        if not isinstance(choices, list) or not choices:
            raise RuntimeError(
                "SamiGPT 응답에 choices가 없습니다."
            )

        choice = choices[0]
        content = choice.get("message", {}).get("content")

        if not isinstance(content, str) or not content.strip():
            raise RuntimeError(
                "SamiGPT 평가 응답의 content가 비어 있습니다."
            )

        finish_reason = choice.get("finish_reason")

        if finish_reason == "length":
            raise RuntimeError(
                "SamiGPT 평가 응답이 길이 제한으로 잘렸습니다."
            )

        return ChatResult(
            generations=[
                ChatGeneration(
                    message=AIMessage(content=content),
                    generation_info={
                        "finish_reason": finish_reason or "stop"
                    },
                )
            ]
        )