"""
SamiGPT 빠른 확인 테스트 (A·B·C·D 문항 일괄 질문)

- 문항마다 /api/chat에 따로 질문 (사이트에서 직접 묻는 것과 같은 조건)
- 동시에 /api/search로 어떤 페이지가 검색됐는지 기록 → 검색 문제인지 프롬프트 문제인지 구분
- 결과를 results_날짜_시각.md 파일 하나로 저장 (VS Code 미리보기로 보기 편함)

실행 전: npm run dev (3000) + python main.py (8000) 켜 두기
실행:   python quick_test.py          # 전체
        python quick_test.py A B      # A, B 그룹만
"""
import sys
import json
import time
import datetime
import requests
from concurrent.futures import ThreadPoolExecutor

# ───────── 설정 ─────────
CHAT_URL = "http://localhost:3000/api/chat"
SEARCH_URL = "http://127.0.0.1:8000/api/search"
MODEL = None              # None이면 route.ts 기본값('빠른 모델 플러스') 사용. 골든셋 평가 때와 같은 모델로 맞추기
REASONING = "medium"      # 골든셋 평가 때와 같은 추론 강도로 맞추기
WORKERS = 4               # 동시 요청 수 (rag_eval.py와 동일)
REFUSAL = ["확인되지 않", "명시되어 있지 않", "찾을 수 없", "포함되어 있지 않"]

# ───────── 문항 ─────────
# kind: refuse(거절해야 정답) / partial(있는 내용 + 없는 부분 지적) / answer(정상 답변) / general(일반 질문, 문서 거절 금지)
QUESTIONS = [
    ("A1", "refuse",  "IT기술교육에서 단위 모듈의 구성 요소는?",
     "거절해야 정답. p.10 학습모듈 목록 10개를 '구성 요소'로 답하면 실패"),
    ("A2", "refuse",  "IT기술교육의 교육 성과 평가·피드백 체계를 알려줘",
     "거절해야 정답. 학습자 평가(체크리스트·구두발표, p.38·40·96)를 성과 평가로 답하면 실패"),
    ("A3", "refuse",  "재난현장에서 통신 장애 시 대체 통신망은?",
     "거절해야 정답. p.179 채널 분리 우선순위를 '장애 시 대체 순서'로 답하면 실패"),
    ("B1", "partial", "재난현장 무선교신 녹음이 필요한 상황과 보관 기간은?",
     "p.22 2.14(무선통신 녹음·지휘내용 기록, 기록사항) 설명 + 보관 기간은 없다고 지적. 수치 나오면 실패"),
    ("B2", "partial", "합동 지휘소의 보고 공유 주기는?",
     "p.22 3.5(연락관이 수시로 확인해 현장지휘관에 보고) 설명 + 정해진 주기 없음 지적. 수치 나오면 실패"),
    ("B3", "partial", "혼선 방지를 위한 교신 약어와 수칙은?",
     "p.21~22 SOP 103(음성지시 원칙, 표준 일상어로 간명하게), p.179 3.1.2(불필요한 교신 자제). 지어낸 약어·예시, p.190 해양사고 체크리스트 인용은 실패"),
    ("C1", "answer",  "재난현장 지휘통제절차 안내해줘",
     "3단 구조로 정상 답변, 출처 페이지가 실제 내용과 일치"),
    ("C2", "answer",  "초기 현장지휘관이 최우선으로 해야 할 절차는?",
     "p.13 선착대장 최초 상황전파 및 지휘선언"),
    ("C3", "answer",  "IT기술교육에서 교육 요구 분석 시 설문·인터뷰는 어떻게 진행해?",
     "p.35(설문), p.63(인터뷰) 등. 서로 다른 절을 하나의 절차로 합치지 않는지"),
    ("D1", "general", "오늘 대전 날씨 알려줘",
     "'문서에서 확인되지 않습니다'로 답하면 실패 (Tavily 한도면 '조회 실패'는 정상)"),
    ("D2", "general", "파이썬 리스트 컴프리헨션 설명해줘",
     "일반 지식으로 정상 답변"),
]


def search_pages(q):
    """main.py와 같은 검색 결과(Top-3)의 파일·페이지 기록"""
    try:
        res = requests.post(SEARCH_URL, json={"query": q}, timeout=60).json()
        out = []
        for d in res.get("results", []):
            name = "IT" if "IT" in d["source"] else "SOP" if "SOP" in d["source"] else d["source"][:10]
            out.append(f"{name} p.{d['page']}")
        return ", ".join(out) if out else "(검색 결과 없음)"
    except Exception as e:
        return f"(검색 실패: {e})"


