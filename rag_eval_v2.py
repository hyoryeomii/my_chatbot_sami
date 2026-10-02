# -*- coding: utf-8 -*-
"""
SamiGPT RAG 평가 v2

기능
- 명확한 질문 10문항으로 평가
- 질문, 기준 정답, 답변, 검색 청크 전체를 JSON으로 저장
- Excel 수동 검토표 생성
- 선택적으로 RAGAS 실행
- 거절 표현만으로 PASS를 확정하지 않음

실행
    python rag_eval_v2.py

검색만 확인
    python rag_eval_v2.py --search-only

기존 JSON으로 RAGAS만 실행
    python rag_eval_v2.py --ragas-only 결과파일.json

주의
- 현재 검색 청크는 /api/search에서 별도로 수집한 기록이다.
- /api/chat이 실제 사용한 청크를 반환하면 이를 우선 사용한다.
- 판정 보류, 평가 실패를 0점으로 처리하지 않는다.
"""

import argparse
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

import pandas as pd
import requests


# ============================================================
# 1. 설정
# ============================================================

CHAT_API_URL = "http://localhost:3000/api/chat"
SEARCH_API_URL = "http://127.0.0.1:8000/api/search"

MODEL = "생각하는 모델 플러스"
REASONING_EFFORT = "medium"

EXPECTED_TOP_K = 5

# 기록용 설정이다. 서버의 DB/k를 자동 변경하지 않는다.
EXPERIMENT_NAME = "v2_300자_k5_생각하는모델플러스_도구OFF"

OUTPUT_DIR = Path(__file__).resolve().parent / "eval_v2_results"

# 처음에는 False 유지
RUN_RAGAS = False

# 별도 검색 기록으로도 RAGAS를 돌릴지 여부.
# 실제 사용 청크가 아니므로 기본값 False.
ALLOW_SNAPSHOT_CONTEXTS = False

# 이 평가 파일과 같은 폴더의 환경변수 파일 읽기
PROJECT_DIR = Path(__file__).resolve().parent

load_dotenv(PROJECT_DIR / ".env")
load_dotenv(PROJECT_DIR / ".env.local", override=True)

# RAGAS 평가용 모델 설정.
JUDGE_BASE_URL = os.getenv("RAGAS_JUDGE_BASE_URL", "").strip()
JUDGE_API_KEY = os.getenv("RAGAS_JUDGE_API_KEY", "").strip()
JUDGE_MODEL = os.getenv("RAGAS_JUDGE_MODEL", "").strip()

HTTP_TIMEOUT = 300

REFUSAL_PHRASES = [
    "문서에 없",
    "문서에서 확인되지",
    "확인되지 않",
    "확인할 수 없",
    "명시되어 있지 않",
    "명시되지 않",
    "포함되어 있지 않",
    "기재되어 있지 않",
    "찾을 수 없",
]


# ============================================================
# 2. 평가 문항 10개
#
# reference는 사람이 원문으로 확인할 기준 정답 초안이다.
# 페이지 번호는 PDF 파일 기준이며 인쇄 쪽번호와 다를 수 있다.
#
# answerable: 질문에 답할 근거가 있음
# partial: 일부만 확인되거나 잘못된 전제를 정정해야 함
# unanswerable: 질문이 요구하는 구체적 답이 확인되지 않음
#
# reference_for_recall:
#   Context Recall에서 검색 대상으로 삼을 사실만 작성한다.
#   "확인되지 않습니다" 같은 거절 문장은 넣지 않는다.
# ============================================================

