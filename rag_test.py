import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma

# 1. PDF 파일 로드 (준비한 PDF 파일명 적기)
pdf_path = "(주)사미텍_회사소개서.pdf"  
loader = PyPDFLoader(pdf_path)
documents = loader.load()
print(f"📄 총 {len(documents)} 페이지의 문서를 로드했습니다.")

# 2. 텍스트 청킹 (Chunking) - 문서를 적당한 크기로 쪼개기
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,     # 한 조각당 약 500자 단위
    chunk_overlap=50    # 문맥 연결을 위해 50자씩 겹치게 나눔
)
chunks = text_splitter.split_documents(documents)
print(f"🧩 문서를 총 {len(chunks)}개의 청크(조각)로 나눴습니다.")

# 3. 무료 한국어 임베딩 모델 설정
embeddings = HuggingFaceEmbeddings(
    model_name="jhgan/ko-sroberta-multitask"  # 한국어 성능이 좋은 무료 오픈소스 모델
)

# 4. ChromaDB에 벡터로 저장 (프로젝트 폴더 내 ./chroma_db 에 자동 생성)
vector_db = Chroma.from_documents(
    documents=chunks,
    embedding=embeddings,
    persist_directory="./chroma_db"
)
print("✅ ChromaDB에 문서 벡터 데이터 저장 완료!")

# 5. 질문으로 관련 문서 청크 검색 테스트
query = "문서의 핵심 내용에 대해 알려줘"  # 👈 PDF 내용과 관련된 질문 입력
docs = vector_db.similarity_search(query, k=2) # 가장 유사한 2개 조각 가져오기

print("\n🔍 --- 검색된 유사 문서 조각 ---")
for i, doc in enumerate(docs):
    print(f"\n[{i+1}번째 결과 (페이지 {doc.metadata.get('page', 0)+1})]")
    print(doc.page_content)