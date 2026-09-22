import { NextResponse } from 'next/server';

// 1. 실제로 실행할 외부 날씨 정보 함수 (예: Mock 데이터)
async function getWeather(city: string, date: string = '오늘') {
  const isDaejeon = city.includes('대전') || city.toLowerCase().includes('daejeon');
  const targetCity = isDaejeon ? '대전' : city;

  if (date.includes('내일')) {
    return JSON.stringify({
      location: targetCity,
      target_date: '내일',
      temperature: '20°C',
      condition: '흐림 (오후 한때 비)',
      humidity: '65%',
      rain_probability: '60%'
    });
  }

  // 기본값: 오늘 날씨
  return JSON.stringify({
    location: targetCity,
    target_date: '오늘',
    temperature: '22°C',
    condition: '맑음',
    humidity: '45%'
  });
}

export async function POST(req: Request) {
  try {
    const { message, reasoningEffort } = await req.json();

    const SAMIGPT_API_URL = process.env.SAMIGPT_API_URL || 'https://gpt.samitech.kr/api/llm';
    const SAMIGPT_API_KEY = process.env.SAMIGPT_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaGVjayI6ZmFsc2UsInVzZXJuYW1lIjoiZ3lmdWQ1MjE2IiwiZXhwIjo0OTQyOTQ1NzIxfQ.gGr6plsCOZkz-3FociJUsPSjH8E2SnGWPf6q0M8AY84';
    const USER_COOKIE = process.env.USER_COOKIE || '__Host-next-auth.csrf-token-gpt=db7ee97142721316dcdd2e2e3015282f29289e14f3b4dc8125cbea74a818ad91%7C27a14d937d24e3890abe56455c4206cae332e895e2b251e9d55aae63adc8be38; __Secure-next-auth.callback-url-gpt=http%3A%2F%2Flocalhost%3A3000; __Secure-next-auth.session-token-gpt=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..QoP6GSzrpFrpIyCi.STcMukaN7-I06BZc9ZdNQNaPUruL1fi1sQHjWpedVUiUgKv-tzwarqzLMDeD3s6Sk11VFVqjNNsiSXU2XwRySKZzSm_pjKrXJZuy3yFiUCK_DPRnd4VNxi2Ytj8HRMBXsJXZOX1XbbNjUkKdmwu6K6f37xK2XUeQHYPrY9k-4Tj7ACIaHUdBHrjI2dXRTnHi2dOecm_WL5WdaUh0VJkOiE4g4CZDbNad_WXNaIL_-LDMu9BY8Vw1kzkHncXpSyYG6JDz5XIC-RnklKl0fe-ATDFuEs3BiwSqllq9AsuDNenDAaieep39tO6wdxUFDP6KdT57uxX3-jsYE23cjyHsvZ4d_PYvVkgJlJdqbS--I2_MUwpTLTnDm9UxtGzpLAmpi-8jn5cEZKiTLL7RHphVjPG32mTP7nIxIprD2ujcRGvd5jfBewSkaPsN8tBTEXZXnM6G8aFzz1X-n28gPoQzK1ymrP0bX81KablBvqy0CY9jlcq5q_6Vqy1SeP7mw50Qji76abBaIXaZTve98okvU8XlrCG4tnmE1dxOMxRJPT8r8evlBY0j5BNbiDXQzNGjUJ17wayTaVhmczYON9p6dFTO0bHiXrG7DUXvT3LzgwDHnnZe4uD8_shdl83QyDlFuT50rhB5AnjVwUEnscf8NJjtFEsqAibpUiaOmZPYdag5ubRVnS_eXWfYWA9IsiHbPnS5ntbYcw_sPKHc3o0hjU_RZHbWoZVBM_d0OeTvsBTgRUiyZPNBUnPlsDsrTKAbY4k_NTApwd9ZXF3ACtW7njaSah32qzzxPA3G5p3ywbRkyNofwrodLArdg3yj6X9BWNM.2j3992k0toJ6Nhrcts5xXQ';

    const requestHeaders = {
      'Accept': 'text/event-stream, application/json, */*',
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${SAMIGPT_API_KEY}`,
      'Cookie': USER_COOKIE,
      'Chat-Session-Id': 'flove-main-94d5bae8a409cd2baec4a61144f857f3',
      'Organization': 'sami',
      'X-Organization-Code': 'sami',
    };

    // 1단계 시스템 프롬프트: 도구 사용 필요 여부를 판단하도록 지시
    const systemPrompt = `
너는 도구 판단 에이전트야. 사용자의 질문을 분석해서 외부 도구 호출이 필요한지 판단해.
사용 가능한 도구:
- get_weather(city: string, date: string): 도시의 날씨 정보를 조회

규칙:
1. 날씨 관련 질문이면 반드시 다음과 같은 pure JSON 형식으로만 응답해:
{"tool": "get_weather", "city": "도시이름", "date": "오늘 또는 내일"}
2. 도시 이름이 없으면 기본값 "대전"을 사용해.
3. 시점(오늘/내일 등)이 명시되지 않았다면 기본값 "오늘"을 사용해.
4. 외부 도구가 필요 없는 일반 질문이면 반드시 "NONE"이라고 응답해.
5. 설명이나 부연 설명, 마크다운 코드블럭(\`\`\`)을 절대 붙이지 마.
`;
    // 1차 호출: 도구 필요한지 비스트리밍으로 판단
    const checkResponse = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: '빠른 모델 플러스',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        reasoning_effort: reasoningEffort || 'medium',
        temperature: 0, // 정확한 판단을 위해 온도를 0으로 설정
        stream: false,
        org_code: 'sami',
        organization: 'sami',
      }),
    });

    const checkData = await checkResponse.json();
    const resultText = checkData.choices?.[0]?.message?.content?.trim() || '';

    let externalData = '';

    // 사미GPT가 JSON 형태로 응답해 도구 사용을 요구했는지 확인
    if (resultText.includes('get_weather')) {
      try {
        const parsed = JSON.parse(resultText);
        if (parsed.tool === 'get_weather') {
          const city = parsed.city || '대전';
          const date = parsed.date || '오늘';
          externalData = await getWeather(city, date);
        }
      } catch (e) {
        // JSON 파싱 실패 시 일반 대화로 처리
      }
    }

    // 2단계 프롬프트 구성: 외부 데이터가 있으면 포함시켜서 최종 답변 요청
    const finalMessages = [];
    
    if (externalData) {
      finalMessages.push({
        role: 'system',
        content: `다음은 조회된 외부 데이터이다. 이 데이터를 바탕으로 사용자의 질문에 친절하게 답변해라:\n${externalData}`
      });
    }

    finalMessages.push({ role: 'user', content: message });

    // 2차 호출: 사용자에게 보여줄 최종 답변을 스트리밍으로 수신
    const streamResponse = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: '빠른 모델 플러스',
        messages: finalMessages,
        reasoning_effort: reasoningEffort || 'medium',
        temperature: 1,
        stream: true,
        org_code: 'sami',
        organization: 'sami',
      }),
    });

    if (!streamResponse.body) {
      return NextResponse.json({ error: 'No response body' }, { status: 500 });
    }

    return createSSEStreamResponse(streamResponse.body);

  } catch (error) {
    console.error('사미GPT 연동 에러:', error);
    return NextResponse.json({ error: '사미GPT 서버 통신 실패' }, { status: 500 });
  }
}

// 헬퍼 함수: SSE 스트림 변환 및 응답 생성
function createSSEStreamResponse(body: ReadableStream<Uint8Array>) {
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
                controller.enqueue(
                  encoder.encode(JSON.stringify({ reasoning, content }) + '\n')
                );
              }
            }
          } catch {
            // JSON 파싱 에러 무시
          }
        }
      }
    },
  });

  return new Response(body.pipeThrough(transformStream), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}