QUESTIONS = [
    {
        "id": "IT-A01",
        "document": "IT",
        "type": "answerable",
        "question": (
            "IT 기술 교육 체계 수립 학습모듈의 내용 체계에 "
            "제시된 주요 학습 세 가지는 무엇이야?"
        ),
        "reference": (
            "주요 학습은 IT 기술 교육 내부 환경 분석하기, "
            "직무·직급별 IT 기술 교육 정의하기, "
            "IT 기술 교육 체계도 작성하기이다."
        ),
        "reference_for_recall": (
            "주요 학습은 IT 기술 교육 내부 환경 분석하기, "
            "직무·직급별 IT 기술 교육 정의하기, "
            "IT 기술 교육 체계도 작성하기이다."
        ),
        "evidence_note": "IT PDF 13쪽: 학습모듈의 내용 체계",
        "allowed": "원문의 주요 학습 세 가지를 설명한다.",
        "forbidden": "성과 평가 등을 추가하여 4·5단계로 재구성한다.",
    },
    {
        "id": "IT-A02",
        "document": "IT",
        "type": "answerable",
        "question": (
            "직무별 IT 교육과정을 구체적으로 설계할 때 "
            "내용, 시간, 설비와 교수 방법은 어떻게 정하도록 안내해?"
        ),
        "reference": (
            "주요 전달 내용을 상세하고 구체적으로 작성한다. "
            "전체 과정과 세부 하부 과정의 진행 시간을 예측한다. "
            "효과적인 교육을 위한 설비·도구와 교육 전달 기법에 "
            "대한 가이드를 제시한다."
        ),
        "reference_for_recall": (
            "전달 내용을 상세하고 구체적으로 작성하고, "
            "전체 및 세부 과정 시간을 예측하며, "
            "설비·도구와 교육 전달 기법 가이드를 제시한다."
        ),
        "evidence_note": "IT PDF 58쪽: 교육과정 구체화 설계",
        "allowed": "내용·시간·설비·전달 기법의 설계 사항을 설명한다.",
        "forbidden": "문서에 없는 시간 비율이나 필수 장비를 만든다.",
    },
    {
        "id": "SOP-A01",
        "document": "SOP",
        "type": "answerable",
        "question": (
            "재난 현장에 최초로 도착한 선착대장이 "
            "즉시 수행해야 하는 지휘 절차는 무엇이야?"
        ),
        "reference": (
            "선착대장은 현장 도착 즉시 최초 상황전파 및 "
            "지휘선언을 수행한다."
        ),
        "reference_for_recall": (
            "현장 도착 즉시 최초 상황전파 및 지휘선언을 수행한다."
        ),
        "evidence_note": "SOP 100 1.1, PDF 13쪽",
        "allowed": "최초 상황전파와 지휘선언을 설명한다.",
        "forbidden": "다른 안전조치를 최우선 지휘 절차로 대체한다.",
    },
    {
        "id": "SOP-A02",
        "document": "SOP",
        "type": "answerable",
        "question": (
            "유관기관 연락관이 현장에 도착하면 누구에게 "
            "어떤 정보를 통보해야 해?"
        ),
        "reference": (
            "각 유관기관·단체의 연락관은 현장 도착 즉시 "
            "현장지휘소의 연락담당에게 소속 기관·단체, "
            "직책, 성명, 연락전화번호를 통보한다."
        ),
        "reference_for_recall": (
            "연락관은 현장 도착 즉시 현장지휘소 연락담당에게 "
            "소속 기관·단체, 직책, 성명, 연락전화번호를 통보한다."
        ),
        "evidence_note": "SOP 103 3.1, PDF 22쪽",
        "allowed": "통보 대상과 네 가지 정보를 설명한다.",
        "forbidden": "문서에 없는 제출 기한이나 양식을 추가한다.",
    },
    {
        "id": "IT-P01",
        "document": "IT",
        "type": "partial",
        "question": (
            "IT 기술 교육 체계 수립 학습모듈의 주요 학습 구성에 "
            "네 번째 학습이 있어? 세 번째 학습은 무엇을 다뤄?"
        ),
        "reference": (
            "학습모듈의 주요 학습 구성은 세 가지이다. "
            "네 번째 주요 학습은 제시되어 있지 않다. "
            "세 번째는 IT 기술 교육 체계도 작성하기이며, "
            "직급별·직무별·전사 IT 기술 교육 체계도 작성을 다룬다."
        ),
        "reference_for_recall": (
            "세 번째 주요 학습은 IT 기술 교육 체계도 작성하기이며, "
            "직급별·직무별·전사 IT 기술 교육 체계도 작성을 다룬다."
        ),
        "evidence_note": "IT PDF 13쪽: 학습모듈의 내용 체계",
        "allowed": "없는 네 번째 학습을 정정하고 세 번째 내용을 설명한다.",
        "forbidden": "다른 절의 항목 번호 4를 네 번째 주요 학습으로 해석한다.",
    },
    {
        "id": "SOP-P01",
        "document": "SOP",
        "type": "partial",
        "question": (
            "SOP는 지휘 내용을 어떻게 녹음하거나 기록하도록 해? "
            "녹음 자료의 보관 기간도 정해져 있어?"
        ),
        "reference": (
            "무선통신을 녹음하거나 일지 또는 상황판에 "
            "지휘 내용을 기록·정리하도록 한다. "
            "기록사항은 시간, 수명자, 전달방법, 지시내용 등이다. "
            "질문에 해당하는 구체적인 녹음 보관 기간은 확인되지 않는다."
        ),
        "reference_for_recall": (
            "무선통신을 녹음하거나 일지 또는 상황판에 "
            "지휘 내용을 기록·정리하며, "
            "시간·수명자·전달방법·지시내용 등을 기록한다."
        ),
        "evidence_note": "SOP 103 2.14",
        "allowed": "기록 규정을 설명하고 보관 기간의 한계를 구분한다.",
        "forbidden": "1년·3년 등 보관 기간이나 없는 법적 근거를 만든다.",
    },
    {
        "id": "SOP-P02",
        "document": "SOP",
        "type": "partial",
        "question": (
            "유관기관 연락관은 임무 수행상황을 누구에게 보고해? "
            "매 몇 시간마다 보고하도록 정해져 있어?"
        ),
        "reference": (
            "연락관은 소속 기관의 임무 수행상황을 수시로 확인하여 "
            "현장지휘관 또는 현장지휘소에 보고한다. "
            "고정된 시간 간격은 제시되어 있지 않다."
        ),
        "reference_for_recall": (
            "연락관은 소속 기관의 임무 수행상황을 수시로 확인하여 "
            "현장지휘관 또는 현장지휘소에 보고한다."
        ),
        "evidence_note": "SOP 103 3.5, PDF 22쪽",
        "allowed": "수시 보고와 보고 대상을 설명하고 고정 간격은 구분한다.",
        "forbidden": "30분·1시간 등 고정 주기를 만든다.",
    },
    {
        "id": "IT-U01",
        "document": "IT",
        "type": "unanswerable",
        "question": (
            "이 문서에 신입사원과 책임급 연구원의 "
            "IT 교육 필수 과목과 이수 기간이 각각 명시되어 있어?"
        ),
        "reference": (
            "신입사원과 책임급 연구원 각각의 필수 과목과 "
            "이수 기간은 문서에서 확인되지 않는다. "
            "직급별 교육 기획의 일반 원칙을 "
            "두 직급의 실제 과정 목록으로 제시해서는 안 된다."
        ),
        "reference_for_recall": None,
        "evidence_note": "직급별 일반 기획과 특정 직급의 실제 목록을 구분",
        "allowed": "구체적 과목·기간은 확인되지 않는다고 답한다.",
        "forbidden": "직급별 과목 목록·기간·이수 요건을 만든다.",
    },
    {
        "id": "IT-U02",
        "document": "IT",
        "type": "unanswerable",
        "question": (
            "이 문서에 교육 종료 후 현업 적용도를 측정하는 "
            "구체적인 지표와 계산식이 명시되어 있어?"
        ),
        "reference": (
            "교육 종료 후 현업 적용도를 측정하는 "
            "구체적인 지표와 계산식은 확인되지 않는다. "
            "학습자 평가표나 기획 단계의 검토 항목과 구분해야 한다."
        ),
        "reference_for_recall": None,
        "evidence_note": "학습자 평가·체계도 검토와 현업 적용도 지표를 구분",
        "allowed": "현업 적용도 지표·산식의 부재를 설명한다.",
        "forbidden": "업무 적용률·생산성 향상률 등의 산식을 만든다.",
    },
    {
        "id": "SOP-U01",
        "document": "SOP",
        "type": "unanswerable",
        "question": (
            "연속으로 진화 작업에 투입된 대원의 "
            "최대 교체 주기를 몇 시간으로 정하고 있어?"
        ),
        "reference": (
            "질문에 해당하는 고정된 최대 교체 시간은 확인되지 않는다. "
            "피로한 대원의 적시 교체와 휴식·건강 확인 등의 "
            "관련 원칙은 설명할 수 있으나 임의의 시간을 제시하면 안 된다."
        ),
        "reference_for_recall": None,
        "evidence_note": "SOP 100 교대조 운영, SOP 103 2.15 등",
        "allowed": "고정 시간을 만들지 않고 확인 범위를 설명한다.",
        "forbidden": "1시간·2시간 등 임의의 최대 교체 주기를 제시한다.",
    },
]


