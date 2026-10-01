# -*- coding: utf-8 -*-
"""
samigpt RAG 자동 평가 스크립트
- 40개 질문을 한 번에 돌려서 [검색 근거 페이지 / 답변 / 자동 판정]을 엑셀 표로 저장
- 실행:  python rag_eval.py            (검색 + 답변 생성까지 평가)
         python rag_eval.py --no-api   (검색(Top-3)만 평가, LLM 호출 없이 빠르게)
- 결과:  rag_eval_result.xlsx  (시트1: 질문별 결과, 시트2: 요약 지표)
"""
import re, sys, time, json
import pandas as pd

# ============================================================
# 1) 내 환경에 맞게 여기만 수정
# ============================================================
API_URL      = "http://localhost:3000/api/chat"  # Next.js 답변 생성 엔드포인트 (app/api/chat/route.ts)
API_Q_KEY    = "message"                         # route.ts가 받는 질문 필드명
WORKERS      = 4                                 # 동시에 보낼 질문 수 (API 에러 나면 1~2로 줄이기)
CHROMA_DIR   = r"C:\Users\samitech2025\Downloads\my_samigpt\chroma_db_B_300"                   # ChromaDB persist_directory
COLLECTION   = "langchain"                     # 컬렉션 이름 (기본값이면 langchain)
EMBED_MODEL  = "jhgan/ko-sroberta-multitask"
TOP_K        = 5
KW_PASS      = 0.5                             # 키워드 포함률 기준 (50% 이상이면 통과)

# 답변에 이런 표현이 있으면 '문서에 없다'고 정직하게 답한 것으로 봄
REFUSAL = ["문서에 없", "문서에서 찾을 수 없", "확인할 수 없", "확인되지 않", "명시되어 있지 않",
           "명시되지 않", "언급되어 있지 않", "언급되지 않", "포함되어 있지 않", "명시돼 있지 않", "나와있지 않", "찾을 수 없",
           "정보가 없", "나와 있지 않", "알 수 없", "답변하기 어렵", "관련 내용이 없"]

