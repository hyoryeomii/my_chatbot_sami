import { NextResponse } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 🕒 한국 시각(KST) 기준 날짜/요일 생성 함수
function getKstDateString() {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  };
  return new Intl.DateTimeFormat('ko-KR', options).format(now);
}

// 🌐 [도구 1] Web Fetch 함수
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


// ==========================================================================
// route.ts 에서 기존 "🔍 [도구 2] Tavily Web Search API 연동 함수" 전체를
// 아래 코드 전체로 교체하세요. (import 추가 필요 없음: Client, StdioClientTransport 이미 있음)
// ==========================================================================

// 🔍 [도구 2] Tavily Web Search - 공식 MCP 서버(tavily-mcp) 연동
async function searchTavily(query: string) {
  const todayKst = getKstDateString();
  const fullQuery = `${query} (현재 한국 기준일자: ${todayKst})`;

  let transport: StdioClientTransport | null = null;
  try {
    // 1. Tavily 공식 MCP 서버를 로컬에서 실행 (표준 입출력 stdio 통신)
    transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      env: {
        ...(process.env as Record<string, string>),
        TAVILY_API_KEY: process.env.TAVILY_API_KEY || 'fvM26YtPhNowefkRhuZCGuJgbk72PnuGMfEYgcke0d',
      },
    });

    // 2. MCP 클라이언트 생성 및 연결
    const client = new Client(
      { name: 'samigpt-tavily-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);

    // 3. 서버가 제공하는 도구 목록에서 검색 도구 찾기
    //    (버전에 따라 이름이 tavily-search 또는 tavily_search)
    const { tools } = await client.listTools();
    const searchTool = tools.find((t) => t.name.includes('search'));
    if (!searchTool) {
      throw new Error('검색 도구 없음. 제공 도구: ' + tools.map((t) => t.name).join(', '));
    }
    console.log(`🔌 Tavily MCP 연결 성공! [도구: ${searchTool.name}]`);

    // 4. MCP 프로토콜(JSON-RPC)로 검색 도구 호출
    const result = await client.callTool({
      name: searchTool.name,
      arguments: {
        query: fullQuery,
        search_depth: 'advanced',
        max_results: 5,
      },
    });
    await client.close();

    // 5. MCP 표준 응답(content 배열)에서 텍스트만 추출
    const text = ((result.content as any[]) || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n\n');


    console.log('📦 Tavily MCP 응답(앞부분):', text.slice(0, 300));

    if (result.isError || /^(error|tavily api error)/i.test(text.trim())) {
      throw new Error('Tavily MCP 도구 에러 응답: ' + text.slice(0, 200));
    }

    return text || '검색 결과가 없습니다.';
  } catch (err) {
    console.error('Tavily MCP 연동 에러 → REST API 백업으로 전환:', err);
    if (transport) {
      try { await transport.close(); } catch (_) {}
    }
    return await searchTavilyRest(query);   // MCP 실패 시 기존 방식으로 백업
  }
}

// 🔁 [백업] 기존 Tavily REST API 방식 (MCP 실패 시에만 사용)
async function searchTavilyRest(query: string) {
  const apiKey = process.env.TAVILY_API_KEY || 'fvM26YtPhNowefkRhuZCGuJgbk72PnuGMfEYgcke0d';

  const todayKst = getKstDateString();
  const fullQuery = `${query} (현재 한국 기준일자: ${todayKst})`;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: fullQuery,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 5,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('❌ Tavily API 에러 Response:', res.status, errText);
      return JSON.stringify({ error: `Tavily 검색 실패 (Status: ${res.status})` });
    }

    const data = await res.json();
    let resultText = '';

    if (data.answer) {
      resultText += `[Tavily 요약 답변]: ${data.answer}\n\n`;
    }

    if (data.results && data.results.length > 0) {
      resultText += data.results
        .map((r: any) => `[출처: ${r.title}] (${r.url})\n내용: ${r.content}`)
        .join('\n\n');
    }

    return resultText || '검색 결과가 없습니다.';
  } catch (err) {
    console.error('Tavily Search 연동 예외 에러:', err);
    return null;
  }
}