# ============================================================
# 3. 공통 함수
# ============================================================

def contains_refusal(answer):
    return any(phrase in answer for phrase in REFUSAL_PHRASES)


def get_timestamp():
    try:
        now = datetime.now(ZoneInfo("Asia/Seoul"))
    except Exception:
        # 시간대 데이터가 없는 Windows 환경 대응
        from datetime import timedelta, timezone
        now = datetime.now(timezone(timedelta(hours=9)))

    return now.strftime("%Y%m%d_%H%M%S_%f")


def normalize_contexts(value):
    """
    contexts는 문자열 목록 또는
    content/page/source를 가진 문서 목록으로 받을 수 있다.
    """
    if not isinstance(value, list):
        return None

    contexts = []

    for item in value:
        if isinstance(item, str):
            contexts.append(item)
        elif isinstance(item, dict):
            text = item.get("content")
            if text is None:
                text = item.get("page_content")

            if not isinstance(text, str):
                return None

            contexts.append(text)
        else:
            return None

    return contexts


def parse_chat_stream(response):
    """
    현재 route.ts의 줄 단위 JSON 스트림 대응.

    선택적으로 아래 메타데이터가 반환되면 수집한다.
        {"retrieved_contexts": [...]}

    기존 route.ts에서는 이 정보가 없어 None이 된다.
    """
    parts = []
    raw_lines = []
    actual_contexts = None

    for raw in response.iter_lines():
        if not raw:
            continue

        line = raw.decode("utf-8", errors="replace").strip()
        raw_lines.append(line)

        if line.startswith("data:"):
            line = line[5:].strip()

        if line == "[DONE]":
            continue

        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue

        if not isinstance(item, dict):
            continue

        if item.get("error"):
            raise RuntimeError(str(item["error"]))

        if "retrieved_contexts" in item:
            parsed = normalize_contexts(item["retrieved_contexts"])
            if parsed is not None:
                actual_contexts = parsed

        if isinstance(item.get("content"), str):
            parts.append(item["content"])

        elif item.get("choices"):
            choice = item["choices"][0]
            delta = choice.get("delta") or choice.get("message") or {}
            content = delta.get("content")

            if isinstance(content, str):
                parts.append(content)

    answer = "".join(parts).strip()

    if not answer:
        raise RuntimeError(
            "回答本文を取得できませんでした。"
            " ストリーム形式を確認してください。"
        )

    return answer, actual_contexts


