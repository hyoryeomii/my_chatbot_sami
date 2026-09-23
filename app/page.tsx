'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  imageUrl?: string;
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
  const [useMcp, setUseMcp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // MCP 경로 지정 모달 관련 상태
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [mcpTargetPath, setMcpTargetPath] = useState('');

  // 프론트엔드 파일 첨부 관련 상태
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    content: string;
    isImage: boolean;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모달 팝업용 상태
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

  // 이미지 및 텍스트 파일 선택 처리
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();

    reader.onload = (event) => {
      const resultStr = (event.target?.result as string) || '';
      setSelectedFile({
        name: file.name,
        content: resultStr,
        isImage,
      });
    };

    if (isImage) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  };

  // MCP 경로 지정 후 요약 요청 함수
  const handleMcpPathSummary = (targetPath: string) => {
    if (!targetPath.trim()) return;
    setUseMcp(true);
    setIsMcpModalOpen(false);
    
    const prompt = `MCP Filesystem 도구를 사용하여 '${targetPath}' 경로의 파일 또는 폴더 구조 및 내용을 읽고 핵심을 요약해줘.`;
    sendMessageCustom(prompt);
  };

  const fetchLLMTitle = async (sessionId: string, userPrompt: string) => {
    try {
      const res = await fetch('/api/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userPrompt }),
      });

      if (!res.ok) return;

      const data = await res.json();
      if (data.title) {
        const cleanTitle = data.title.replace(/^💬\s*/, '');
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: cleanTitle } : s))
        );
      }
    } catch (e) {
      console.error('제목 생성 중 파싱 에러 방지:', e);
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

  const getLatestReasoningStep = (fullReasoning: string = '') => {
    if (!fullReasoning.trim()) return '생각을 정리하고 있습니다...';

    const lines = fullReasoning
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return '생각을 정리하고 있습니다...';

    return lines[lines.length - 1];
  };

  const sendMessageCustom = async (customText?: string) => {
    const textToSend = customText !== undefined ? customText : input;
    if ((!textToSend.trim() && !selectedFile) || loading) return;

    let fullPrompt = textToSend;
    let displayContent = textToSend;
    let userImageUrl: string | undefined = undefined;

    if (selectedFile) {
      if (selectedFile.isImage) {
        fullPrompt = `${textToSend}\n\n[첨부 이미지: ${selectedFile.name}]`;
        displayContent = textToSend;
        userImageUrl = selectedFile.content;
      } else {
        fullPrompt = `${textToSend}\n\n[첨부 파일: ${selectedFile.name}]\n\`\`\`\n${selectedFile.content}\n\`\`\``;
        displayContent = textToSend
          ? `${textToSend}\n\n📎 **${selectedFile.name}**\n\`\`\`\n${selectedFile.content}\n\`\`\``
          : `📎 **${selectedFile.name}**\n\`\`\`\n${selectedFile.content}\n\`\`\``;
      }
    }

    const userMsg: Message = {
      role: 'user',
      content: displayContent,
      imageUrl: userImageUrl,
    };
    const newMessages = [...messages, userMsg];

    updateCurrentSessionMessages(newMessages);

    const isFirstMessage = messages.length === 0;
    const targetSessionId = currentSessionId;

    setInput('');
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setLoading(true);

    if (isFirstMessage) {
      fetchLLMTitle(targetSessionId, displayContent || selectedFile?.name || '새 대화');
    }

    const assistantIndex = newMessages.length;

    updateCurrentSessionMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', reasoning: '' },
    ]);

    let typingInterval: NodeJS.Timeout | null = null;
    let checkQueueFinish: NodeJS.Timeout | null = null;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullPrompt,
          reasoningEffort,
          model: selectedModel,
          useMcp,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        updateCurrentSessionMessages((prev) => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: 'assistant',
            content: `⚠️ 오류가 발생했습니다: ${errData.error || '서버 응답 오류'}`,
          };
          return updated;
        });
        setLoading(false);
        return;
      }

      if (!res.body) {
        updateCurrentSessionMessages((prev) => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: 'assistant',
            content: '⚠️ 응답 데이터를 받아올 수 없습니다.',
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

      let chunkQueue: string[] = [];

      typingInterval = setInterval(() => {
        if (chunkQueue.length > 0) {
          const nextChunks = chunkQueue.splice(0, 2).join('');
          updateCurrentSessionMessages((prev) => {
            const updated = [...prev];
            const currentMsg = updated[assistantIndex];
            if (!currentMsg) return prev;

            return updated.map((msg, idx) =>
              idx === assistantIndex
                ? { ...msg, content: (msg.content || '') + nextChunks }
                : msg
            );
          });
        }
      }, 10);

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
              chunkQueue.push(content);
            }
          } catch (e) {
            console.error('JSON 파싱 에러:', e);
          }
        }
      }

      checkQueueFinish = setInterval(() => {
        if (chunkQueue.length === 0) {
          if (typingInterval) clearInterval(typingInterval);
          if (checkQueueFinish) clearInterval(checkQueueFinish);
          setLoading(false);
        }
      }, 50);

    } catch (err) {
      console.error(err);
      if (typingInterval) clearInterval(typingInterval);
      if (checkQueueFinish) clearInterval(checkQueueFinish);

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
            className="w-full bg-white hover:bg-pink-100/40 text-gray-700 font-medium py-2.5 px-4 rounded-full shadow-xs transition border border-pink-200/60 flex items-center justify-center gap-2 mb-6 text-sm"
          >
            <span>+</span> 새 대화 시작하기
          </button>

          <div className="text-xs font-semibold text-gray-400 mb-2 px-1">이전 대화 목록</div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setCurrentSessionId(session.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-full text-sm truncate transition ${
                  session.id === currentSessionId
                    ? 'bg-pink-100/80 font-medium text-pink-950'
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
      <main className="flex-1 flex flex-col h-screen bg-white relative overflow-hidden min-w-0">
        {/* 헤더 */}
        <header className="px-6 py-4 flex items-center justify-between bg-white shrink-0 z-10 border-b border-pink-50">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-pink-50 text-gray-600 transition"
                title="사이드바 열기"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* 🌸 MCP 탐색 경로 버튼 */}
            <button
              onClick={() => setIsMcpModalOpen(true)}
              className="text-xs bg-pink-50/80 hover:bg-pink-100/80 border border-pink-200 text-pink-900 font-medium px-3 py-1.5 rounded-full transition flex items-center gap-1.5 shadow-2xs"
              title="MCP 파일/폴더 요약 지정"
            >
              <svg className="w-3.5 h-3.5 text-pink-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <span>MCP 탐색 경로</span>
            </button>

            {/* MCP 연동 스위치 */}
            <div className="flex items-center gap-2 bg-pink-50/40 border border-pink-200/70 rounded-full px-3 py-1">
              <span className="text-xs font-medium text-pink-900">MCP 연동</span>
              <button
                type="button"
                onClick={() => setUseMcp(!useMcp)}
                className={`relative inline-flex h-4.5 w-8.5 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  useMcp ? 'bg-pink-400' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                    useMcp ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* 🌸 둥글둥글한 핑크 테두리 커스텀 모델 선택 박스 */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-gray-400">모델:</span>
              <div className="relative inline-block">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="appearance-none text-xs border border-pink-200 rounded-full pl-3 pr-7 py-1.5 bg-pink-50/30 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-200/80 cursor-pointer hover:bg-pink-50/60 transition"
                >
                  <option value="빠른 모델">빠른 모델</option>
                  <option value="빠른 모델 플러스">빠른 모델 플러스</option>
                  <option value="기본 모델 플러스">기본 모델 플러스</option>
                  <option value="생각하는 모델 플러스">생각하는 모델 플러스</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-pink-400">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* 🌸 둥글둥글한 핑크 테두리 커스텀 추론 강도 선택 박스 */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-gray-400">추론 강도:</span>
              <div className="relative inline-block">
                <select
                  value={reasoningEffort}
                  onChange={(e) => setReasoningEffort(e.target.value)}
                  className="appearance-none text-xs border border-pink-200 rounded-full pl-3 pr-7 py-1.5 bg-pink-50/30 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-200/80 cursor-pointer hover:bg-pink-50/60 transition"
                >
                  <option value="low">Low (빠른 응답)</option>
                  <option value="medium">Medium (기본 추론)</option>
                  <option value="high">High (심층 추론)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-pink-400">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* 📜 채팅 메시지 스크롤 영역 */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 pt-4 pb-12 space-y-6 min-w-0">
            {messages.length === 0 && (
              <div className="h-[60vh] flex flex-col items-center justify-center text-gray-300 text-base">
                <p>궁금한 점을 자유롭게 입력해 주세요!</p>
              </div>
            )}

            {messages.map((m, i) => {
              const isGenerating = loading && i === messages.length - 1;

              return (
                <div key={i} className="flex flex-col space-y-2 min-w-0">
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="bg-pink-100/80 text-pink-950 px-5 py-3 rounded-3xl max-w-[80%] text-base leading-relaxed shadow-2xs flex flex-col gap-3">
                        {m.imageUrl && (
                          <div className="bg-white p-2.5 rounded-2xl border border-pink-200/60 shadow-xs flex justify-center items-center">
                            <img
                              src={m.imageUrl}
                              alt="첨부 이미지"
                              className="max-w-full max-h-72 rounded-xl object-contain"
                            />
                          </div>
                        )}

                        {m.content && (
                          <div className="whitespace-pre-wrap px-0.5">{m.content}</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start pr-4 py-1 w-full gap-3 min-w-0 overflow-hidden">
                      {(m.reasoning || isGenerating) && (
                        <div className="flex items-start gap-2.5 w-full max-w-full min-w-0">
                          <div className="w-7 h-7 rounded-full bg-pink-100 border border-pink-200 flex items-center justify-center text-pink-500 text-xs shrink-0 mt-0.5">
                            ▶
                          </div>

                          <div
                            onClick={() => m.reasoning && setActiveModalReasoning(m.reasoning)}
                            className="flex-1 border border-pink-100 bg-pink-50/30 hover:bg-pink-50/60 rounded-2xl p-3 transition cursor-pointer shadow-2xs group relative max-w-full min-w-0 overflow-hidden"
                          >
                            <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-1">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-pink-400 animate-ping' : 'bg-gray-300'}`} />
                                <span>{isGenerating ? '생각중...' : '생각 완료'}</span>
                              </div>
                              <span className="text-gray-400 group-hover:text-pink-500 text-[10px] transition shrink-0 ml-2">
                                ▼ 클릭해서 전체 생각 보기
                              </span>
                            </div>

                            {isGenerating && (
                              <div className="text-xs text-gray-500 italic truncate font-normal w-full overflow-hidden">
                                {getLatestReasoningStep(m.reasoning)}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {m.content && (
                        <div className="text-gray-800 text-base leading-relaxed w-full prose prose-base max-w-none pl-9 min-w-0 overflow-hidden">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              table: ({ node, ...props }) => (
                                <div className="overflow-x-auto my-3 border border-pink-100 rounded-xl">
                                  <table className="min-w-full divide-y divide-pink-100 text-sm" {...props} />
                                </div>
                              ),
                              thead: ({ node, ...props }) => <thead className="bg-pink-50/50 text-gray-700 font-semibold" {...props} />,
                              th: ({ node, ...props }) => <th className="px-3.5 py-2.5 text-left" {...props} />,
                              td: ({ node, ...props }) => <td className="px-3.5 py-2.5 border-t border-pink-50 text-gray-600" {...props} />,
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

        {/* 📎 하단 입력창 + 파일 선택 영역 */}
        <div className="p-4 bg-white shrink-0">
          <div className="max-w-3xl mx-auto flex flex-col bg-gray-50/80 rounded-3xl p-3 border border-pink-100/80 focus-within:border-pink-200 focus-within:ring-2 focus-within:ring-pink-100/50 transition shadow-2xs">
            
            {/* 선택된 파일 미니 뱃지 */}
            {selectedFile && (
              <div className="flex items-center gap-2 mb-2 px-3 py-1 bg-pink-100/80 border border-pink-200 text-pink-900 rounded-full text-xs w-fit">
                <span>{selectedFile.isImage ? '🖼️' : '📄'} {selectedFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="hover:text-pink-600 font-bold ml-1"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-gray-400 hover:text-pink-500 hover:bg-pink-100/50 rounded-full transition shrink-0"
                title="파일/이미지 첨부하기"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
              </button>

              <textarea
                rows={1}
                value={input}
                disabled={loading}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter' && e.shiftKey) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessageCustom();
                  }
                }}
                className="flex-1 bg-transparent px-2 py-1.5 text-base text-gray-800 focus:outline-none disabled:opacity-50 resize-none max-h-32 overflow-y-auto"
                placeholder="메시지를 입력하거나 이미지/파일을 첨부해보세요..."
              />

              <button
                onClick={() => sendMessageCustom()}
                disabled={loading || (!input.trim() && !selectedFile)}
                className="bg-pink-400 hover:bg-pink-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-base font-medium px-4 py-2 rounded-2xl transition shadow-2xs shrink-0"
              >
                전송
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* 🌸 MCP 로컬 탐색 모달 팝업 */}
      {isMcpModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-xl border border-pink-100 overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-pink-50 flex items-center justify-between bg-pink-50/50">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-pink-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                <h3 className="font-semibold text-gray-800 text-sm">MCP 로컬 파일/폴더 요약</h3>
              </div>
              <button
                onClick={() => setIsMcpModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-pink-100/50 transition text-base"
              >
                ✕
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                MCP 서버가 접근 가능한 프로젝트 범위 내의 경로(파일 또는 폴더)를 입력하면, 직접 탐색하여 요약해 줍니다.
              </p>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">
                  탐색할 파일 또는 폴더 경로:
                </label>
                <input
                  type="text"
                  value={mcpTargetPath}
                  onChange={(e) => setMcpTargetPath(e.target.value)}
                  placeholder="예: app/page.tsx 또는 public/"
                  className="w-full border border-pink-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200/80 bg-pink-50/20"
                />
              </div>

              {/* 자주 쓰는 예시 경로 버튼들 */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[11px] text-gray-400 self-center mr-1">자주 찾는 경로:</span>
                {['package.json', 'app/page.tsx', 'public/'].map((path) => (
                  <button
                    key={path}
                    onClick={() => setMcpTargetPath(path)}
                    className="text-[11px] bg-pink-50 hover:bg-pink-100 text-pink-900 px-2.5 py-1 rounded-full transition"
                  >
                    {path}
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setIsMcpModalOpen(false)}
                  className="px-4 py-2 rounded-full text-xs font-medium text-gray-500 hover:bg-gray-100 transition"
                >
                  취소
                </button>
                <button
                  onClick={() => handleMcpPathSummary(mcpTargetPath)}
                  disabled={!mcpTargetPath.trim()}
                  className="px-5 py-2 bg-pink-400 hover:bg-pink-500 disabled:bg-gray-200 text-white rounded-full text-xs font-medium transition shadow-2xs"
                >
                  MCP로 읽고 요약하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 🌸 모달 팝업 창 (생각 보기) */}
      {activeModalReasoning && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-xl border border-pink-100 overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-pink-50 flex items-center justify-between bg-pink-50/50">
              <div className="flex items-center gap-2">
                <span className="text-pink-500">●</span>
                <h3 className="font-semibold text-gray-800 text-base">생각 과정 보기</h3>
              </div>
              <button
                onClick={() => setActiveModalReasoning(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-full hover:bg-pink-100/50 transition text-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 bg-white">
              <div className="bg-gray-900 text-gray-200 p-4 rounded-2xl font-mono text-xs leading-relaxed whitespace-pre-wrap overflow-x-auto shadow-inner border border-gray-800">
                {activeModalReasoning}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}