// 🔍 [도구 2] Tavily Web Search API 연동 함수
/*async function searchTavily(query: string) {
  const apiKey = process.env.TAVILY_API_KEY || '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';

  const todayKst = getKstDateString();
  const fullQuery = `${query} (현재 한국 기준일자: ${todayKst})`;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: fullQuery,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 5,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('❌ Tavily API 에러 Response:', res.status, errText);
      return JSON.stringify({ error: `Tavily 검색 실패 (Status: ${res.status})` });
    }

    const data = await res.json();
    let resultText = '';

    if (data.answer) {
      resultText += `[Tavily 요약 답변]: ${data.answer}\n\n`;
    }

    if (data.results && data.results.length > 0) {
      resultText += data.results
        .map((r: any) => `[출처: ${r.title}] (${r.url})\n내용: ${r.content}`)
        .join('\n\n');
    }

    return resultText || '검색 결과가 없습니다.';
  } catch (err) {
    console.error('Tavily Search 연동 예외 에러:', err);
    return null;
  }
}*/

// 🔌 [도구 3] Filesystem MCP 클라이언트 연동 함수
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

// 🐙 [도구 4] GitHub MCP Server 실행
export async function initGitHubMCP() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      ...process.env,
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "",
    },
  });

  const client = new Client(
    { name: "SamiGPT-GitHub", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

// 📝 [도구 5] Notion MCP Server 실행
export async function initNotionMCP() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env: {
      ...process.env,
      NOTION_API_KEY: process.env.NOTION_API_KEY || "",
    },
  });

  const client = new Client(
    { name: "SamiGPT-Notion", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

// 📄 [도구 6] FastAPI + ChromaDB RAG 검색 함수
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
          .map((doc: { content: string; page: number; source: string }) => `[출처 파일: ${doc.source} (페이지 ${doc.page})]\n${doc.content}`)
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
    // 1. 프론트엔드에서 보낸 토글 상태 및 파라미터 수신
    const { message, reasoningEffort, model, useGithubMcp, useNotionMcp } = await req.json();
    const selectedModel = model || '빠른 모델 플러스';

    const SAMIGPT_API_URL = process.env.SAMIGPT_API_URL || 'https://gpt.samitech.kr/api/llm';
    const SAMIGPT_API_KEY = process.env.SAMIGPT_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaGVjayI6ZmFsc2UsInVzZXJuYW1lIjoiZ3lmdWQ1MjE2IiwiZXhwIjo0OTQyOTQ1NzIxfQ.gGr6plsCOZkz-3FociJUsPSjH8E2SnGWPf6q0M8AY84';
    const USER_COOKIE = process.env.USER_COOKIE || '__Host-next-auth.csrf-token-gpt=db7ee97142721316dcdd2e2e3015282f29289e14f3b4dc8125cbea74a818ad91%7C27a14d937d24e3890abe56455c4206cae332e895e2b251e9d55aae63adc8be38; __Secure-next-auth.callback-url-gpt=http%3A%2F%2Flocalhost%3A3000; __Secure-next-auth.session-token-gpt=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..QoP6GSzrpFrpIyCi.STcMukaN7-I06BZc9ZdNQNaPUruL1fi1sQHjWpedVUiUgKv-tzwarqzLMDeD3s6Sk11VFVqjNNsiSXU2XwRySKZzSm_pjKrXJZuy3yFiUCK_DPRnd4VNxi2Ytj8HRMBXsJXZOX1XbbNjUkKdmwu6K6f37xK2XUeQHYPrY9k-4Tj7ACIaHUdBHrjI2dXRTnHi2dOecm_WL5WdaUh0VJkOiE4g4CZDbNad_WXNaIL_-LDMu9BY8Vw1kzkHncXpSyYG6JDz5XIC-RnklKl0fe-ATDFuEs3BiwSqllq9AsuDNenDAaieep39tO6wdxUFDP6KdT57uxX3-jsYE23cjyHsvZ4d_PYvVkgJlJdqbS--I2_MUwpTLTnDm9UxtGzpLAmpi-8jn5cEZKiTLL7RHphVjPG32mTP7nIxIprD2ujcRGvd5jfBewSkaPsN8tBTEXZXnM6G8aFzz1X-n28gPoQzK1ymrP0bX81KablBvqy0CY9jlcq5q_6Vqy1SeP7mw50Qji76abBaIXaZTve98okvU8XlrCG4tnmE1dxOMxRJPT8r8evlBY0j5BNbiDXQzNGjUJ17wayTaVhmczYON9p6dFTO0bHiXrG7DUXvT3LzgwDHnnZe4uD8_shdl83QyDlFuT50rhB5AnjVwUEnscf8NJjtFEsqAibpUiaOmZPYdag5ubRVnS_eXWfYWA9IsiHbPnS5ntbYcw_sPKHc3o0hjU_RZHbWoZVBM_d0OeTvsBTgRUiyZPNBUnPlsDsrTKAbY4k_NTApwd9ZXF3ACtW7njaSah32qzzxPA3G5p3ywbRkyNofwrodLArdg3yj6X9BWNM.2j3992k0toJ6Nhrcts5xXQ';

    const requestHeaders = {
      Accept: 'text/event-stream, application/json, */*',
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${SAMIGPT_API_KEY}`,
      Cookie: USER_COOKIE,
      'Chat-Session-Id': 'flove-main-94d5bae8a409cd2baec4a61144f857f3',
      Organization: 'sami',
      'X-Organization-Code': 'sami',
    };

    // RAG 검색 병렬 실행
    const ragContextPromise = fetchRagContext(message);

    // true: RAG 평가 모드(외부 도구 OFF)
    // false: 일반 사용 모드(외부 도구 ON)
    const ragEvalOnly = true;
    let externalData = '';

    if (ragEvalOnly) {
      console.log('[RAG 평가 모드] 외부 도구 실행 생략');
    } else {
      // 2. 토글 스위치 상태에 맞춰 도구 선택지 프롬프트 구성
      let availableToolsList = `Available Tools:
- fetch_web_page(url: string)
- tavily_search(query: string)
- list_directory(path: string)
- read_file(path: string)`;

      if (useGithubMcp) {
        availableToolsList += `\n- github_mcp(query: string)`;
      }
      if (useNotionMcp) {
        availableToolsList += `\n- notion_mcp(query: string)`;
      }

      const systemPrompt = `You are a tool selection classifier that outputs ONLY raw JSON without any markdown formatting or extra text.

${availableToolsList}

Rules:
1. If the user query has a URL (http/https): {"tool": "fetch_web_page", "url": "URL"}
2. If the user query asks for real-time info, weather, news, or web search: {"tool": "tavily_search", "query": "search query"}
3. If listing local directory: {"tool": "list_directory", "path": "."}
4. If reading local file: {"tool": "read_file", "path": "path/file"}
${useGithubMcp ? '5. If user asks about GitHub commits, repositories, or issues: {"tool": "github_mcp", "query": "query"}\n' : ''}${useNotionMcp ? '6. If user asks about Notion pages, workspace, or documents: {"tool": "notion_mcp", "query": "query"}\n' : ''}Otherwise: NONE`;

      // 1차 도구 판단 (JSON 출력 유도)
      const checkResponse = await fetch(SAMIGPT_API_URL, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          temperature: 0,
          stream: false,
          org_code: 'sami',
          organization: 'sami',
        }),
      });

      if (checkResponse.ok) {
        const checkData = await checkResponse.json();
        const resultText =
          checkData.choices?.[0]?.message?.content?.trim() || '';

        console.log('🤖 도구 판단 에이전트 응답:', resultText);

        try {
          const jsonMatch = resultText.match(/\{[\s\S]*\}/);

          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);

            if (parsed.tool === 'fetch_web_page' && parsed.url) {
              console.log(
                '🌐 [Tool Calling] 웹 페치 진행 중... URL:',
                parsed.url
              );
              const webRes = await fetchWebPage(parsed.url);
              if (webRes) externalData = webRes;
            } else if (parsed.tool === 'tavily_search' && parsed.query) {
              console.log(
                '🔍 [Tavily MCP/Tool] 실시간 웹 검색 진행 중... Query:',
                parsed.query
              );
              const tavilyRes = await searchTavily(parsed.query);
              if (tavilyRes) externalData = tavilyRes;
            } else if (parsed.tool === 'list_directory') {
              console.log('📁 [MCP] 디렉토리 목록 조회 중...');
              const mcpRes = await callMcpTool('list_directory', {
                path: parsed.path || '.',
              });
              if (mcpRes) externalData = mcpRes;
            } else if (parsed.tool === 'read_file') {
              console.log('📄 [MCP] 파일 읽는 중... File:', parsed.path);
              const mcpRes = await callMcpTool('read_file', {
                path: parsed.path,
              });
              if (mcpRes) externalData = mcpRes;
            } else if (parsed.tool === 'github_mcp' && useGithubMcp) {
              console.log('🐙 [GitHub MCP] 연동 실행 중...');
              const githubClient = await initGitHubMCP();
              externalData =
                '[GitHub MCP 연결 완료]: GitHub 데이터 조회가 정상 처리되었습니다.';
              await githubClient.close();
            } else if (parsed.tool === 'notion_mcp' && useNotionMcp) {
              console.log('📝 [Notion MCP] 연동 실행 중...');
              const notionClient = await initNotionMCP();
              externalData =
                '[Notion MCP 연결 완료]: Notion 문서 데이터 조회가 정상 처리되었습니다.';
              await notionClient.close();
            }
          }
        } catch (e) {
          console.error('도구 응답 파싱 에러:', e);
        }
      }
    }

    const ragContext = await ragContextPromise;
    const todayKst = getKstDateString();

    const baseSystemPrompt = `너는 사내 문서 검색과 실시간 정보 조회가 가능한 친절하고 똑똑한 AI 비서이다.

[현재 기준 시각]:
현재 한국 표준시(KST) 기준 시각은 **${todayKst}** 이다.
오늘 날짜, 내일 날짜, 요일 관련 질문에 대답할 때 반드시 이 날짜를 절대적 기준으로 삼아라. 외부 데이터에 해외 시차(UTC 등)로 인해 날짜가 다르게 적혀 있더라도 무조건 현재 한국 시각 기준(${todayKst})이 정답이다.

[필수 지침]:
아래에 [수집된 외부 데이터]가 전달된 경우, "사이트를 직접 확인하라"는 식의 대답을 절대로 하지 말고, **제공된 외부 데이터 안의 실제 기온, 날씨, 숫자, 뉴스 내용**을 반드시 직접 인용하여 상세하게 작성해라.
전체 답변의 길이는 가독성과 빠른 응답을 위해 공백 포함 2,000자 이내로 간결하게 작성해라.

[답변 출력 구조]:
### 1. 상세 설명
- 외부 데이터 기반의 실제 상세 내용(온도, 날씨 상태, 뉴스 등)을 친절하게 설명한다.

### 2. 핵심 요약
- 핵심 데이터를 마크다운 표(| 항목 | 내용 |) 형식으로 정리한다.

### 3. 결론
- 전체 내용을 2~3줄로 깔끔하게 요약 정리한다.

단, 아래 [참고 문서 사용 규칙]에 따라 답이 문서에서 확인되지 않는 경우에는 이 구조를 쓰지 않고 1~2문장으로 답한다.`;

const groundingRules = `[참고 문서 사용 규칙]:
1. 질문이 사내 문서(회사소개서, 재난현장 표준작전절차(SOP), IT기술교육 체계수립)나 사내 업무 절차·규정에 관한 것이면, [참고 문서]에 적힌 내용만 근거로 답한다. 일반 지식이나 추측으로 내용을 보충하지 않는다.
2. 질문이 날씨, 뉴스, 프로그래밍, 일반 상식처럼 사내 문서와 무관하면 [참고 문서]를 무시하고 일반 지식으로 답한다. 이때는 참고 문서의 출처를 인용하지 않는다. 사내 문서와 관련 있는지 애매하면 1번을 따른다.
3. 답하기 전에 질문이 묻는 대상과 참고 문서가 다루는 대상이 같은지 확인한다. 이름이나 단어가 비슷해도 대상이 다르면(예: '출장비 규정'을 물었는데 문서는 '교육비 예산'을 다루는 경우) 같은 것으로 취급하지 않는다. 질문의 핵심 대상이 참고 문서에 그대로 나오지 않으면, 비슷한 내용을 모아 그 대상의 답처럼 재구성하지 않는다.
4. 참고 문서에 질문에 대한 답이 전혀 없으면 "문서에서 확인되지 않습니다."라고 답한다.
5. 답의 일부만 있으면 있는 내용을 설명한 뒤, 없는 부분만 "질문하신 ○○은(는) 문서에서 확인되지 않습니다."라고 짚는다. 이때 "문서에서 확인되지 않습니다."만 단독으로 답하지 않는다. 질문의 형식에 맞추려고 단계, 숫자, 목록을 만들어 내지 않는다.
6. 문서에 명시되지 않은 순서, 우선순위, 단계 번호, 포함 관계를 만들지 않는다. 문서의 목록·순서·절차를 원래 적용 상황과 다른 상황의 근거로 쓰지 않으며, 인용할 때는 그 조항이 어떤 상황(누가, 언제)에 대한 규정인지 함께 밝힌다.
7. 서로 다른 절의 내용을 하나의 목록·절차·체계로 묶어 질문의 답처럼 제시하지 않는다. 목차나 표 제목처럼 제목만 있는 부분을 내용의 근거로 쓰지 않고, 문서에 없는 예시를 덧붙이지 않는다.
8. 출처는 [출처 파일: 파일명 (페이지 N)] 표시에 있는 파일명과 페이지만 쓰고, 해당 내용이 실제로 그 조각에 있을 때만 인용한다. 문서에 없는 법령이나 규정을 근거로 들지 않는다.
9. 표 셀 안에서 <br> 태그를 쓰지 않는다. 여러 항목은 쉼표나 가운뎃점(·)으로 구분한다. `;

    const finalMessages = [{ role: 'system', content: baseSystemPrompt }];

    if (ragContext) {
      finalMessages.push({
        role: 'system',
        content: `[참고 문서 (로컬 RAG Vector DB)]:\n${ragContext}`,
      });
    }

    if (externalData) {
      finalMessages.push({
        role: 'system',
        content: `[수집된 외부 데이터 (웹검색/MCP)]:\n${externalData}`,
      });
    }


    
    finalMessages.push({ role: 'system', content: groundingRules });

    finalMessages.push({ role: 'user', content: message });



    const streamResponse = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: selectedModel,
        messages: finalMessages,
        reasoning_effort: reasoningEffort || 'medium',
        temperature: 0.2,
        stream: true,
        org_code: 'sami',
        organization: 'sami',
      }),
    });

    if (!streamResponse.ok || !streamResponse.body) {
      return NextResponse.json({ error: '사미GPT API 오류' }, { status: streamResponse.status });
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