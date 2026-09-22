import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { message, reasoningEffort } = await req.json();

    // ⬇️ URL 끝에 org_code 및 organization 쿼리 파라미터를 직접 명시했습니다.
    const SAMIGPT_API_URL = process.env.SAMIGPT_API_URL || 'https://gpt.samitech.kr/api/llm';
    const SAMIGPT_API_KEY = process.env.SAMIGPT_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaGVjayI6ZmFsc2UsInVzZXJuYW1lIjoiZ3lmdWQ1MjE2IiwiZXhwIjo0OTQyOTQ1NzIxfQ.gGr6plsCOZkz-3FociJUsPSjH8E2SnGWPf6q0M8AY84';
    const USER_COOKIE = process.env.USER_COOKIE || '__Host-next-auth.csrf-token-gpt=db7ee97142721316dcdd2e2e3015282f29289e14f3b4dc8125cbea74a818ad91%7C27a14d937d24e3890abe56455c4206cae332e895e2b251e9d55aae63adc8be38; __Secure-next-auth.callback-url-gpt=http%3A%2F%2Flocalhost%3A3000; __Secure-next-auth.session-token-gpt=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..QoP6GSzrpFrpIyCi.STcMukaN7-I06BZc9ZdNQNaPUruL1fi1sQHjWpedVUiUgKv-tzwarqzLMDeD3s6Sk11VFVqjNNsiSXU2XwRySKZzSm_pjKrXJZuy3yFiUCK_DPRnd4VNxi2Ytj8HRMBXsJXZOX1XbbNjUkKdmwu6K6f37xK2XUeQHYPrY9k-4Tj7ACIaHUdBHrjI2dXRTnHi2dOecm_WL5WdaUh0VJkOiE4g4CZDbNad_WXNaIL_-LDMu9BY8Vw1kzkHncXpSyYG6JDz5XIC-RnklKl0fe-ATDFuEs3BiwSqllq9AsuDNenDAaieep39tO6wdxUFDP6KdT57uxX3-jsYE23cjyHsvZ4d_PYvVkgJlJdqbS--I2_MUwpTLTnDm9UxtGzpLAmpi-8jn5cEZKiTLL7RHphVjPG32mTP7nIxIprD2ujcRGvd5jfBewSkaPsN8tBTEXZXnM6G8aFzz1X-n28gPoQzK1ymrP0bX81KablBvqy0CY9jlcq5q_6Vqy1SeP7mw50Qji76abBaIXaZTve98okvU8XlrCG4tnmE1dxOMxRJPT8r8evlBY0j5BNbiDXQzNGjUJ17wayTaVhmczYON9p6dFTO0bHiXrG7DUXvT3LzgwDHnnZe4uD8_shdl83QyDlFuT50rhB5AnjVwUEnscf8NJjtFEsqAibpUiaOmZPYdag5ubRVnS_eXWfYWA9IsiHbPnS5ntbYcw_sPKHc3o0hjU_RZHbWoZVBM_d0OeTvsBTgRUiyZPNBUnPlsDsrTKAbY4k_NTApwd9ZXF3ACtW7njaSah32qzzxPA3G5p3ywbRkyNofwrodLArdg3yj6X9BWNM.2j3992k0toJ6Nhrcts5xXQ';

    const response = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream, application/json, */*',
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${SAMIGPT_API_KEY}`,
        'Cookie': USER_COOKIE,
        'Chat-Session-Id': 'flove-main-94d5bae8a409cd2baec4a61144f857f3',
        'Organization': 'sami',
        'X-Organization-Code': 'sami',
      },
      body: JSON.stringify({
        model: "빠른 모델 플러스",
        messages: [{ role: "user", content: message }],
        reasoning_effort: reasoningEffort || "medium",
        temperature: 1,
        stream: true,
        // 혹시 몰라 Body에도 조직 관련 필드들 유지
        org_code: "sami",
        organization: "sami",
      }),
    });

    if (!response.body) {
      return NextResponse.json({ error: 'No response body' }, { status: 500 });
    }

    // TransformStream을 사용하여 SSE 텍스트 데이터를 JSON 객체 형태의 스트림으로 변환
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk);
        const lines = text.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta;

              if (delta) {
                const reasoning = delta.reasoning_content || delta.reasoning || '';
                const content = delta.content || '';

                if (reasoning || content) {
                  // 클라이언트에게 파싱된 데이터만 JSON 한 줄로 전송
                  controller.enqueue(
                    encoder.encode(JSON.stringify({ reasoning, content }) + '\n')
                  );
                }
              }
            } catch {
              // JSON 파싱 실패 시 무시
            }
          }
        }
      },
    });

    return new Response(response.body.pipeThrough(transformStream), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('사미GPT 연동 에러:', error);
    return NextResponse.json({ error: '사미GPT 서버 통신 실패' }, { status: 500 });
  }
}