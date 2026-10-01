from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

embeddings = HuggingFaceEmbeddings(model_name="jhgan/ko-sroberta-multitask")
vectorstore = Chroma(persist_directory="./chroma_db_B_300", embedding_function=embeddings) # 여기도 새 DB 검색하도록 바꿈

class QueryRequest(BaseModel):
    query: str

@app.post("/api/search")
async def search_rag(request: QueryRequest):
    # 유사도 기반 상위 5개 검색
    results = vectorstore.similarity_search(request.query, k=5)
    
    docs = []
    for doc in results:
        docs.append({
            "content": doc.page_content,
            "page": doc.metadata.get("page", 0) + 1,
            "source": doc.metadata.get("source_file", "문서")
        })
        
    return {"results": docs}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)