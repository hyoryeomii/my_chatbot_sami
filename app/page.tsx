'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  reasoningEffort: string;
}

export default function Home() {
  const [input, setInput] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState('medium');
  const [loading, setLoading] = useState(false);
  const [showThinking, setShowThinking] = useState<{ [key: number]: boolean }>({});
  
  // 사이드바 토글 상태 (열림/닫힘)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 대화 목록 및 세션 관리
  const [sessions, setSessions] = useState<ChatSession[]>([
    {
      id: 'session-1',
      title: '새 대화',
      messages: [],
      reasoningEffort: 'medium',
    },
  ]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('session-1');

  // 메인 스크롤 컨테이너 참조
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find((s) => s.id === currentSessionId) || sessions[0];
  const messages = currentSession ? currentSession.messages : [];

  // 부드러운 스크롤 (오른쪽 스크롤바 기준)
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, loading]);

  const updateCurrentSessionMessages = (
    newMessages: Message[] | ((prev: Message[]) => Message[])
  ) => {
    setSessions((prevSessions) =>
      prevSessions.map((session) => {
        if (session.id === currentSessionId) {
          const updatedMsgs =
            typeof newMessages === 'function' ? newMessages(session.messages) : newMessages;
          return { ...session, messages: updatedMsgs };
        }
        return session;
      })
    );
  };

  // LLM 제목 생성 API 호출 함수
  const fetchLLMTitle = async (sessionId: string, userPrompt: string) => {
    try {
      const res = await fetch('/api/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userPrompt }),
      });
      const data = await res.json();
      if (data.title) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: `💬 ${data.title}` } : s))
        );
      }
    } catch (e) {
      console.error('제목 생성 중 에러:', e);
    }
  };

  // 새 대화 시작하기 (중복 무한 생성 방지)
  const handleNewChat = () => {
    const emptySession = sessions.find((s) => s.messages.length === 0);
    if (emptySession) {
      setCurrentSessionId(emptySession.id);
      return;
    }

    const newId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: '새 대화',
      messages: [],
      reasoningEffort: reasoningEffort,
    };
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newId);
  };

  const toggleThinking = (index: number) => {
    setShowThinking((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];

    updateCurrentSessionMessages(newMessages);

    const currentInput = input;
    const isFirstMessage = messages.length === 0;
    const targetSessionId = currentSessionId;

    setInput('');
    setLoading(true);

    // 첫 메시지일 때 제목 생성 백그라운드 호출
    if (isFirstMessage) {
      fetchLLMTitle(targetSessionId, currentInput);
    }

    const assistantIndex = newMessages.length;
    updateCurrentSessionMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', reasoning: '' },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currentInput, reasoningEffort }),
      });

      if (!res.body) {
        const data = await res.json();
        updateCurrentSessionMessages((prev) => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: 'assistant',
            content: data.reply || data.content,
            reasoning: data.reasoning_content || '',
          };
          return updated;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const { reasoning, content } = JSON.parse(line);

            updateCurrentSessionMessages((prev) => {
              const updated = [...prev];
              const currentMsg = updated[assistantIndex];
              if (!currentMsg) return prev;

              updated[assistantIndex] = {
                ...currentMsg,
                reasoning: (currentMsg.reasoning || '') + (reasoning || ''),
                content: (currentMsg.content || '') + (content || ''),
              };
              return updated;
            });
          } catch (e) {
            console.error('JSON 파싱 에러:', e);
          }
        }
      }
    } catch (err) {
      console.error(err);
      updateCurrentSessionMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = {
          role: 'assistant',
          content: '오류가 발생했습니다. 다시 시도해주세요.',
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-white font-sans text-gray-800 antialiased overflow-hidden">
      {/* 🌸 1. 사이드바 */}
      <aside
        className={`${
          isSidebarOpen ? 'w-64' : 'w-0'
        } bg-pink-50/60 transition-all duration-300 ease-in-out flex flex-col border-r border-pink-100/50 overflow-hidden relative z-20 shrink-0`}
      >
        <div className="p-4 flex flex-col h-full w-64">
          <div className="flex items-center justify-between mb-5 px-1">
            <h1 className="text-xl font-bold text-gray-800 tracking-tight">SAMI-GPT</h1>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-1.5 rounded-lg hover:bg-pink-100/60 text-gray-600 transition"
              title="사이드바 닫기"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>

          <button
            onClick={handleNewChat}
            className="w-full bg-white hover:bg-pink-100/40 text-gray-700 font-medium py-2.5 px-4 rounded-xl shadow-xs transition border border-pink-200/60 flex items-center justify-center gap-2 mb-6 text-sm"
          >
            <span>+</span> 새 대화 시작하기
          </button>

          <div className="text-xs font-semibold text-gray-400 mb-2 px-1">이전 대화 목록</div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setCurrentSessionId(session.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm truncate transition ${
                  session.id === currentSessionId
                    ? 'bg-pink-100/80 font-semibold text-pink-950'
                    : 'text-gray-600 hover:bg-pink-100/40 hover:text-gray-900'
                }`}
              >
                {session.title || '새 대화'}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* 💬 2. 메인 채팅 영역 */}
      <main className="flex-1 flex flex-col h-screen bg-white relative overflow-hidden">
        {/* 상단 헤더 */}
        <header className="px-6 py-4 flex items-center justify-between bg-white shrink-0 z-10">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition"
                title="사이드바 열기"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">추론 강도:</span>
            <select
              value={reasoningEffort}
              onChange={(e) => setReasoningEffort(e.target.value)}
              className="text-xs border-0 rounded-lg px-3 py-1.5 bg-gray-50 font-medium text-gray-600 focus:outline-none focus:ring-1 focus:ring-pink-200 cursor-pointer"
            >
              <option value="low">Low (빠른 응답)</option>
              <option value="medium">Medium (기본 추론)</option>
              <option value="high">High (심층 추론)</option>
            </select>
          </div>
        </header>

        {/* 📜 스크롤 영역 */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 pt-4 pb-12 space-y-6">
            {messages.length === 0 && (
              <div className="h-[60vh] flex flex-col items-center justify-center text-gray-300 text-base">
                <p>궁금한 점을 자유롭게 입력해 주세요!</p>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className="flex flex-col space-y-2">
                {/* 내 메시지 */}
                {m.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="bg-pink-100/80 text-pink-950 px-4.5 py-3 rounded-2xl max-w-[80%] text-base leading-relaxed shadow-2xs whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  /* 사미GPT 답변 */
                  <div className="flex flex-col items-start pr-4 py-1 w-full">
                    {/* 생각 보기 (CoT) */}
                    {(m.reasoning || (loading && i === messages.length - 1)) && (
                      <div className="mb-3">
                        <button
                          onClick={() => toggleThinking(i)}
                          className="text-xs text-purple-600 font-medium bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg border border-purple-100 transition flex items-center gap-1.5"
                        >
                          🤖 {showThinking[i] ? '생각 접기' : '생각 보기'}
                        </button>

                        {showThinking[i] && (
                          <div className="mt-2 p-3 bg-gray-50 rounded-xl text-sm text-gray-500 italic leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto border border-gray-100">
                            {m.reasoning || '추론 과정을 정리하고 있습니다...'}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 마크다운 & 표 렌더링 */}
                    <div className="text-gray-800 text-base leading-relaxed w-full prose prose-base max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ node, ...props }) => (
                            <div className="overflow-x-auto my-3 border border-gray-100 rounded-lg">
                              <table className="min-w-full divide-y divide-gray-100 text-sm" {...props} />
                            </div>
                          ),
                          thead: ({ node, ...props }) => <thead className="bg-gray-50 text-gray-700 font-semibold" {...props} />,
                          th: ({ node, ...props }) => <th className="px-3.5 py-2.5 text-left" {...props} />,
                          td: ({ node, ...props }) => <td className="px-3.5 py-2.5 border-t border-gray-100 text-gray-600" {...props} />,
                          p: ({ node, ...props }) => <p className="mb-2.5 last:mb-0 leading-relaxed" {...props} />,
                          ul: ({ node, ...props }) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
                          ol: ({ node, ...props }) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* 로딩 표시 */}
            {loading && messages[messages.length - 1]?.content === '' && (
              <div className="text-gray-300 text-sm italic animate-pulse py-2">
                답변을 생각하고 있습니다...
              </div>
            )}
          </div>
        </div>

        {/* 하단 질문 입력 창 (Textarea 교체 및 Shift+Enter 처리) */}
        <div className="p-4 bg-white shrink-0">
          <div className="max-w-3xl mx-auto flex items-end gap-2 bg-gray-50 rounded-2xl p-2.5 border border-gray-100 focus-within:border-pink-200 focus-within:ring-2 focus-within:ring-pink-50 transition shadow-2xs">
            <textarea
              rows={1}
              value={input}
              disabled={loading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && e.shiftKey) {
                  return; // Shift+Enter: 줄바꿈 실행
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(); // Enter: 메시지 제출
                }
              }}
              className="flex-1 bg-transparent px-3 py-1.5 text-base text-gray-800 focus:outline-none disabled:opacity-50 resize-none max-h-32 overflow-y-auto"
              placeholder="메시지를 입력하세요... (Shift + Enter로 줄바꿈)"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="bg-pink-400 hover:bg-pink-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-base font-medium px-4 py-2 rounded-xl transition shadow-2xs shrink-0"
            >
              전송
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}