# ============================================================
# 4. 검색·답변 수집
# ============================================================

def search_snapshot(question):
    started = time.perf_counter()

    response = requests.post(
        SEARCH_API_URL,
        json={"query": question},
        timeout=HTTP_TIMEOUT,
    )
    response.raise_for_status()

    payload = response.json()
    documents = payload.get("results")

    if not isinstance(documents, list):
        raise RuntimeError("/api/search 응답에 results 목록이 없습니다.")

    contexts = normalize_contexts(documents)

    if contexts is None:
        raise RuntimeError("검색 결과의 content 형식을 확인하세요.")

    return {
        "contexts": contexts,
        "documents": documents,
        "seconds": round(time.perf_counter() - started, 3),
    }


def ask_chat(question):
    started = time.perf_counter()

    with requests.post(
        CHAT_API_URL,
        json={
            "message": question,
            "model": MODEL,
            "reasoningEffort": REASONING_EFFORT,
            "useGithubMcp": False,
            "useNotionMcp": False,
        },
        timeout=HTTP_TIMEOUT,
        stream=True,
    ) as response:
        response.raise_for_status()
        answer, actual_contexts = parse_chat_stream(response)

    return {
        "answer": answer,
        "actual_contexts": actual_contexts,
        "seconds": round(time.perf_counter() - started, 3),
    }


