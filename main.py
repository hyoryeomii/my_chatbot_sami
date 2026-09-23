from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings

app = FastAPI()

# Next.js 프론트엔드 통신 허용 (CORS 설정)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ChromaDB 및 임베딩 로드
embeddings = HuggingFaceEmbeddings(model_name="jhgan/ko-sroberta-multitask")
vectorstore = Chroma(persist_directory="./chroma_db", embedding_function=embeddings)

class QueryRequest(BaseModel):
    query: str

@app.post("/api/search")
async def search_rag(request: QueryRequest):
    # 질문과 관련된 상위 3개 문맥 검색
    results = vectorstore.similarity_search(request.query, k=3)
    
    docs = []
    for doc in results:
        docs.append({
            "content": doc.page_content,
            "page": doc.metadata.get("page", 0) + 1
        })
        
    return {"results": docs}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)