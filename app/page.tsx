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
  selectedModel: string;
}

export default function Home() {
  const [input, setInput] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState('medium');
  const [selectedModel, setSelectedModel] = useState('빠른 모델 플러스');
  const [loading, setLoading] = useState(false);
  
  // 기본적으로 생각 박스가 열려있도록 상태 관리 (기본값 undefined/true 일 때 열림)
  const [thinkingCollapsed, setThinkingCollapsed] = useState<{ [key: number]: boolean }>({});
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [sessions, setSessions] = useState<ChatSession[]>([
    {
      id: 'session-1',
      title: '새 대화',
      messages: [],
      reasoningEffort: 'medium',
      selectedModel: '빠른 모델 플러스',
    },
  ]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('session-1');

  const chatContainerRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find((s) => s.id === currentSessionId) || sessions[0];
  const messages = currentSession ? currentSession.messages : [];

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
      selectedModel: selectedModel,
    };
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newId);
  };

  // 접기/펼치기 토글 함수
  const toggleThinking = (index: number) => {
    setThinkingCollapsed((prev) => ({
      ...prev,
      [index]: !prev[index], // true면 접힘, false/undefined면 열림
    }));
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

    if (isFirstMessage) {
      fetchLLMTitle(targetSessionId, currentInput);
    }

    const assistantIndex = newMessages.length;
    
    // AI 메시지 생성 시 기본적으로 생각을 열어둠 (thinkingCollapsed[assistantIndex] = false)
    setThinkingCollapsed((prev) => ({ ...prev, [assistantIndex]: false }));

    updateCurrentSessionMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', reasoning: '' },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentInput,
          reasoningEffort,
          model: selectedModel,
        }),
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

            // 실시간으로 reasoning 또는 content 상태 업데이트
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
        <header className="px-6 py-4 flex items-center justify-between bg-white shrink-0 z-10 border-b border-gray-50">
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

          <div className="flex items-center gap-4">
            {/* 모델 선택 */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-400">모델:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50 font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-pink-200 cursor-pointer hover:bg-gray-100 transition"
              >
                <option value="빠른 모델">빠른 모델</option>
                <option value="빠른 모델 플러스">빠른 모델 플러스</option>
                <option value="기본 모델 플러스">기본 모델 플러스</option>
                <option value="생각하는 모델 플러스">생각하는 모델 플러스</option>
              </select>
            </div>

            {/* 추론 강도 */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-400">추론 강도:</span>
              <select
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50 font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-pink-200 cursor-pointer hover:bg-gray-100 transition"
              >
                <option value="low">Low (빠른 응답)</option>
                <option value="medium">Medium (기본 추론)</option>
                <option value="high">High (심층 추론)</option>
              </select>
            </div>
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

            {messages.map((m, i) => {
              const isCollapsed = thinkingCollapsed[i] === true; // true일 때만 접힘, 기본값(false/undefined)은 열림 상태

              return (
                <div key={i} className="flex flex-col space-y-2">
                  {/* 사용자 메시지 */}
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="bg-pink-100/80 text-pink-950 px-4.5 py-3 rounded-2xl max-w-[80%] text-base leading-relaxed shadow-2xs whitespace-pre-wrap">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    /* AI 답변 */
                    <div className="flex flex-col items-start pr-4 py-1 w-full">
                      {/* 생각 보기/접기 영역 (기본적으로 펼쳐짐) */}
                      {(m.reasoning || (loading && i === messages.length - 1)) && (
                        <div className="mb-3 w-full">
                          <button
                            onClick={() => toggleThinking(i)}
                            className="text-xs text-purple-600 font-medium bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg border border-purple-100 transition flex items-center gap-1.5"
                          >
                            🤖 {isCollapsed ? '생각 보기' : '생각 접기'}
                          </button>

                          {/* 생각 박스: 기본적으로 보임, 5줄 제한(max-h-[7.5rem] = 120px) 적용 */}
                          {!isCollapsed && (
                            <div className="mt-2 p-3 bg-gray-50 rounded-xl text-sm text-gray-500 italic leading-relaxed whitespace-pre-wrap max-h-[7.5rem] overflow-y-auto border border-gray-100 transition-all">
                              {m.reasoning || '추론 과정을 정리하고 있습니다...'}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 마크다운 콘텐츠 */}
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
              );
            })}

            {loading && messages[messages.length - 1]?.content === '' && !messages[messages.length - 1]?.reasoning && (
              <div className="text-gray-300 text-sm italic animate-pulse py-2">
                답변을 생각하고 있습니다...
              </div>
            )}
          </div>
        </div>

        {/* 하단 메시지 입력창 */}
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
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
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