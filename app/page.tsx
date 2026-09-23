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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 모달 팝업용 상태 (클릭한 메시지의 reasoning 저장)
  const [activeModalReasoning, setActiveModalReasoning] = useState<string | null>(null);

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
          prev.map((s) => (s.id === sessionId ? { ...s, title: ` ${data.title}` } : s))
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

  // 실시간 추론 텍스트 중 가장 최근 1줄 추출
  const getLatestReasoningStep = (fullReasoning: string = '') => {
    if (!fullReasoning.trim()) return '생각을 정리하고 있습니다...';
    
    const lines = fullReasoning
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return '생각을 정리하고 있습니다...';

    return lines[lines.length - 1];
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
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = '';

      // 🌸 샤라락 타이핑을 위한 글자 큐(Queue)
      let contentQueue: string[] = [];

      const typingInterval = setInterval(() => {
        if (contentQueue.length > 0) {
          const nextChar = contentQueue.shift();
          updateCurrentSessionMessages((prev) => {
            const updated = [...prev];
            const currentMsg = updated[assistantIndex];
            if (!currentMsg) return prev;

            return updated.map((msg, idx) =>
              idx === assistantIndex
                ? { ...msg, content: (msg.content || '') + nextChar }
                : msg
            );
          });
        }
      }, 25);

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

            if (reasoning) {
              updateCurrentSessionMessages((prev) => {
                const updated = [...prev];
                const currentMsg = updated[assistantIndex];
                if (!currentMsg) return prev;

                updated[assistantIndex] = {
                  ...currentMsg,
                  reasoning: (currentMsg.reasoning || '') + reasoning,
                };
                return updated;
              });
            }

            if (content) {
              contentQueue.push(...content.split(''));
            }
          } catch (e) {
            console.error('JSON 파싱 에러:', e);
          }
        }
      }

      const checkQueueFinish = setInterval(() => {
        if (contentQueue.length === 0) {
          clearInterval(typingInterval);
          clearInterval(checkQueueFinish);
          setLoading(false);
        }
      }, 100);

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

      {/* 💬 2. 메인 영역 */}
      <main className="flex-1 flex flex-col h-screen bg-white relative overflow-hidden">
        {/* 헤더 */}
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

        {/* 📜 채팅 메시지 스크롤 영역 */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 pt-4 pb-12 space-y-6">
            {messages.length === 0 && (
              <div className="h-[60vh] flex flex-col items-center justify-center text-gray-300 text-base">
                <p>궁금한 점을 자유롭게 입력해 주세요!</p>
              </div>
            )}

            {messages.map((m, i) => {
              const isGenerating = loading && i === messages.length - 1;

              return (
                <div key={i} className="flex flex-col space-y-2">
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="bg-pink-100/80 text-pink-950 px-4.5 py-3 rounded-2xl max-w-[80%] text-base leading-relaxed shadow-2xs whitespace-pre-wrap">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start pr-4 py-1 w-full gap-3">
                      
                      {/* 🤖 2, 3번째 사진처럼 상단 아이콘 + 카드 박스 디자인 구현 */}
                      {(m.reasoning || isGenerating) && (
                        <div className="flex items-start gap-2.5 w-full">
                          {/* 🤖 로봇 아이콘 */}
                          <div className="w-7 h-7 rounded-full bg-purple-100 border border-purple-200 flex items-center justify-center text-purple-600 text-xs shrink-0 mt-0.5">
                            🤖
                          </div>

                          {/* 카드 박스 (2, 3번 스크린샷과 동일한 스타일) */}
                          <div
                            onClick={() => m.reasoning && setActiveModalReasoning(m.reasoning)}
                            className={`flex-1 border border-gray-200/80 bg-gray-50/50 hover:bg-gray-50 rounded-xl p-3 transition cursor-pointer shadow-2xs group relative`}
                          >
                            <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-1">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-blue-500 animate-ping' : 'bg-gray-400'}`} />
                                <span>{isGenerating ? '생각중...' : '생각 완료'}</span>
                              </div>
                              <span className="text-gray-400 group-hover:text-purple-600 text-[10px] transition">
                                ▼ 클릭해서 전체 생각 보기
                              </span>
                            </div>

                            {/* 실시간 생각 문장 흐름 (2, 3번 사진처럼 이탤릭 소형 텍스트) */}
                            {isGenerating && (
                              <div className="text-xs text-gray-500 italic truncate font-normal">
                                {getLatestReasoningStep(m.reasoning)}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 마크다운 답변 본문 */}
                      {m.content && (
                        <div className="text-gray-800 text-base leading-relaxed w-full prose prose-base max-w-none pl-9">
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
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {loading && messages[messages.length - 1]?.content === '' && !messages[messages.length - 1]?.reasoning && (
              <div className="text-gray-300 text-sm italic animate-pulse py-2 pl-9">
                답변을 준비하고 있습니다...
              </div>
            )}
          </div>
        </div>

        {/* 하단 입력창 */}
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
              placeholder="메시지를 입력하세요..."
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

      {/* 🌸 5번째 사진과 동일한 '생각 보기' 모달 팝업 창 */}
      {activeModalReasoning && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[80vh]">
            {/* 모달 상단 헤더 */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="text-lg">🤖</span>
                <h3 className="font-bold text-gray-800 text-base">생각 보기</h3>
              </div>
              <button
                onClick={() => setActiveModalReasoning(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-200/50 transition text-lg"
              >
                ✕
              </button>
            </div>

            {/* 모달 본문 (5번 사진 스타일: 다크 스타일 코드블록 내 추론 출력) */}
            <div className="p-6 overflow-y-auto flex-1 bg-white">
              <div className="bg-gray-900 text-gray-200 p-4 rounded-xl font-mono text-xs leading-relaxed whitespace-pre-wrap overflow-x-auto shadow-inner border border-gray-800">
                {activeModalReasoning}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}