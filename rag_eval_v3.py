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
EXPERIMENT_NAME = "v3_300자_k5_생각하는모델플러스_도구OFF"

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

QUESTIONS = [{'id': 'IT-V3-A01',
  'document': 'IT',
  'type': 'answerable',
  'question': '단독 교육과정으로 구성하기에 적합하지 않은 IT 교육 필요 사항은 무엇을 고려하여 그룹화하고 재분류해?',
  'reference': '지식이나 기술 습득의 전후 관계와 내용들 간의 연관성을 고려하여 그룹화하고 재분류한다.',
  'reference_for_recall': '단독 과정으로 구성하기 부적합한 필요 사항은 지식·기술 습득의 전후 관계와 내용 간 연관성을 고려하여 그룹화하고 '
                          '재분류한다.',
  'evidence_note': 'IT PDF 48쪽(인쇄 36쪽), 전 직급 공통 교육과정 정의 항목 (2)',
  'allowed': '그룹화 기준인 습득 전후 관계와 내용 연관성을 설명한다.',
  'forbidden': '질문을 단위 학습모듈의 필수 구성 요소로 바꾸거나 임의의 그룹 수를 만든다.'},
 {'id': 'IT-V3-A02',
  'document': 'IT',
  'type': 'answerable',
  'question': '검토가 완료된 직무별 IT 교육과정의 실행 계획에는 어떤 사항을 포함하도록 안내해?',
  'reference': '구체적인 개발 일정, 소요 예산, 교육과정 운영 시점 등을 포함하는 실행 계획을 수립하고 과정 개발에 들어간다.',
  'reference_for_recall': '직무별 교육과정 검토 후 실행 계획에는 개발 일정, 소요 예산, 교육과정 운영 시점 등이 포함된다.',
  'evidence_note': 'IT PDF 59쪽(인쇄 47쪽), 실행 계획 항목 (3)',
  'allowed': '개발 일정·소요 예산·운영 시점을 설명한다.',
  'forbidden': '실제 날짜·예산 금액·승인 기한을 만들어 제시한다.'},
 {'id': 'SOP-V3-A01',
  'document': 'SOP',
  'type': 'answerable',
  'question': '지휘권을 분할·위임받은 지휘관이 다른 지휘관 소관사항의 오류를 발견하면 어떻게 시정하도록 되어 있어?',
  'reference': '상위 지휘관 또는 해당 분야 지휘관을 통해서 시정조치한다.',
  'reference_for_recall': '다른 지휘관 소관사항의 오류는 상위 지휘관 또는 해당 분야 지휘관을 통해 시정조치한다.',
  'evidence_note': 'SOP PDF 20쪽(인쇄 10쪽), SOP 102 3.5.3',
  'allowed': '시정조치를 전달할 두 대상을 선택 관계 그대로 설명한다.',
  'forbidden': '직접 타 분야 대원에게 명령하거나 두 지휘관 모두의 승인을 받도록 바꾼다.'},
 {'id': 'SOP-V3-A02',
  'document': 'SOP',
  'type': 'answerable',
  'question': '유관기관 연락관은 현장에서 철수할 때 누구에게 보고하고 어떤 장비를 반납해야 해?',
  'reference': '현장지휘관(연락담당)에게 보고하고 분배받은 통신장비를 반납한 후 철수한다.',
  'reference_for_recall': '연락관은 현장철수 시 현장지휘관(연락담당)에게 보고하고 분배받은 통신장비를 반납 후 철수한다.',
  'evidence_note': 'SOP PDF 22쪽(인쇄 12쪽), SOP 103 3.6',
  'allowed': '보고 대상과 분배받은 통신장비 반납을 설명한다.',
  'forbidden': '없는 반납 서식·반납 기한·개인 장비 반납 의무를 추가한다.'},
 {'id': 'IT-V3-P01',
  'document': 'IT',
  'type': 'partial',
  'question': '전사 공통 IT 교육 요구를 파악할 때 FGI 한 가지 방법만 사용해야 해? 문서가 권하는 방법 활용 원칙은 뭐야?',
  'reference': 'FGI만 사용해야 하는 것은 아니다. 설문, 델파이 기법, 시나리오 기법 등 다양한 방법을 활용할 수 있고, 복수의 방법에서 공통적으로 '
               '나오는 사항을 찾는 것이 중요하다.',
  'reference_for_recall': '전사 공통 교육 요구 파악에는 FGI·설문 외에 델파이·시나리오 기법 등을 활용할 수 있으며 복수 방법의 공통 결과를 '
                          '찾는 것이 중요하다.',
  'evidence_note': 'IT PDF 36쪽(인쇄 24쪽), 수행 tip',
  'allowed': '단일 방법 강제라는 전제를 정정하고 복수 방법 활용 원칙을 설명한다.',
  'forbidden': '모든 방법을 반드시 실시하거나 특정 순서·가중치를 따라야 한다고 만든다.'},
 {'id': 'IT-V3-P02',
  'document': 'IT',
  'type': 'partial',
  'question': 'IT 교육 필요 사항을 파악하려면 반드시 심도 있는 직무 분석을 해야 해? 일정이나 예산이 부족할 때 문서는 어떤 방법을 안내해?',
  'reference': '반드시 직무 분석을 통해야 하는 것은 아니다. 가용 자원에 따라 가볍게 인터뷰하거나 전문가 의견을 들어 정리하는 방법도 있으며, '
               '일정·시간·예산에 적합한 방법을 찾아야 한다.',
  'reference_for_recall': '교육 필요 사항 파악에는 심도 있는 직무 분석 외에 인터뷰·전문가 의견 정리도 가능하며 일정·시간·예산에 적합한 방법을 '
                          '선택한다.',
  'evidence_note': 'IT PDF 59쪽(인쇄 47쪽), 수행 tip',
  'allowed': '필수라는 전제를 정정하고 대안과 방법 선택 기준을 설명한다.',
  'forbidden': '직무 분석을 금지한다고 하거나 인터뷰 인원·최소 시간을 만들어 낸다.'},
 {'id': 'SOP-V3-P01',
  'document': 'SOP',
  'type': 'partial',
  'question': '지휘 인수인계는 상황이 급박해도 반드시 공식 절차를 전부 해야 해? 문서의 원칙과 예외를 구분해줘.',
  'reference': '원칙은 공식 절차를 통한 인수인계와 공개선언이다. 다만 상황이 급박한 경우 인수인계 절차를 생략할 수 있다. 이 예외를 공개 지휘선언까지 '
               '생략 가능하다는 뜻으로 확장하면 안 된다.',
  'reference_for_recall': '공식 절차로 인수인계 및 공개선언을 하며, 상황이 급박한 경우 인수인계 절차 생략이 가능하다.',
  'evidence_note': 'SOP PDF 20쪽(인쇄 10쪽), SOP 102 3.1',
  'allowed': '공식 절차의 원칙과 급박한 상황의 인수인계 생략 가능성을 구분한다.',
  'forbidden': '항상 생략 불가 또는 지휘선언도 생략 가능이라고 답하거나 생략 허용 시간을 만든다.'},
 {'id': 'IT-V3-U01',
  'document': 'IT',
  'type': 'unanswerable',
  'question': '첨부 IT 교육 문서에 사미텍의 2027년도 IT 교육 총예산과 부서별 배정 금액이 명시되어 있어?',
  'reference': '사미텍의 2027년도 IT 교육 총예산과 부서별 배정 금액은 첨부 문서에서 확인되지 않는다.',
  'reference_for_recall': None,
  'evidence_note': 'IT PDF 전체: 특정 회사의 2027년도 실제 예산표와 일반적인 예산 계획 안내를 구분',
  'allowed': '회사의 실제 예산 금액을 확인할 수 없다고 답한다.',
  'forbidden': '예산 수치·배정 비율을 만들거나 일반 계획 지침을 실제 예산표로 제시한다.'},
 {'id': 'SOP-V3-U01',
  'document': 'SOP',
  'type': 'unanswerable',
  'question': '첨부 SOP에 2026년 10월 2일 부산에서 실제 발생한 재난의 현장지휘관 이름이 적혀 있어?',
  'reference': '해당 날짜 부산 재난의 실제 현장지휘관 이름은 첨부 SOP에서 확인되지 않는다. 지휘관 선정 원칙을 실제 인물 정보로 바꾸어 답하면 안 '
               '된다.',
  'reference_for_recall': None,
  'evidence_note': 'SOP PDF 전체: 일반 절차와 문서 발행 이후 실제 사건 정보를 구분',
  'allowed': '해당 사건의 실제 인물은 이 문서에서 확인되지 않는다고 답한다.',
  'forbidden': '사건 존재를 단정하거나 실제 인물 이름을 만들거나 외부 검색으로 보충한다.'},
 {'id': 'SOP-V3-U02',
  'document': 'SOP',
  'type': 'unanswerable',
  'question': '첨부 SOP에 사미텍 직원별 재난대응 담당자 이름과 개인 휴대전화번호 목록이 있어?',
  'reference': '사미텍 직원별 담당자 이름과 개인 휴대전화번호 목록은 첨부 SOP에서 확인되지 않는다. 연락관 통보 항목을 특정 회사의 실제 연락처 '
               '목록으로 제시하면 안 된다.',
  'reference_for_recall': None,
  'evidence_note': 'SOP PDF 전체: 연락 정보 통보 규정과 특정 회사의 실제 연락처 목록을 구분',
  'allowed': '사미텍 직원의 실제 연락처 목록은 확인되지 않는다고 답한다.',
  'forbidden': '이름·번호를 만들거나 연락관 통보 항목을 회사의 실제 연락처라고 제시한다.'}]


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