def collect_records(search_only=False):
    records = []

    # 순차 실행으로 오류 확인과 서버 부하 관리를 단순화한다.
    for index, question in enumerate(QUESTIONS, 1):
        print(
            f"[{index}/{len(QUESTIONS)}] "
            f"{question['id']} {question['question']}"
        )

        record = {
            **question,
            "response": "",
            "retrieved_contexts": [],
            "search_snapshot_contexts": [],
            "search_documents": [],
            "context_source": "unavailable",
            "search_seconds": None,
            "response_seconds": None,
            "refusal_expression_detected": False,
            "errors": [],
            "manual_verdict": "",
            "manual_reason": "",
            "ragas": {},
        }

        try:
            snapshot = search_snapshot(question["question"])
            record["search_snapshot_contexts"] = snapshot["contexts"]
            record["search_documents"] = snapshot["documents"]
            record["retrieved_contexts"] = snapshot["contexts"]
            record["context_source"] = "separate_search_snapshot"
            record["search_seconds"] = snapshot["seconds"]

            if len(snapshot["contexts"]) != EXPECTED_TOP_K:
                print(
                    "  注意: 取得チャンク数 = "
                    f"{len(snapshot['contexts'])}, "
                    f"expected = {EXPECTED_TOP_K}"
                )

        except Exception as exc:
            record["errors"].append(f"search: {exc}")

        if not search_only:
            try:
                chat = ask_chat(question["question"])
                record["response"] = chat["answer"]
                record["response_seconds"] = chat["seconds"]
                record["refusal_expression_detected"] = contains_refusal(
                    chat["answer"]
                )

                if chat["actual_contexts"] is not None:
                    record["retrieved_contexts"] = chat["actual_contexts"]
                    record["context_source"] = "actual_chat_contexts"

            except Exception as exc:
                record["errors"].append(f"chat: {exc}")

        status = "ERROR" if record["errors"] else "수집 완료"
        print(f"  {status} / 근거 출처: {record['context_source']}")

        records.append(record)

    return records


# ============================================================
# 5. RAGAS
#
# 필요 패키지
#   pip install ragas langchain-openai
#
# Faithfulness:
#   답변의 주장이 검색 근거에 의해 지원되는지 평가
#
# Context Recall:
#   기준 정답의 사실이 검색 근거에 있는지 평가
#   unanswerable 문항은 제외
#
# RAGAS 버전에 따라 API 호환성이 달라질 수 있다.
# 평가 실패는 점수 0으로 처리하지 않고 오류로 기록한다.
# ============================================================

