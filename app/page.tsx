'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useMcp, setUseMcp] = useState(true);
  const [targetPath, setTargetPath] = useState(''); // 📂 동적 MCP 허용 경로 상태
  const [selectedModel, setSelectedModel] = useState('빠른 모델 플러스');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // AI 응답 임시 생성
    setMessages((prev) => [...prev, { role: 'assistant', content: '', reasoning: '' }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          useMcp,
          targetPath, // 👈 프론트엔드에서 입력된 동적 경로 전달
          model: selectedModel,
        }),
      });

      if (!response.ok) throw new Error('API 요청 실패');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      let assistantContent = '';
      let assistantReasoning = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.reasoning) assistantReasoning += data.reasoning;
            if (data.content) assistantContent += data.content;

            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                last.content = assistantContent;
                last.reasoning = assistantReasoning;
              }
              return updated;
            });
          } catch (err) {
            // JSON 파싱 실패 무시
          }
        }
      }
    } catch (error) {
      console.error('에러 발생:', error);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: '죄송합니다. 오류가 발생했습니다.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex flex-col h-screen max-w-4xl mx-auto p-4 font-sans">
      {/* 상단 컨트롤 바 */}
      <header className="flex flex-wrap items-center justify-between gap-4 p-4 mb-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-gray-700">모델 선택:</label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="p-2 border border-gray-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="빠른 모델">빠른 모델</option>
            <option value="빠른 모델 플러스">빠른 모델 플러스</option>
            <option value="기본 모델 플러스">기본 모델 플러스</option>
            <option value="생각하는 모델 플러스">생각하는 모델 플러스</option>
          </select>
        </div>

        {/* MCP 설정 영역 */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">MCP 연동</span>
            <button
              type="button"
              onClick={() => setUseMcp(!useMcp)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                useMcp ? 'bg-pink-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  useMcp ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* MCP 경로 입력창 (MCP 연동이 켜졌을 때만 표시) */}
          {useMcp && (
            <input
              type="text"
              placeholder="허용할 절대경로 (비워두면 프로젝트 폴더)"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              className="p-2 text-xs border border-gray-300 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
          )}
        </div>
      </header>

      {/* 메시지 채팅 영역 */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4 border border-gray-200 rounded-xl bg-white mb-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[80%] p-4 rounded-2xl ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-gray-100 text-gray-800 rounded-bl-none'
              }`}
            >
              {msg.reasoning && (
                <details className="mb-2 text-xs text-gray-500 border-b border-gray-200 pb-2" open>
                  <summary className="cursor-pointer font-semibold mb-1">추론 과정</summary>
                  <p className="whitespace-pre-wrap">{msg.reasoning}</p>
                </details>
              )}
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력 폼 */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            useMcp
              ? "질문하거나 파일/폴더 조회를 요청해보세요 (예: 프로젝트 파일 목록 알려줘)"
              : "질문이나 웹 URL을 입력하세요..."
          }
          disabled={isLoading}
          className="flex-1 p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
        >
          {isLoading ? '생성 중...' : '전송'}
        </button>
      </form>
    </main>
  );
}