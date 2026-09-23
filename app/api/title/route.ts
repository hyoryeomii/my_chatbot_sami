import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    const SAMIGPT_API_URL = process.env.SAMIGPT_API_URL || 'https://gpt.samitech.kr/api/llm';
    const SAMIGPT_API_KEY = process.env.SAMIGPT_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaGVjayI6ZmFsc2UsInVzZXJuYW1lIjoiZ3lmdWQ1MjE2IiwiZXhwIjo0OTQyOTQ1NzIxfQ.gGr6plsCOZkz-3FociJUsPSjH8E2SnGWPf6q0M8AY84';
    const USER_COOKIE = process.env.USER_COOKIE || '__Host-next-auth.csrf-token-gpt=db7ee97142721316dcdd2e2e3015282f29289e14f3b4dc8125cbea74a818ad91%7C27a14d937d24e3890abe56455c4206cae332e895e2b251e9d55aae63adc8be38; __Secure-next-auth.callback-url-gpt=http%3A%2F%2Flocalhost%3A3000; __Secure-next-auth.session-token-gpt=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..QoP6GSzrpFrpIyCi.STcMukaN7-I06BZc9ZdNQNaPUruL1fi1sQHjWpedVUiUgKv-tzwarqzLMDeD3s6Sk11VFVqjNNsiSXU2XwRySKZzSm_pjKrXJZuy3yFiUCK_DPRnd4VNxi2Ytj8HRMBXsJXZOX1XbbNjUkKdmwu6K6f37xK2XUeQHYPrY9k-4Tj7ACIaHUdBHrjI2dXRTnHi2dOecm_WL5WdaUh0VJkOiE4g4CZDbNad_WXNaIL_-LDMu9BY8Vw1kzkHncXpSyYG6JDz5XIC-RnklKl0fe-ATDFuEs3BiwSqllq9AsuDNenDAaieep39tO6wdxUFDP6KdT57uxX3-jsYE23cjyHsvZ4d_PYvVkgJlJdqbS--I2_MUwpTLTnDm9UxtGzpLAmpi-8jn5cEZKiTLL7RHphVjPG32mTP7nIxIprD2ujcRGvd5jfBewSkaPsN8tBTEXZXnM6G8aFzz1X-n28gPoQzK1ymrP0bX81KablBvqy0CY9jlcq5q_6Vqy1SeP7mw50Qji76abBaIXaZTve98okvU8XlrCG4tnmE1dxOMxRJPT8r8evlBY0j5BNbiDXQzNGjUJ17wayTaVhmczYON9p6dFTO0bHiXrG7DUXvT3LzgwDHnnZe4uD8_shdl83QyDlFuT50rhB5AnjVwUEnscf8NJjtFEsqAibpUiaOmZPYdag5ubRVnS_eXWfYWA9IsiHbPnS5ntbYcw_sPKHc3o0hjU_RZHbWoZVBM_d0OeTvsBTgRUiyZPNBUnPlsDsrTKAbY4k_NTApwd9ZXF3ACtW7njaSah32qzzxPA3G5p3ywbRkyNofwrodLArdg3yj6X9BWNM.2j3992k0toJ6Nhrcts5xXQ';

    const response = await fetch(SAMIGPT_API_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${SAMIGPT_API_KEY}`,
        'Cookie': USER_COOKIE,
        'Organization': 'sami',
        'X-Organization-Code': 'sami',
      },
      body: JSON.stringify({
        model: "빠른 모델 플러스", 
        messages: [
          { 
            role: "user", 
            content: `다음 대화 내용의 요약 제목을 5자~10자 이내로 핵심만 간단히 작성해줘:\n\n"${message}"` 
          }
        ],
        stream: false,
        org_code: "sami",
        organization: "sami",
      }),
    });

    if (!response.ok) {
      console.warn('SAMIGPT 제목 생성 응답 실패 Status:', response.status);
      return NextResponse.json({ title: "새 대화" });
    }

    // 1. 응답을 일단 raw 텍스트로 가져옴
    const rawText = await response.text();
    let data: any = {};

    // 2. data: 프리픽스가 붙은 스트림 형태일 경우 감싸는 'data: ' 문자열 제거 후 파싱
    let cleanText = rawText.trim();
    if (cleanText.startsWith('data: ')) {
      cleanText = cleanText.replace(/^data:\s*/, '').replace(/\n$/, '');
    }

    try {
      data = JSON.parse(cleanText);
    } catch (e) {
      console.error('제목 JSON 파싱 실패, raw text:', rawText);
      return NextResponse.json({ title: "새 대화" });
    }

    const title = data.choices?.[0]?.message?.content?.trim() || "새 대화";

    return NextResponse.json({ title });
  } catch (error) {
    console.error('제목 생성 에러:', error);
    return NextResponse.json({ title: "새 대화" });
  }
}