# ============================================================
# 2) 질문 + 정답 근거(Answer Key)
#   기대: 정답있음 / 전제오류(질문 전제가 문서와 다름) / 문서에없음(환각 테스트) / 미확인(정답키 없음)
#   페이지: PDF 파일 기준 페이지 번호(1부터). 인쇄된 쪽번호가 아님. (PDF p44 = 인쇄 32쪽)
# ============================================================
IT = "IT기술교육체계수립"
SOP = "재난현장SOP"
Q = [
 # ---------- IT기술교육_IT기술교육체계수립.pdf ----------
 (IT,"1","1-1","기본","IT 기술 교육 체계 수립 5단계 절차 설명해줘.","전제오류",[11,13,15],["내부 환경","직무","직급","체계도"],
  "문서에 '5단계'는 없음. 실제 구성은 3단계(학습1 내부 환경 분석→학습2 직무·직급별 교육 정의→학습3 체계도 작성)"),
 (IT,"1","1-2","세부","교육 체계 수립 절차 중 3단계와 4단계의 핵심 과제는 뭐야?","전제오류",[11,13,72,73],["체계도"],
  "4단계는 존재하지 않음. 3단계=체계도 작성(직급별/직무별/전사)"),
 (IT,"1","1-3","변형","사내 IT 교육 체계를 처음 만들 때 따라야 하는 프로세스 순서 알려줘.","정답있음",[11,13,15],["내부 환경","직무","직급","체계도"],
  "내부 환경 분석→직무·직급별 교육 정의→교육 체계도 작성"),
 (IT,"1","1-4","예외","교육 체계 수립 5단계 중 성과 평가 단계는 몇 번째에 위치해 있어?","문서에없음",[10],[],
  "성과 평가는 이 모듈의 단계가 아니라 별도 NCS 능력단위('IT 기술 교육 성과 평가', p10 목록에만 등장)"),
 (IT,"2","2-1","기본","직급별 IT 기술 교육 기획 로드맵 절차에 대해 알려줘.","정답있음",[41,44,45,46,47],["인사","직급","권한","책임","직무 분석"],
  "①인사부서 협조로 직급·직무 체계 파악 ②직급별 권한·역할·책임 파악 ③직무 분석 기획 ④직무 분석 실시 ⑤직급별 IT 교육 필요사항 구체화"),
 (IT,"2","2-2","세부","신입사원과 책임급 연구원의 교육 로드맵 차이점은 뭐야?","문서에없음",[],[],
  "문서에 신입사원/책임급 등 구체 직급명 없음"),
 (IT,"2","2-3","변형","연차나 직급에 맞춰서 IT 교육 체계를 설계하려면 어떤 로드맵을 봐야 해?","정답있음",[72,73,74,75,76,77],["체계도","직급"],
  "직급별 IT 기술 교육 체계도(학습 3-1). 체계도=육성 로드맵 제시(p73)"),
 (IT,"2","2-4","응용","관리자급 직급을 위한 맞춤형 IT 교육 과정에는 어떤 것들이 포함돼?","문서에없음",[],[],
  "관리자급 대상 구체 과정 목록 없음"),
 (IT,"3","3-1","기본","직무·직급별 교육 요구 분석 방법에 대해 설명해줘.","정답있음",[31,45,46],["인터뷰","설문","관찰","직무 분석"],
  "교육 필요성 분석(TNA): 조직/부서/개인·직무 수준, 인터뷰·설문·관찰(p31) + 직무 분석(p45~46)"),
 (IT,"3","3-2","세부","교육 요구 분석을 할 때 설문조사나 인터뷰는 어떤 방식으로 진행해?","정답있음",[31,32,35,36,37],["포커스 그룹","인터뷰","설문"],
  "포커스 그룹 인터뷰(FGI): 진행자는 퍼실리테이터 역할, 참가자 의견 청취 중심(p31)"),
 (IT,"3","3-3","변형","직원들이 어떤 IT 교육을 필요로 하는지 니즈(Needs)를 도출하는 가이드라인이 있어?","정답있음",[31],["필요성","조직","부서","개인"],
  "교육 필요성 분석=교육 요구 분석, 조직·부서·개인(직무) 수준에서 파악(p31)"),
 (IT,"3","3-4","실무","현업 직무 분석을 통해 교육 과제를 도출하는 세부 기법에는 뭐가 있어?","정답있음",[45,46,47],["서면","인터뷰","워크숍","직무 분석"],
  "서면·인터뷰·워크숍 방식 직무 분석 → 상급자/전문가 검토 → 공통 특성 정리 → IT 교육 필요사항 구체화(p46)"),
 (IT,"4","4-1","기본","교육 프로그램 설계 및 모듈 구성 방식은 어떻게 돼?","문서에없음",[],[],
  "교과·모듈 설계는 별도 능력단위('IT 기술 교육 교과 개발'). 이 문서엔 없음"),
 (IT,"4","4-2","세부","하나의 IT 과목을 모듈화할 때 단위 모듈의 구성 요소는 뭐야?","문서에없음",[],[],"'모듈화' 내용 없음"),
 (IT,"4","4-3","변형","교육 커리큘럼을 교과목 모듈 형태로 조립하고 설계하는 방법 알려줘.","문서에없음",[],[],"'커리큘럼' 단어 자체가 없음"),
 (IT,"4","4-4","실무","실습 위주의 IT 교육 프로그램을 모듈식으로 짤 때 주의할 점은?","문서에없음",[],[],"없음"),
 (IT,"5","5-1","기본","교육 성과 평가 및 피드백 모니터링 체계에 대해 말해줘.","문서에없음",[],[],
  "성과 평가는 별도 능력단위. 주의: 문서 속 '평가/피드백'(p40 등)은 학습자 평가표라 오답 근거로 검색될 위험 큼"),
 (IT,"5","5-2","세부","교육 만족도 조사 외에 현업 적용도를 평가하는 모니터링 지표가 있어?","문서에없음",[],[],"'만족도','모니터링','현업 적용' 없음"),
 (IT,"5","5-3","변형","IT 교육이 끝난 후 성과를 측정하고 피드백을 수집하는 절차는?","문서에없음",[],[],"없음"),
 (IT,"5","5-4","응용","평가 결과가 미진할 경우 교육 과정을 개선하는 모니터링 환류 체계는 뭐야?","문서에없음",[],[],"'환류' 없음"),
 # ---------- 재난현장 표준작전절차(SOP) 안내.pdf ----------
 # (SOP는 페이지 대신 '근거 문구'로 검색 적중을 판정 → 아래 EVID 참고)
 (SOP,"1","1-1","기본","재난현장 표준작전절차 지휘통제절차에 대해 안내해줘.","정답있음",[],["지휘선언","상황판단","대응활동계획","지휘위치","철수"],
  "SOP 100: 선착대장 지휘선언→상황판단→대응단계 발령→지휘위치 선정·상황평가→대응활동계획→현장지휘조직→철수·복귀"),
 (SOP,"1","1-2","세부","재난 발생 초기 단계에서 현장지휘관이 가장 먼저 수행해야 하는 통제 절차는 뭐야?","정답있음",[],["지휘선언","상황전파"],
  "SOP 100 1.1: 현장 도착 즉시 최초 상황전파 및 지휘선언"),
 (SOP,"1","1-3","변형","재난 현장에 도착했을 때 지휘권을 선언하고 통제 체계를 가동하는 순서 알려줘.","정답있음",[],["지휘선언","현장도착","상황판단","후착대"],
  "SOP 100: '00센터 00차 현장도착' 지휘선언→상황판단→대응단계 발령·추가지원 요청→후착대 도착보고 후 임무지정"),
 (SOP,"1","1-4","실무","현장 대응 중 지휘권이 상급 기관으로 이양될 때 따라야 하는 SOP 수칙은?","정답있음",[],["인수인계","대면","브리핑","지휘선언"],
  "SOP 102: 이양 시기 5가지, 인수인계 사항(상황·IAP·조직도·자원 등), 상호 대면 원칙, 브리핑, 공개 지휘선언. 문서 표현은 '상급기관'이 아니라 '상급지휘관'"),
 (SOP,"2","2-1","기본","지휘위치(통제단) 고정, 이동, 원격 지휘 수칙 알려줘.","정답있음",[],["고정","이동","원격","무선통신","전진"],
  "SOP 103: 전진/이동/고정 지휘 형태, 2.12 무선통신을 통한 원격지휘, 2.13 통제단에서 고정 지휘·필요시 이동 지휘"),
 (SOP,"2","2-2","세부","재난 현장의 위험도가 높아져 지휘위치를 이동해야 할 때 지켜야 할 안전 수칙은?","전제오류",[],["붕괴","낙하물"],
  "'지휘위치 이동 시 안전수칙'은 별도로 없음. 관련 내용은 SOP 101 지휘소 위치 기준(붕괴·낙하물 등 영향이 적은 곳)"),
 (SOP,"2","2-3","변형","현장에 직접 접근하기 어려울 때 원격으로 지휘통제단을 운영하는 조건과 규정은 뭐야?","전제오류",[],["무선통신","원격"],
  "원격지휘 '조건'은 없음. SOP 103 2.12에 '무선통신을 통한 원격지휘, 필요시 직접·전진 지휘' 한 줄만 있음"),
 (SOP,"2","2-4","응용","현장지휘소가 고정형으로 설치되는 기준 위치와 필수 배치 항목은?","정답있음",[],["조망","통신","전력","무전기","상황판"],
  "SOP 101: 설치 위치 9가지(조망·영향 적은 곳·통신/전력 등) + 비치 물품(조명·확성기·지도/상황판·무전기 등). '필수'가 아니라 '선택적 배치'"),
 (SOP,"3","3-1","기본","무선통신 기반 통신·명령 전달 및 녹음 규정에 대해 설명해줘.","정답있음",[],["녹음","재확인","수명자","지시내용"],
  "SOP 103 지휘활동기준: 음성(무선) 지시 원칙, 전달 여부 재확인, 무선통신 녹음 또는 일지·상황판 기록(시간·수명자·전달방법·지시내용), 표준 일상어"),
 (SOP,"3","3-2","세부","무선통신으로 명령을 전달할 때 메시지의 혼선을 막기 위한 무선교신 약어 및 수칙은?","전제오류",[],["표준 일상어","재확인"],
  "현장 약어 목록 없음. 오히려 '표준 일상어로 간명하게'(SOP 103 2.19). 약어 언급은 119상황실 출동지령 부분에만 있음"),
 (SOP,"3","3-3","변형","재난 현장 녹음 데이터는 어떤 상황에서 필수적으로 기록해야 하고, 보관 기간은 어떻게 돼?","전제오류",[],["녹음","일지"],
  "녹음·기록 규정은 있으나(SOP 103 2.14) '보관 기간'은 문서에 없음 → 보관기간을 숫자로 답하면 환각"),
 (SOP,"3","3-4","실무","통신 장애가 발생했을 때 비상 명령을 전달하는 대체 통신망 운용 수칙은 뭐야?","문서에없음",[],[],
  "대체 통신망 수칙 없음. 관련 단서: 무전(전령) 임무부여, 문서로 지시 가능 정도"),
 (SOP,"4","4-1","기본","현장 대원 인력 관리 및 피로 교체 기준이 어떻게 돼?","정답있음",[],["교대조","피로","투입시간","인수인계"],
  "SOP 100 4.5 현장 교대조 운영(IAP에 투입·철수예정시간 기록, 현장지휘관 판단, 인수인계) + SOP 103 2.15 피로한 대원 적시 교체"),
 (SOP,"4","4-2","세부","연속으로 진화 작업에 투입된 대원의 최대 교체 주기 시간은 몇 시간이야?","문서에없음",[],[],
  "구체적 시간 기준 없음(현장지휘관 판단) → 'N시간'이라고 답하면 환각"),
 (SOP,"4","4-3","변형","대원들의 피로 누적으로 인한 안전사고를 방지하기 위해 제공해야 하는 휴식 및 교체 수칙은?","정답있음",[],["교대","휴식","피로"],
  "피로한 대원 적시 교체, 장시간 활동 시 교대조 운영 또는 휴식 시간 부여(현장지휘관 판단)"),
 (SOP,"4","4-4","응용","현장 대원의 건강 상태 이상 발생 시 즉시 교체조를 투입하는 인력 관리 절차 알려줘.","전제오류",[],["건강상태","신속동료구조팀"],
  "'즉시 교체조 투입 절차'는 없음. 관련: RIT의 대원 활동 모니터링, 인원점검 시 부상·건강상태·피로도 확인 보고"),
 (SOP,"5","5-1","기본","유관기관 통합지휘 및 현장 지휘소 보고 체계에 대해 정리해줘.","정답있음",[],["연락관","연락담당","무전기","임무","보고"],
  "SOP 103 3: 연락관 도착 즉시 연락담당에 통보→무전기 지급→임무부여(종류·장소·시간)→수시 보고→철수 시 보고·장비 반납"),
 (SOP,"5","5-2","세부","경찰, 지자체, 군 등 유관기관과 합동 지휘소를 구성할 때 보고서 작성 및 공유 주기는?","전제오류",[],["연락관","수시"],
  "정해진 '주기' 없음. 연락관이 임무 수행상황을 '수시로' 보고. 군 관련 언급도 없음"),
 (SOP,"5","5-3","변형","다양한 외부 기관이 현장에 지원 왔을 때 지휘권을 일원화하여 통제하는 통합지휘체계 규정은?","정답있음",[],["연락관","단일","지휘선언","임무"],
  "유관기관 통합지휘절차 + 분할·위임된 지휘권은 단일 계통으로 행사, 지휘선언 안 한 지휘관은 지시 금지(SOP 102·103)"),
 (SOP,"5","5-4","실무","상급 상황실이나 지자체 상황실로 현장 상황을 적시에 보고하는 표준 보고서 양식 및 시점은?","정답있음",[],["최초보고","중간보고","최종보고","상황보고서"],
  "SOP 504: 최초-중간-최종보고, 서면·팩스·전화 등 가장 빠른 방법, '화재 등 사고 상황보고서' 양식, 보고 기준(사망 5명 이상 등)"),
]