def ask(q):
    """route.ts 스트림({reasoning, content} 한 줄 JSON)을 끝까지 받아 합침"""
    body = {"message": q, "reasoningEffort": REASONING,
            "useGithubMcp": False, "useNotionMcp": False}
    if MODEL:
        body["model"] = MODEL
    start = time.time()
    content, reasoning = [], []
    with requests.post(CHAT_URL, json=body, stream=True, timeout=300) as r:
        r.raise_for_status()
        for raw in r.iter_lines():          # 줄 단위로 버퍼링 → 한글이 중간에 깨지지 않음
            if not raw:
                continue
            try:
                obj = json.loads(raw.decode("utf-8"))
            except Exception:
                continue
            content.append(obj.get("content", ""))
            reasoning.append(obj.get("reasoning", ""))
    return "".join(content), "".join(reasoning), time.time() - start


def hint(kind, ans):
    """자동 판정이 아니라 '먼저 볼 곳' 표시용 힌트"""
    refused = any(k in ans for k in REFUSAL)
    structured = "1. 상세 설명" in ans
    if kind == "refuse":
        if not refused:
            return "❌ 거절 안 함 (환각 의심)"
        return "✅ 거절" if not structured else "⚠️ 거절 문구는 있으나 3단 구조로 길게 답함"
    if kind == "partial":
        if not refused:
            return "⚠️ 없는 부분 지적 없음 (수치 날조 확인)"
        return "⚠️ 전부 거절 (과잉 거절)" if len(ans) < 150 else "✅ 일부 설명 + 없는 부분 지적"
    if kind == "answer":
        return "⚠️ 거절함 (과잉 거절)" if refused and len(ans) < 150 else "✅ 답변함 (내용 대조 필요)"
    if kind == "general":
        return "❌ 문서 거절 문구로 답함" if "문서에서 확인되지" in ans else "✅ 정상"
    return ""


def run_one(item):
    qid, kind, q, check = item
    pages = search_pages(q)
    try:
        ans, reasoning, sec = ask(q)
    except Exception as e:
        ans, reasoning, sec = f"(요청 실패: {e})", "", 0
    return dict(qid=qid, kind=kind, q=q, check=check, pages=pages,
                ans=ans, reasoning=reasoning, sec=sec, hint=hint(kind, ans),
                br="<br>" in ans)


def main():
    groups = [g.upper() for g in sys.argv[1:]]
    items = [x for x in QUESTIONS if not groups or x[0][0] in groups]

    # 사전 점검: RAG 검색이 실제로 조각을 돌려주는지 확인 (빈 DB로 테스트하는 실수 방지)
    probe = search_pages("재난현장 지휘통제절차")
    if probe.startswith("("):
        print(f"⛔ RAG 검색 결과가 비어 있거나 실패했습니다: {probe}")
        print("   chroma_db가 비어 있는지, main.py를 재시작했는지 확인하세요. 테스트를 중단합니다.")
        sys.exit(1)
    print(f"RAG 점검 통과 (예시 검색: {probe})")
    print(f"{len(items)}개 문항 질문 시작 (동시 {WORKERS}개)...")

    with ThreadPoolExecutor(WORKERS) as ex:
        results = list(ex.map(run_one, items))   # 결과 순서는 문항 순서 유지

    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    path = f"results_{stamp}.md"
    lines = [f"# 빠른 확인 테스트 ({stamp})",
             f"모델: {MODEL or 'route.ts 기본값'} · 추론 강도: {REASONING}", "",
             "| 문항 | 힌트 | 검색된 페이지 (Top-3) | 시간 | `<br>` |",
             "|---|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r['qid']} | {r['hint']} | {r['pages']} | {r['sec']:.1f}초 | {'있음' if r['br'] else ''} |")
    for r in results:
        lines += ["", "---", f"## {r['qid']}. {r['q']}",
                  f"- **확인 포인트:** {r['check']}",
                  f"- **검색된 페이지:** {r['pages']}",
                  f"- **힌트:** {r['hint']}", "", "### 답변", "", r["ans"] or "(빈 답변)", "",
                  "<details><summary>생각 과정</summary>", "", r["reasoning"] or "(없음)", "", "</details>"]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print()
    for r in results:
        print(f"{r['qid']:3} {r['hint']:32} 검색: {r['pages']}")
    print(f"\n저장 완료: {path}")


if __name__ == "__main__":
    main()