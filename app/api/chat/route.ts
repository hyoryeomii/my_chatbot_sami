import { NextResponse } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 🌐 [도구 1] 웹 페치(Web Fetch) 함수
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

// 🔌 [도구 2] Filesystem MCP 클라이언트 연동 함수
async function callMcpTool(toolName: string, args: Record<string, any>) {
  let transport: StdioClientTransport | null = null;
  try {
    const allowedPath = process.cwd();

    transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', allowedPath],
    });

    const client = new Client(
      { name: 'samigpt-filesystem-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    console.log(`🔌 Filesystem MCP 연결 성공! [도구: ${toolName}]`);

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

// 📄 [도구 3] FastAPI + ChromaDB RAG 검색 함수
async function fetchRagContext(userQuery: string) {
  try {
    const ragRes = await fetch('http://127.0.0.1:8000/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: userQuery }),
    });

    if (ragRes.ok) {
      const data = await ragRes.json();
      if (data.results && data.results.length > 0) {
        return data.results
          .map((doc: { content: string; page: number }) => `[사미텍 회사소개서 ${doc.page}페이지]\n${doc.content}`)
          .join('\n\n');
      }
    }
  } catch (err) {
    console.warn('FastAPI RAG 백엔드 연결 안 됨 (일반 대화 모드로 지속):', err);
  }
  return '';
}

export async function POST(req: Request) {
  try {
    // 1. 프론트엔드 데이터 수신
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

    // 2. [RAG 검색 병렬 실행] ChromaDB 검색
    const ragContextPromise = fetchRagContext(message);

    // 3. 도구(MCP / Tool Calling) 필요 여부 판단 systemPrompt
    const systemPrompt = useMcp
      ? `
너는 오직 JSON만 출력하는 도구 판단 시스템이다. 절대로 질문에 대한 답변이나 안내 문구를 작성하지 마라.

사용 가능한 도구:
- fetch_web_page(url: string): 웹페이지의 URL을 읽어서 텍스트 데이터를 반환함
- list_directory(path: string): 지정된 디렉토리 내 파일 및 폴더 목록을 조회함 (기본값: ".")
- read_file(path: string): 지정된 파일의 내용을 읽어옴

규칙:
1. 사용자의 질문에 실제 웹 URL(http:// 또는 https://)이 포함되어 있으면:
{"tool": "fetch_web_page", "url": "추출한URL"}

2. 파일 목록 조회/폴더 확인 요청이면:
{"tool": "list_directory", "path": "."}

3. 특정 파일 내용 읽기 요청이면:
{"tool": "read_file", "path": "상대경로/파일명"}

4. 그 외 일반 질문은 무조건 단 한 단어만 출력해:
NONE
`
      : `
너는 오직 JSON만 출력하는 도구 판단 시스템이다. 절대로 질문에 대한 답변이나 안내 문구를 작성하지 마라.

사용 가능한 도구:
- fetch_web_page(url: string): 웹페이지의 URL을 읽어서 텍스트 데이터를 반환함

규칙:
1. 사용자의 질문에 실제 웹 URL(http:// 또는 https://)이 포함되어 있을 때만 pure JSON으로 응답해:
{"tool": "fetch_web_page", "url": "추출한URL"}

2. 위 조건에 해당하지 않거나 파일/MCP 관련 질문이라도 URL이 없으면 무조건 단 한 단어만 출력해:
NONE
`;

    // 4. 도구 판단 에이전트 요청
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

          if (parsed.tool === 'fetch_web_page' && parsed.url) {
            console.log('🌐 [Tool Calling] 웹 페치 진행 중... URL:', parsed.url);
            externalData = await fetchWebPage(parsed.url);
          } else if (parsed.tool === 'list_directory' && useMcp) {
            console.log('📁 [MCP] 디렉토리 목록 조회 중...');
            const mcpRes = await callMcpTool('list_directory', { path: parsed.path || '.' });
            if (mcpRes) externalData = mcpRes;
          } else if (parsed.tool === 'read_file' && useMcp) {
            console.log('📄 [MCP] 파일 읽는 중... File:', parsed.path);
            const mcpRes = await callMcpTool('read_file', { path: parsed.path });
            if (mcpRes) externalData = mcpRes;
          }
        }
      } catch (e) {
        console.error('도구 응답 파싱 에러:', e);
      }
    }

    // RAG 문맥 수집 완료 기다림
    const ragContext = await ragContextPromise;

    // 5. RAG 문맥 + 도구 결과 데이터를 결합해 최종 대화 메시지 작성
    const finalMessages = [
      {
        role: 'system',
        content: `너는 친절하고 똑똑한 AI 비서이다. 제공된 참고 문서(사미텍 회사소개서) 및 외부 수집 데이터(MCP/웹데이터)가 있다면 이를 바탕으로 자연스럽고 명확하게 답변해라. 관련 정보가 부족하면 일반적인 유용한 답변을 작성해라.`,
      },
    ];

    if (ragContext) {
      finalMessages.push({
        role: 'system',
        content: `[참고 문서 (사미텍 회사소개서 DB)]:\n${ragContext}`,
      });
    }

    if (externalData) {
      finalMessages.push({
        role: 'system',
        content: `[수집된 외부 데이터 (MCP/웹페치)]:\n${externalData}`,
      });
    }

    finalMessages.push({ role: 'user', content: message });

    // 6. SAMI-GPT API로 최종 스트리밍 응답 요청
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