def run_ragas(records):
    if not all([JUDGE_BASE_URL, JUDGE_API_KEY, JUDGE_MODEL]):
        raise RuntimeError(
            "평가 모델 설정이 없습니다. "
            "RAGAS_JUDGE_BASE_URL, RAGAS_JUDGE_API_KEY, "
            "RAGAS_JUDGE_MODEL 환경변수를 지정하세요."
        )

    try:
        from samigpt_judge import SamiGPTJudge
        from ragas import EvaluationDataset, evaluate
        from ragas.llms import LangchainLLMWrapper
        from ragas.metrics import Faithfulness, LLMContextRecall
    except ImportError as exc:
        print("실제 import 오류:", repr(exc))
        raise RuntimeError(
            "RAGAS 관련 패키지 또는 API를 불러올 수 없습니다. "
            "설치 버전과 ragas API 호환성을 확인하세요."
        ) from exc

    judge_llm = LangchainLLMWrapper(
        SamiGPTJudge(
            api_url=JUDGE_BASE_URL,
            api_key=JUDGE_API_KEY,
            model_name=JUDGE_MODEL,
            timeout_seconds=180,
        )
    )

    for record in records:
        if record["errors"] or not record["response"]:
            record["ragas"]["status"] = "skipped_collection_error"
            continue

        if record["context_source"] != "actual_chat_contexts":
            if not ALLOW_SNAPSHOT_CONTEXTS:
                record["ragas"]["status"] = (
                    "skipped_actual_contexts_not_available"
                )
                continue

            record["ragas"]["context_warning"] = (
                "별도 검색 기록으로 평가. "
                "실제 답변 생성 근거와 일치 여부 미확인."
            )

        if not record["retrieved_contexts"]:
            record["ragas"]["status"] = "skipped_empty_contexts"
            continue

        metrics = [Faithfulness(llm=judge_llm)]

        sample = {
            "user_input": record["question"],
            "response": record["response"],
            "retrieved_contexts": record["retrieved_contexts"],
        }

        if record["reference_for_recall"]:
            sample["reference"] = record["reference_for_recall"]
            metrics.append(LLMContextRecall(llm=judge_llm))

        try:
            dataset = EvaluationDataset.from_list([sample])

            result = evaluate(
                dataset=dataset,
                metrics=metrics,
                llm=judge_llm,
                raise_exceptions=True,
            )

            row = result.to_pandas().iloc[0]

            for metric_name in ["faithfulness", "context_recall"]:
                if metric_name in row.index:
                    value = row[metric_name]

                    record["ragas"][metric_name] = (
                        None if pd.isna(value) else float(value)
                    )

            record["ragas"]["status"] = "completed"

        except Exception as exc:
            record["ragas"]["status"] = "evaluation_error"
            record["ragas"]["error"] = str(exc)

        print(
            f"[RAGAS] {record['id']} "
            f"{record['ragas']['status']}"
        )


# ============================================================
# 6. 저장
# ============================================================

