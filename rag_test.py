import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma

# 1. 대상 PDF 파일 목록 정리
pdf_paths = [
    "(주)사미텍_회사소개서.pdf",
    "23.2. 재난현장 표준작전절차(SOP) 안내_1_'23.2. 재난현장 표준작전절차(SOP).pdf",  # 👈 쉼표(,) 추가
    "02.+IT기술교육_IT기술교육체계수립.pdf"
    # 추가할 PDF 파일 경로를 리스트에 넣으시면 됩니다.
]

all_documents = []

# 2. PDF 파일 순회 로드
for path in pdf_paths:
    if os.path.exists(path):
        loader = PyPDFLoader(path)
        docs = loader.load()
        # 파일 출처를 metadata에 남겨두면 나중에 출처 파악이 유용합니다.
        for doc in docs:
            doc.metadata["source_file"] = os.path.basename(path)
        all_documents.extend(docs)
        print(f"📄 '{path}' - {len(docs)}페이지 로드 완료")
    else:
        print(f"⚠️ 파일을 찾을 수 없습니다: {path}")

print(f"\n📚 총 {len(all_documents)}페이지의 문서를 집계했습니다.")

# 3. 텍스트 청킹 (의미 단위 고려 구분자 지정)
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=600,
    chunk_overlap=100,
    separators=["\n\n", "\n", ". ", " ", ""] # 문단 및 문장 단위 분할 우선
)
chunks = text_splitter.split_documents(all_documents)
print(f"🧩 전체 문서를 총 {len(chunks)}개의 청크(조각)로 나눴습니다.")

# 4. 한국어 임베딩 모델 설정
embeddings = HuggingFaceEmbeddings(
    model_name="jhgan/ko-sroberta-multitask"
)

# 5. ChromaDB 생성 및 저장 (기존 DB 덮어쓰기/재구성)
vector_db = Chroma.from_documents(
    documents=chunks,
    embedding=embeddings,
    persist_directory="./chroma_db"
)
print("✅ ChromaDB에 모든 문서 벡터 데이터 저장 완료!")

# 6. 통합 검색 테스트 (여러 질문 순회 검색)
test_queries = [
    "재난현장 표준작전절차의 지휘통제절차에 대해 알려줘",
    "IT기술교육 체계 수립 방향에 대해 설명해줘",
    "회사소개서에 나온 주요 사업 내용은 뭐야?"
]

print("\n🔍 --- 통합 검색 결과 ---")

# 👈 test_queries 리스트를 하나씩 순회하며 검색
for query in test_queries:
    print(f"\n==========================================")
    print(f"❓ 질문: {query}")
    print(f"==========================================")
    
    docs = vector_db.similarity_search(query, k=2) # 질문당 상위 2개 추출
    
    for i, doc in enumerate(docs):
        source = doc.metadata.get('source_file', '알수없음')
        page = doc.metadata.get('page', 0) + 1
        print(f"\n [{i+1}번째 결과 | 파일: {source} (페이지 {page})]")
        print(doc.page_content.strip())