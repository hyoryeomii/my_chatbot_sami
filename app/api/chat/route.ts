import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const messages = body.messages || [];
    const lastMessage = Array.isArray(messages) && messages.length > 0
      ? (messages[messages.length - 1]?.content || '')
      : (body.message || body.prompt || body.query || '');

    // 1. Python FastAPI 백엔드로 RAG 문맥 검색 요청
    let contextText = '';
    if (lastMessage) {
      try {
        const ragRes = await fetch('http://127.0.0.1:8000/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: lastMessage }),
        });

        if (ragRes.ok) {
          const data = await ragRes.json();
          contextText = data.results
            .map((doc: { content: string; page: number }) => `[페이지 ${doc.page}]\n${doc.content}`)
            .join('\n\n');
        }
      } catch (err) {
        console.warn('FastAPI 백엔드 연결 실패:', err);
      }
    }

    // 2. 답변 내용 준비
    let replyText = '';
    if (contextText) {
      replyText = `📄 **참고한 문서 내용 (사미텍 회사소개서)**:\n\n${contextText}\n\n---\n💡 위 문서 내용을 바탕으로 답변을 찾았습니다! 추가로 궁금한 점이 있으신가요?`;
    } else {
      replyText = `"${lastMessage}"에 대한 관련 문서 내용을 찾지 못했거나 백엔드 서버에 연결되지 않았습니다.`;
    }

    // 3. 타이핑 효과를 위한 조각별 스트리밍 응답
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // (1) 추론 단계 알림
        const reasoningChunk = JSON.stringify({ reasoning: "ChromaDB 벡터 DB에서 관련 문서 검색 중...\n문맥 추출 완료!\n" }) + "\n";
        controller.enqueue(encoder.encode(reasoningChunk));

        // (2) 본문을 3글자씩 쪼개어 약간의 지연시간을 주고 전송 (타이핑 효과)
        const chunkSize = 3;
        for (let i = 0; i < replyText.length; i += chunkSize) {
          const chunk = replyText.slice(i, i + chunkSize);
          const contentChunk = JSON.stringify({ content: chunk }) + "\n";
          controller.enqueue(encoder.encode(contentChunk));
          
          // 15ms 대기 (타이핑 속도 조절)
          await new Promise((resolve) => setTimeout(resolve, 15));
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    console.error('Chat API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}