# SOP는 txt/PDF 페이지 번호 대신 '근거 문구'(원문 고유 문장, 공백 제거 후 비교)가 Top-3 청크에 있으면 검색 적중
EVID = {
 (SOP,"1-1"):["선착대장은현장도착즉시","지휘위치선정및상황평가","대응활동계획수립"],
 (SOP,"1-2"):["최초상황전파및지휘선언"],
 (SOP,"1-3"):["출동대명및선착대장지휘선언","후착대는현장지휘관"],
 (SOP,"1-4"):["인수인계지휘관의상호대면","이양시기","인수인계사항"],
 (SOP,"2-1"):["지휘형태선택기준","무선통신을통한원격지휘","에서고정지휘"],
 (SOP,"2-2"):["영향이적은곳"],
 (SOP,"2-3"):["무선통신을통한원격지휘"],
 (SOP,"2-4"):["현장지휘소설치위치","현장지휘소비치물품"],
 (SOP,"3-1"):["무선통신을녹음하거나","전달여부재확인"],
 (SOP,"3-2"):["표준일상어로간명하게","미리정해진약어"],
 (SOP,"3-3"):["무선통신을녹음하거나"],
 (SOP,"4-1"):["피로한대원","투입시간과"],
 (SOP,"4-3"):["휴식시간부여","피로한대원"],
 (SOP,"4-4"):["부상유무,건강상태,피로도","활동상황모니터링"],
 (SOP,"5-1"):["연락관은현장도착즉시","유관기관통합지휘절차"],
 (SOP,"5-2"):["임무수행상황을수시로확인"],
 (SOP,"5-3"):["단일한계통","유관기관통합지휘절차"],
 (SOP,"5-4"):["최초보고-중간보고-최종보고","상황보고기준"],
}

