import { NextResponse } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 🌐 [방법 1] 기존 직접 구현한 웹 페치(Web Fetch) 함수 (Tool Calling 유지)
async function fetchWebPage(targetUrl: string) {
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      return JSON.stringify({ error: `페이지를 불러올 수 없습니다. (Status: ${res.status})` });
    }

    const html = await res.text();

    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);

    return JSON.stringify({ url: targetUrl, content: cleanText });
  } catch (error) {
    console.error('웹 페치 실패:', error);
    return JSON.stringify({ error: '웹페이지 정보를 읽어오는 데 실패했습니다.' });
  }
}

// 🔌 [방법 2] MCP(Model Context Protocol) 클라이언트 연동 함수
async function callMcpTool(toolName: string, args: Record<string, any>) {
  let transport: StdioClientTransport | null = null;
  try {
    transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    });

    const client = new Client(
      { name: 'samigpt-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    console.log(`🔌 MCP 서버 연결 성공! [실행 요청 도구: ${toolName}]`);

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    await client.close();
    return JSON.stringify(result);
  } catch (error) {
    console.error('MCP 도구 실행 에러:', error);
    if (transport) {
      try { await transport.close(); } catch (_) {}
    }
    return null;
  }
}

export async function POST(req: Request) {
  try {
    // 1. 프론트엔드로부터 useMcp 토글 상태 수신
    const { message, reasoningEffort, model, useMcp } = await req.json();
    const selectedModel = model || '빠른 모델 플러스';

    const SAMIGPT_API_URL = process.env.SAMIGPT_API_URL || 'https://gpt.samitech.kr/api/llm';
    const SAMIGPT_API_KEY =
      process.env.SAMIGPT_API_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaGVjayI6ZmFsc2UsInVzZXJuYW1lIjoiZ3lmdWQ1MjE2IiwiZXhwIjo0OTQyOTQ1NzIxfQ.gGr6plsCOZkz-3FociJUsPSjH8E2SnGWPf6q0M8AY84';
    const USER_COOKIE =
      process.env.USER_COOKIE ||
      '__Host-next-auth.csrf-token-gpt=db7ee97142721316dcdd2e2e3015282f29289e14f3b4dc8125cbea74a818ad91%7C27a14d937d24e3890abe56455c4206cae332e895e2b251e9d55aae63adc8be38; __Secure-next-auth.callback-url-gpt=http%3A%2F%2Flocalhost%3A3000; __Secure-next-auth.session-token-gpt=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..QoP6GSzrpFrpIyCi.STcMukaN7-I06BZc9ZdNQNaPUruL1fi1sQHjWpedVUiUgKv-tzwarqzLMDeD3s6Sk11VFVqjNNsiSXU2XwRySKZzSm_pjKrXJZuy3yFiUCK_DPRnd4VNxi2Ytj8HRMBXsJXZOX1XbbNjUkKdmwu6K6f37xK2XUeQHYPrY9k-4Tj7ACIaHUdBHrjI2dXRTnHi2dOecm_WL5WdaUh0VJkOiE4g4CZDbNad_WXNaIL_-LDMu9BY8Vw1kzkHncXpSyYG6JDz5XIC-RnklKl0fe-ATDFuEs3BiwSqllq9AsuDNenDAaieep39tO6wdxUFDP6KdT57uxX3-jsYE23cjyHsvZ4d_PYvVkgJlJdqbS--I2_MUwpTLTnDm9UxtGzpLAmpi-8jn5cEZKiTLL7RHphVjPG32mTP7nIxIprD2ujcRGvd5jfBewSkaPsN8tBTEXZXnM6G8aFzz1X-n28gPoQzK1ymrP0bX81KablBvqy0CY9jlcq5q_6Vqy1SeP7mw50Qji76abBaIXaZTve98okvU8XlrCG4tnmE1dxOMxRJPT8r8evlBY0j5BNbiDXQzNGjUJ17wayTaVhmczYON9p6dFTO0bHiXrG7DUXvT3LzgwDHnnZe4uD8_shdl83QyDlFuT50rhB5AnjVwUEnscf8NJjtFEsqAibpUiaOmZPYdag5ubRVnS_eXWfYWA9IsiHbPnS5ntbYcw_sPKHc3o0hjU_RZHbWoZVBM_d0OeTvsBTgRUiyZPNBUnPlsDsrTKAbY4k_NTApwd9ZXF3ACtW7njaSah32qzzxPA3G5p3ywbRkyNofwrodLArdg3yj6X9BWNM.2j3992k0toJ6Nhrcts5xXQ';

    const requestHeaders = {
      Accept: 'text/event-stream, application/json, */*',
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${SAMIGPT_API_KEY}`,
      Cookie: USER_COOKIE,
      'Chat-Session-Id': 'flove-main-94d5bae8a409cd2baec4a61144f857f3',
      Organization: 'sami',
      'X-Organization-Code': 'sami',
    };

    // 2. useMcp 상태에 따라 동적으로 구성되는 systemPrompt
    const systemPrompt = useMcp
      ? `
너는 오직 JSON만 출력하는 도구 판단 시스템이다. 절대로 질문에 대한 답변이나 안내 문구를 작성하지 마라.

사용 가능한 도구:
- fetch_web_page(url: string): 웹페이지의 URL(http:// 또는 https://)을 읽어서 텍스트 데이터를 반환함
- mcp_echo(message: string): [MCP 도구] 입력받은 텍스트를 MCP 프로토콜로 에코 반환함

규칙:
1. 사용자의 질문에 실제 웹 URL(http:// 또는 https://)이 포함되어 있거나 특정 웹사이트 접속이 필요하면:
{"tool": "fetch_web_page", "url": "추출한URL"}

2. 만약 MCP 테스트/에코 요청이면:
{"tool": "mcp_echo", "message": "사용자메시지"}

3. 위 조건에 해당하지 않는 모든 질문은 무조건 단 한 단어만 출력해:
NONE
`
      : `
너는 오직 JSON만 출력하는 도구 판단 시스템이다. 절대로 질문에 대한 답변이나 안내 문구를 작성하지 마라.

사용 가능한 도구:
- fetch_web_page(url: string): 웹페이지의 URL을 읽어서 텍스트 데이터를 반환함

규칙:
1. 사용자의 질문에 실제 웹 URL(http:// 또는 https://)이 직접 작성되어 있을 때만 pure JSON으로 응답해:
{"tool": "fetch_web_page", "url": "추출한URL"}

2. "MCP", "에코", "테스트" 등의 단어가 있더라도 URL이 직접 제시되지 않았다면 절대로 웹 페치를 실행하지 말고 무조건 단 한 단어만 출력해:
NONE
`;

    const checkResponse = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        reasoning_effort: reasoningEffort || 'medium',
        temperature: 0,
        stream: false,
        org_code: 'sami',
        organization: 'sami',
      }),
    });

    let externalData = '';
    if (checkResponse.ok) {
      const checkData = await checkResponse.json();
      const resultText = checkData.choices?.[0]?.message?.content?.trim() || '';

      console.log('🤖 도구 판단 에이전트 응답:', resultText);

      try {
        if (resultText.includes('{')) {
          const parsed = JSON.parse(resultText);

          // 1) 웹 페치 실행 (Tool Calling)
          if (parsed.tool === 'fetch_web_page' && parsed.url) {
            console.log('🌐 [Tool Calling] 웹 페치 진행 중... URL:', parsed.url);
            externalData = await fetchWebPage(parsed.url);
          }

          // 2) MCP 도구 실행 (토글이 ON일 때만 진행)
          else if (parsed.tool === 'mcp_echo' && useMcp) {
            console.log('🔌 [MCP] 외부 MCP 서버에 echo 도구 실행 위임...');
            const mcpRes = await callMcpTool('echo', { message: parsed.message || message });
            if (mcpRes) externalData = mcpRes;
          }
        }
      } catch (e) {
        console.error('도구 응답 파싱 에러:', e);
      }
    }

    // 3. 최종 대화 스트리밍 요청
    const finalMessages = [
      {
        role: 'system',
        content: `너는 친절하고 유용한 AI 비서이다. 외부 데이터(웹 페치 또는 MCP 도구 결과)가 제공되면 그 내용을 바탕으로 사용자의 질문에 명확하게 답변해라.`,
      },
    ];

    if (externalData) {
      finalMessages.push({
        role: 'system',
        content: `다음은 수집된 외부 데이터이다:\n${externalData}`,
      });
    }

    finalMessages.push({ role: 'user', content: message });

    const streamResponse = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: selectedModel,
        messages: finalMessages,
        reasoning_effort: reasoningEffort || 'medium',
        temperature: 0.7,
        stream: true,
        org_code: 'sami',
        organization: 'sami',
      }),
    });

    if (!streamResponse.ok) {
      const errorText = await streamResponse.text();
      console.error('사미GPT 응답 에러:', streamResponse.status, errorText);
      return NextResponse.json(
        { error: `사미GPT API 오류 (${streamResponse.status})` },
        { status: streamResponse.status }
      );
    }

    if (!streamResponse.body) {
      return NextResponse.json({ error: 'No response body' }, { status: 500 });
    }

    return createSSEStreamResponse(streamResponse.body);
  } catch (error) {
    console.error('백엔드 연동 에러:', error);
    return NextResponse.json({ error: '서버 내부 통신 실패' }, { status: 500 });
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

            if (parsed.error) {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    content: `[오류: ${parsed.error.message || 'API 오류'}]`,
                  }) + '\n'
                )
              );
              continue;
            }

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
          } catch (e) {
            // JSON 파싱 무시
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