def save_json(path, records):
    payload = {
        "experiment": EXPERIMENT_NAME,
        "model_requested": MODEL,
        "reasoning_effort_requested": REASONING_EFFORT,
        "expected_top_k": EXPECTED_TOP_K,
        "judge_model": JUDGE_MODEL or None,
        "context_note": (
            "actual_chat_contexts는 chat API가 반환한 실제 근거. "
            "separate_search_snapshot은 별도 검색 기록."
        ),
        "records": records,
    }

    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def save_excel(path, records):
    question_rows = []
    context_rows = []

    for record in records:
        question_rows.append({
            "ID": record["id"],
            "문서": record["document"],
            "정답 유형": record["type"],
            "질문": record["question"],
            "기준 정답": record["reference"],
            "근거 위치": record["evidence_note"],
            "허용 답변 범위": record["allowed"],
            "오류 기준": record["forbidden"],
            "답변": record["response"],
            "근거 기록 출처": record["context_source"],
            "청크 수": len(record["retrieved_contexts"]),
            "거절 표현 감지": (
                "Y" if record["refusal_expression_detected"] else "N"
            ),
            "답변 시간(초)": record["response_seconds"],
            "Faithfulness": record["ragas"].get("faithfulness"),
            "Context Recall": record["ragas"].get("context_recall"),
            "RAGAS 상태": record["ragas"].get("status", "미실행"),
            "수동 판정": record["manual_verdict"],
            "수동 판정 이유": record["manual_reason"],
            "수집 오류": "\n".join(record["errors"]),
            "RAGAS 오류": record["ragas"].get("error", ""),
        })

        # 한 셀에 청크 전체를 합치지 않고 청크별 행으로 저장.
        # 완전한 데이터의 기준 파일은 JSON이다.
        for index, context in enumerate(
            record["retrieved_contexts"], 1
        ):
            context_rows.append({
                "ID": record["id"],
                "순위": index,
                "근거 기록 출처": record["context_source"],
                "청크 원문": context,
            })

    notes = [
        {
            "항목": "평가 버전",
            "내용": "v2 도입용 10문항",
        },
        {
            "항목": "자동 PASS",
            "내용": "거절 표현만으로 자동 PASS를 확정하지 않음",
        },
        {
            "항목": "검색 근거",
            "내용": (
                "현재 chat API가 실제 근거를 반환하지 않으면 "
                "별도 search API 결과를 저장함"
            ),
        },
        {
            "항목": "문서에없는 질문",
            "내용": (
                "Context Recall 계산 대상에서 제외. "
                "거절 적절성과 근거 없는 주장 여부를 수동 검토"
            ),
        },
        {
            "항목": "질문 유형",
            "내용": (
                "answerable=정답있음, partial=일부만 확인·전제오류, "
                "unanswerable=요구한 구체적 답 확인 불가"
            ),
        },
        {
            "항목": "실험 조건",
            "내용": (
                f"{EXPERIMENT_NAME}; 요청 모델={MODEL}; "
                f"요청 추론 강도={REASONING_EFFORT}"
            ),
        },
        {
            "항목": "실패 처리",
            "내용": "수집·평가 오류는 0점으로 집계하지 않음",
        },
    ]

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        pd.DataFrame(question_rows).to_excel(
            writer, sheet_name="문항별 검토", index=False
        )
        pd.DataFrame(context_rows).to_excel(
            writer, sheet_name="검색 청크", index=False
        )
        pd.DataFrame(notes).to_excel(
            writer, sheet_name="평가 안내", index=False
        )


# ============================================================
# 7. 실행
# ============================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--search-only",
        action="store_true",
        help="답변 생성 없이 검색 결과만 수집",
    )
    parser.add_argument(
        "--ragas-only",
        metavar="JSON_PATH",
        help="기존 v2 JSON을 읽어 RAGAS만 실행",
    )
    args = parser.parse_args()

    if args.search_only and args.ragas_only:
        parser.error("두 옵션을 동시에 사용할 수 없습니다.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.ragas_only:
        source = Path(args.ragas_only)
        payload = json.loads(source.read_text(encoding="utf-8"))
        records = payload["records"]
    else:
        print("실행 전 서버 설정을 확인하세요.")
        print("- route.ts: ragEvalOnly = true")
        print("- main.py: 300자 DB, k=5")
        print("- Next.js와 FastAPI 실행 중")
        print()

        records = collect_records(search_only=args.search_only)

    timestamp = get_timestamp()
    base = OUTPUT_DIR / f"{EXPERIMENT_NAME}_{timestamp}"

    json_path = base.with_suffix(".json")
    excel_path = base.with_suffix(".xlsx")

    # RAGAS 실패가 있어도 수집 데이터는 먼저 보존
    save_json(json_path, records)
    save_excel(excel_path, records)

    should_run_ragas = (
        not args.search_only
        and (RUN_RAGAS or bool(args.ragas_only))
    )

    if should_run_ragas:
        try:
            run_ragas(records)
        except Exception as exc:
            print(f"RAGAS 실행 실패: {exc}")
            print("수집된 JSON과 Excel은 보존했습니다.")
        else:
            save_json(json_path, records)
            save_excel(excel_path, records)

    print()
    print(f"JSON: {json_path}")
    print(f"Excel: {excel_path}")
    print(
        "거절 표현 감지는 참고값입니다. "
        "답변 전체의 수동 판정과 구분하세요."
    )


if __name__ == "__main__":
    main()