# ============================================================
# 3) 검색기 / API 호출
# ============================================================
def load_db():
    try:
        from langchain_huggingface import HuggingFaceEmbeddings
    except ImportError:
        from langchain_community.embeddings import HuggingFaceEmbeddings
    try:
        from langchain_chroma import Chroma
    except ImportError:
        from langchain_community.vectorstores import Chroma
    emb = HuggingFaceEmbeddings(model_name=EMBED_MODEL)
    return Chroma(persist_directory=CHROMA_DIR, collection_name=COLLECTION, embedding_function=emb)

def ask_api(q):
    """route.ts 응답: 한 줄마다 {"reasoning": "...", "content": "..."} (스트리밍) → content만 이어붙임"""
    import requests
    t = time.time()
    r = requests.post(API_URL, json={API_Q_KEY: q}, timeout=300, stream=True)
    if r.status_code != 200:
        return f"[API 오류 {r.status_code}] {r.text[:200]}", time.time() - t
    parts, raw = [], []
    for line in r.iter_lines():
        if not line:
            continue
        line = line.decode("utf-8", errors="ignore").strip()
        raw.append(line)
        if line.startswith("data:"):
            line = line[5:].strip()
        try:
            d = json.loads(line)
        except Exception:
            continue
        if isinstance(d, dict):
            if isinstance(d.get("content"), str):
                parts.append(d["content"])
            elif d.get("choices"):
                delta = d["choices"][0].get("delta") or d["choices"][0].get("message") or {}
                parts.append(delta.get("content") or "")
            elif "error" in d:
                return f"[API 오류] {d['error']}", time.time() - t
    answer = "".join(parts).strip() or "\n".join(raw)[:2000]
    return answer, time.time() - t

