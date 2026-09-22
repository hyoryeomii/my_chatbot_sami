import { NextResponse } from 'next/server';

// tool calling
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
    const { message, reasoningEffort, model } = await req.json();
    const selectedModel = model || '빠른 모델 플러스';

    const SAMIGPT_API_URL = process.env.SAMIGPT_API_URL || 'https://gpt.samitech.kr/api/llm';
    const SAMIGPT_API_KEY = process.env.SAMIGPT_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaGVjayI6ZmFsc2UsInVzZXJuYW1lIjoiZ3lmdWQ1MjE2IiwiZXhwIjo4OTQyOTQ1NzIxfQ.gGr6plsCOZkz-3FociJUsPSjH8E2SnGWPf6q0M8AY84';
    const USER_COOKIE = process.env.USER_COOKIE || '__Host-next-auth.csrf-token-gpt=...';

    const requestHeaders = {
      'Accept': 'text/event-stream, application/json, */*',
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${SAMIGPT_API_KEY}`,
      'Cookie': USER_COOKIE,
      'Chat-Session-Id': 'flove-main-94d5bae8a409cd2baec4a61144f857f3',
      'Organization': 'sami',
      'X-Organization-Code': 'sami',
    };

    // 1단계 시스템 프롬프트 (한국어 사고 강력 지침)
    const systemPrompt = `
너는 도구 판단 에이전트야. 사용자의 질문을 분석해서 외부 도구 호출이 필요한지 판단해.
CRITICAL INSTRUCTION: 너의 모든 내부 추론 및 사고 과정(Reasoning/CoT)은 절대로 영어를 쓰지 말고 오직 '한국어'로만 작성해라.

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

    // 1차 호출: 도구 사용 필요 여부 판단
    const checkResponse = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        reasoning_effort: reasoningEffort || 'medium',
        temperature: 0,
        stream: false,
        org_code: 'sami',
        organization: 'sami',
      }),
    });

    const checkData = await checkResponse.json();
    const resultText = checkData.choices?.[0]?.message?.content?.trim() || '';

    let externalData = '';

    if (resultText.includes('get_weather')) {
      try {
        const parsed = JSON.parse(resultText);
        if (parsed.tool === 'get_weather') {
          const city = parsed.city || '대전';
          const date = parsed.date || '오늘';
          externalData = await getWeather(city, date);
        }
      } catch (e) {
        // 파싱 실패 시 일반 대화 진행
      }
    }

    // 2단계 프롬프트 (한국어 추론 유도 강화)
    const finalMessages = [
      {
        role: 'system',
        content: `너는 친절하고 유용한 AI 비서이다.
[중요 지침] 답변을 도출하기 위한 모든 사고 과정(Reasoning, Thinking process)은 반드시 100% 한국어로만 작성해야 한다. 영어나 다른 언어를 생각 과정에 사용하지 마라.`
      }
    ];

    if (externalData) {
      finalMessages.push({
        role: 'system',
        content: `다음은 조회된 외부 데이터이다. 이 데이터를 바탕으로 사용자의 질문에 친절하게 답변해라:\n${externalData}`
      });
    }

    finalMessages.push({ role: 'user', content: message });

    // 2차 호출: 스트리밍 답변 생성
    const streamResponse = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: selectedModel,
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
            // 파싱 오류 무시
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