def norm(s):
    return re.sub(r"\s+", "", s or "")

def src_doc(meta):
    s = str(meta.get("source_file") or meta.get("source") or "")   # main.py는 source_file에 파일명 저장
    if "SOP" in s or "재난" in s: return SOP
    if "IT" in s or "교육" in s: return IT
    return s.split("/")[-1][:20]

# ============================================================
# 4) 판정 로직
# ============================================================
def judge(expect, hit, kw_rate, refused, halluc_hint):
    if expect == "미확인":
        return "수동확인"
    if expect == "문서에없음":
        return "PASS(정직하게 거절)" if refused else "FAIL(환각 의심)"
    if expect == "전제오류":
        if halluc_hint and not refused: return "FAIL(없는 단계 지어냄)"
        if kw_rate >= KW_PASS and refused: return "PASS(전제 정정)"
        if kw_rate >= KW_PASS: return "PARTIAL(내용은 맞으나 전제 미정정)"
        return "FAIL"
    # 정답있음
    if hit and kw_rate >= KW_PASS: return "PASS"
    if hit or kw_rate >= KW_PASS: return "PARTIAL"
    return "FAIL"

def main():
    use_api = "--no-api" not in sys.argv
    db = load_db()
    answers = {}
    if use_api:
        from concurrent.futures import ThreadPoolExecutor
        def _run(item):
            try:
                return item[2], ask_api(item[4])
            except Exception as e:
                return item[2], (f"[API 오류] {e}", 0.0)
        print(f"답변 생성 중... ({len(Q)}개, 동시 {WORKERS}개)")
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for n, ((key), res) in enumerate(ex.map(lambda it: ((it[0], it[2]), _run(it)[1]), Q), 1):
                answers[key] = res
                print(f"  {n}/{len(Q)} 완료")
    rows = []
    for doc, topic, qid, qtype, q, expect, exp_pages, kws, note in Q:
        res = db.similarity_search_with_score(q, k=TOP_K)
        pages = [int(d.metadata.get("page", -1)) + 1 for d, _ in res]   # PyPDFLoader page는 0부터 → +1
        docs  = [src_doc(d.metadata) for d, _ in res]
        dists = [round(float(s), 3) for _, s in res]
        ctx   = "\n".join(d.page_content for d, _ in res)
        wrong_doc = any(x != doc for x in docs)   # 회사소개서 등 다른 문서가 섞였는지
        page_hit = bool(exp_pages) and any(p in exp_pages and dd == doc for p, dd in zip(pages, docs))
        evid = EVID.get((doc, qid), [])
        evid_hit = bool(evid) and any(norm(e) in norm(ctx) for e in evid)
        hit = page_hit or evid_hit
        has_key = bool(exp_pages or evid)

        answer, sec = answers.get((doc, qid), ("", 0.0))
        target = answer if use_api else ctx
        kw_found = [k for k in kws if norm(k) in norm(target)]
        kw_rate = round(len(kw_found) / len(kws), 2) if kws else 0.0
        refused = any(p in answer for p in REFUSAL) if use_api else False
        halluc_hint = bool(re.search(r"(4|5)\s*단계", answer)) if use_api else False

        if use_api:
            verdict = judge(expect, hit, kw_rate, refused, halluc_hint)
        else:  # 검색만 평가
            verdict = ("수동확인" if expect == "미확인" else
                       "해당없음(문서에없음)" if expect == "문서에없음" else
                       "HIT" if hit else "MISS")
        rows.append({
            "문서": doc, "주제": topic, "ID": qid, "유형": qtype, "질문": q,
            "기대(정답키)": expect, "정답 근거 페이지": ",".join(map(str, exp_pages)),
            "검색 Top3 페이지": ",".join(map(str, pages)), "검색 Top3 문서": ",".join(docs),
            "다른 문서 섞임": "Y" if wrong_doc else "", "거리(낮을수록 유사)": ",".join(map(str, dists)),
            "검색 적중": "O" if hit else ("-" if not has_key else "X"),
            "키워드 포함률": kw_rate if kws else "-", "포함 키워드": ",".join(kw_found),
            "거절 표현": "Y" if refused else "", "응답시간(초)": round(sec, 1),
            "자동 판정": verdict, "사람 확인(O/X)": "", "답변": answer, "정답 요약": note,
            "검색 근거 원문(Top3)": ctx[:1500],
        })
        print(f"[{doc} {qid}] {verdict}  pages={pages}")

    df = pd.DataFrame(rows)
    # ---------- 요약 지표 ----------
    summ = []
    for doc in [IT, SOP]:
        d = df[df["문서"] == doc]
        ans = d[d["기대(정답키)"].isin(["정답있음", "전제오류"])]
        out = d[d["기대(정답키)"] == "문서에없음"]
        summ.append({
            "문서": doc, "질문 수": len(d),
            "검색 적중률(Hit@3)": f'{(ans["검색 적중"]=="O").mean():.0%}' if len(ans) else "-",
            "답변 PASS율(정답있음/전제오류)": f'{ans["자동 판정"].str.startswith("PASS").mean():.0%}' if len(ans) and use_api else "-",
            "환각 방지율(문서에없음→거절)": f'{out["자동 판정"].str.startswith("PASS").mean():.0%}' if len(out) and use_api else "-",
            "다른 문서 섞인 비율": f'{(d["다른 문서 섞임"]=="Y").mean():.0%}',
            "평균 응답시간(초)": round(d["응답시간(초)"].mean(), 1),
        })
    for t in ["기본", "세부", "변형", "실무", "응용", "예외"]:
        d = df[(df["유형"] == t) & (df["기대(정답키)"] != "미확인")]
        if len(d) and use_api:
            summ.append({"문서": f"유형:{t}", "질문 수": len(d),
                         "답변 PASS율(정답있음/전제오류)": f'{d["자동 판정"].str.startswith("PASS").mean():.0%}'})
    sm = pd.DataFrame(summ)

    out = "실험C_300자_k5_도구off.xlsx"
    with pd.ExcelWriter(out, engine="openpyxl") as w:
        df.to_excel(w, sheet_name="질문별 결과", index=False)
        sm.to_excel(w, sheet_name="요약 지표", index=False)
        for ws in w.book.worksheets:
            for col in ws.columns:
                width = min(max(len(str(c.value or "")) for c in col[:30]) + 2, 60)
                ws.column_dimensions[col[0].column_letter].width = width
            ws.freeze_panes = "F2" if ws.title == "질문별 결과" else "B2"
    print("\n저장 완료:", out)
    print(sm.to_string(index=False))

if __name__ == "__main__":
    main()
