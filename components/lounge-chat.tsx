'use client';

import { useQuery, usePaginatedQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAuthActions } from "@convex-dev/auth/react"
import { SendIcon, SunriseIcon, UsersIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import Link from 'next/link';

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function getTimeUntilReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  const diff = tomorrow.getTime() - now.getTime();
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hours}h ${minutes}m`;
}

function getAvatarColor(name: string) {
  const colors = [
    'bg-rose-500',
    'bg-amber-500', 
    'bg-emerald-500',
    'bg-cyan-500',
    'bg-violet-500',
    'bg-fuchsia-500',
    'bg-orange-500',
    'bg-teal-500',
  ];
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export function LoungeChat() {
  const isAuthenticated = useQuery(api.auth.isAuthenticated);
  const user = useQuery(api.users.viewer);
  const { results: paginatedMessages, status, loadMore } = usePaginatedQuery(
    api.lounge.getMessagesPaginated,
    {},
    { initialNumItems: 30 }
  );
  const sendMessage = useMutation(api.lounge.sendMessage);
  const { signIn } = useAuthActions();
  
  // Reverse paginated messages to display in chronological order (oldest first)
  const messages = useMemo(() => {
    if (!paginatedMessages) return undefined;
    return [...paginatedMessages].reverse();
  }, [paginatedMessages]);
  
  const canLoadMore = status === 'CanLoadMore';
  const isLoadingMore = status === 'LoadingMore';
  
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [vladThinking, setVladThinking] = useState(false);
  const [vladStreamingText, setVladStreamingText] = useState('');
  const [authState, setAuthState] = useState<'idle' | 'signing-in' | 'done'>('idle');
  const [timeUntilReset, setTimeUntilReset] = useState(getTimeUntilReset());
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasAttemptedSignIn = useRef(false);
  const prevMessageCount = useRef(0);

  // Set dark background for iOS Safari safe areas
  useEffect(() => {
    const originalHtmlBg = document.documentElement.style.backgroundColor;
    const originalBodyBg = document.body.style.backgroundColor;
    
    document.documentElement.style.backgroundColor = '#020617'; // slate-950
    document.body.style.backgroundColor = '#020617'; // slate-950
    
    return () => {
      document.documentElement.style.backgroundColor = originalHtmlBg;
      document.body.style.backgroundColor = originalBodyBg;
    };
  }, []);

  // Check if message mentions @vlad
  const mentionsVlad = (text: string) => {
    return /@vlad/i.test(text);
  };

  // Scroll to bottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior
    });
  }, []);

  // Check if user is near bottom of scroll (using window)
  const isNearBottom = useCallback(() => {
    const spacerHeight = 224;
    const threshold = spacerHeight + 50;
    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const distanceFromBottom = documentHeight - scrollTop - windowHeight;
    return distanceFromBottom < threshold;
  }, []);

  // Handle scroll events (on window)
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    setShouldAutoScroll(nearBottom);
    if (nearBottom) {
      setHasNewMessages(false);
    }
  }, [isNearBottom]);

  // Add window scroll listener
  useEffect(() => {
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Manual load more handler (button click only - no auto-scroll loading)
  const handleLoadMore = useCallback(() => {
    if (canLoadMore && !isLoadingMore) {
      loadMore(30);
    }
  }, [canLoadMore, isLoadingMore, loadMore]);

  // Trigger Vlad's AI response with streaming
  const triggerVladResponse = async () => {
    if (user?.isAnonymous && user.trialMessages <= 0) {
      return;
    }

    setVladThinking(true);
    setVladStreamingText('');
    setShouldAutoScroll(true);
    
    setTimeout(() => scrollToBottom(), 150);
    
    try {
      const response = await fetch('/api/lounge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: true }),
      });

      if (response.status === 403) {
        console.log('No @vlad mentions remaining');
        return;
      }

      if (!response.ok) throw new Error('Failed to get response');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let fullText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          fullText += chunk;
          setVladStreamingText(fullText);
          
          if (shouldAutoScroll) {
            scrollToBottom('auto');
          }
        }
      }
    } catch (error) {
      console.error('Failed to get Vlad response:', error);
    } finally {
      setVladThinking(false);
      setVladStreamingText('');
    }
  };

  // Auto sign in anonymous users
  useEffect(() => {
    if (isAuthenticated === false && !hasAttemptedSignIn.current && authState === 'idle') {
      hasAttemptedSignIn.current = true;
      setAuthState('signing-in');
      signIn('anonymous')
        .catch(() => {
          hasAttemptedSignIn.current = false;
          setAuthState('idle');
        }); 
    }
  }, [isAuthenticated, signIn, authState]);

  useEffect(() => {
    if (isAuthenticated === true) {
      setAuthState('done');
    }
  }, [isAuthenticated]);
  
  const isReady = isAuthenticated === true && user !== undefined;
  const isLoading = isAuthenticated === undefined || (authState === 'signing-in' && isAuthenticated !== true);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeUntilReset(getTimeUntilReset());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll when new messages arrive (if user is near bottom)
  useEffect(() => {
    const currentCount = messages?.length || 0;
    if (currentCount > prevMessageCount.current) {
      if (shouldAutoScroll) {
        scrollToBottom();
      } else {
        setHasNewMessages(true);
      }
    }
    prevMessageCount.current = currentCount;
  }, [messages?.length, shouldAutoScroll, scrollToBottom]);

  useEffect(() => {
    if (vladThinking && shouldAutoScroll) {
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [vladThinking, shouldAutoScroll, scrollToBottom]);

  // Initial scroll to bottom
  useEffect(() => {
    if (messages && messages.length > 0) {
      scrollToBottom('auto');
    }
  }, [messages?.length === 0, scrollToBottom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const messageText = input;
    setSending(true);
    setShouldAutoScroll(true);
    
    try {
      await sendMessage({ content: messageText });
      setInput('');
      
      if (mentionsVlad(messageText)) {
        setTimeout(() => triggerVladResponse(), 500);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const uniqueUsers = new Set(messages?.filter(m => !m.isBot && m.userId).map(m => m.userId)).size || 0;

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Full background coverage including safe areas */}
      <div className="fixed inset-0 -top-20 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-fuchsia-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Header - Fixed at top */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-slate-900/80 border-b border-white/5">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-slate-400 hover:text-white transition-colors text-sm flex items-center gap-1">
                <span>←</span>
                <span className="hidden md:inline">Back to Chat</span>
              </Link>
            </div>
            <div className="flex items-center gap-3 md:gap-4">
              <div className="flex items-center gap-1 md:gap-2 text-sm text-slate-400">
                <UsersIcon className="w-4 h-4" />
                <span className="hidden md:inline">{uniqueUsers} {uniqueUsers === 1 ? 'person' : 'people'} today</span>
                <span className="md:hidden">{uniqueUsers}</span>
              </div>
              <div className="flex items-center gap-1 md:gap-2 text-sm text-amber-400/80">
                <SunriseIcon className="w-4 h-4" />
                <span className="hidden md:inline">Resets in {timeUntilReset}</span>
                <span className="md:hidden">{timeUntilReset}</span>
              </div>
            </div>
          </div>
        </div>
      </header>
      
      {/* Spacer for fixed header */}
      <div className="h-16" />

      {/* Messages Area */}
      <div 
        ref={messagesContainerRef}
        className="relative z-10"
      >
        <div className="max-w-3xl mx-auto px-4">
          {/* Welcome message */}
          <div className="py-12 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-violet-500/20 to-cyan-500/20 border border-white/10 mb-6">
              <span className="text-2xl">🌙</span>
              <span className="font-mono text-sm text-slate-300">THE LOUNGE</span>
            </div>
            <h1 className="text-3xl font-light text-white mb-2 tracking-tight">
              Daily Group Chat
            </h1>
            <p className="text-slate-400 max-w-md mx-auto">
              An ephemeral space for conversation. Every message disappears at midnight UTC. 
              No history, no pressure—just talk. Mention <span className="text-violet-400 font-mono">@vlad</span> to get a response!
            </p>
          </div>

          {/* Messages */}
          <div className="space-y-4">
            {/* Load more button at top */}
            {canLoadMore && (
              <div className="flex justify-center py-4">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-sm transition-colors disabled:opacity-50"
                >
                  <ChevronUpIcon className="w-4 h-4" />
                  {isLoadingMore ? 'Loading...' : 'Load older messages'}
                </button>
              </div>
            )}
            
            {messages?.length === 0 && (
              <div className="text-center py-16">
                <div className="text-6xl mb-4">💬</div>
                <p className="text-slate-500">No messages yet today. Be the first to say something!</p>
              </div>
            )}

            {messages?.map((message, idx) => {
              const isOwnMessage = user && message.userId === user._id;
              const isBot = message.isBot;
              const showAvatar = idx === 0 || messages[idx - 1].userId !== message.userId || messages[idx - 1].isBot !== message.isBot;
              
              return (
                <div
                  key={message._id}
                  className={`flex gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''} ${!showAvatar ? 'pl-12' : ''}`}
                >
                  {showAvatar && (
                    <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium ${isBot ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500' : getAvatarColor(message.userName)} ring-2 ${isBot ? 'ring-violet-400/30' : 'ring-white/10'}`}>
                      {message.userImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={message.userImage} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        message.userName.charAt(0).toUpperCase()
                      )}
                    </div>
                  )}
                  
                  <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'} max-w-[75%]`}>
                    {showAvatar && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm font-medium text-slate-300`}>
                          {message.userName}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatTime(message._creationTime)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`px-4 py-2.5 rounded-2xl ${
                        isOwnMessage
                          ? 'bg-gradient-to-r from-violet-600 to-violet-500 text-white'
                          : isBot 
                            ? 'bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-slate-200 border border-violet-500/20'
                            : 'bg-white/5 text-slate-200 border border-white/5'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                        {message.content}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            
            {/* Vlad streaming/thinking indicator */}
            {(vladThinking || vladStreamingText) && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium bg-gradient-to-br from-violet-500 to-fuchsia-500 ring-2 ring-violet-400/30">
                  V
                </div>
                <div className="flex flex-col items-start max-w-[75%]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-300">Vlad</span>
                  </div>
                  <div className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-slate-200 border border-violet-500/20">
                    {vladStreamingText ? (
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                        {vladStreamingText}
                        <span className="inline-block w-2 h-4 bg-violet-400 ml-1 animate-pulse" />
                      </p>
                    ) : (
                      <div className="flex items-center gap-1 text-slate-400">
                        <span className="animate-pulse">●</span>
                        <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</span>
                        <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
            <div style={{ height: 'calc(14rem + env(safe-area-inset-bottom, 0px))' }} aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Scroll to bottom button */}
      {hasNewMessages && !shouldAutoScroll && (
        <button
          onClick={() => {
            scrollToBottom();
            setHasNewMessages(false);
            setShouldAutoScroll(true);
          }}
          className="fixed left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium shadow-xl shadow-black/40 transition-all duration-200 hover:scale-105 animate-bounce"
          style={{ 
            bottom: 'calc(11rem + env(safe-area-inset-bottom, 0px))',
            zIndex: 60 
          }}
        >
          <ChevronDownIcon className="w-4 h-4" />
          New messages
        </button>
      )}

      {/* Input area - Fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="absolute inset-0 -bottom-20 backdrop-blur-xl" />
        <div className="absolute inset-0 -top-16 -bottom-20 bg-gradient-to-t from-slate-900 via-slate-900/90 via-70% to-transparent" />
        <div className="relative max-w-3xl mx-auto px-4 pt-4 pb-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}>
          {isLoading && (
            <div className="mb-4 text-center">
              <p className="text-slate-400 text-sm">Connecting...</p>
            </div>
          )}
          
          {!isLoading && !isReady && (
            <div className="mb-4 text-center">
              <button
                onClick={() => {
                  setAuthState('signing-in');
                  signIn('anonymous')
                    .then(() => setAuthState('done'))
                    .catch(() => setAuthState('idle'));
                }}
                className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
              >
                Join the Lounge
              </button>
            </div>
          )}

          {isReady && user?.isAnonymous && (
            <div className="mb-3 flex items-center justify-center gap-2 flex-wrap">
              {user.trialMessages > 0 ? (
                <span className="text-amber-400/80 text-sm">{user.trialMessages} @vlad mentions left</span>
              ) : (
                <span className="text-rose-400/80 text-sm">No @vlad mentions left</span>
              )}
              <span className="text-slate-600">•</span>
              <button
                onClick={() => signIn('google')}
                className="text-sm text-slate-400 hover:text-white transition-colors underline underline-offset-2"
              >
                Sign in with Google
              </button>
              <span className="text-slate-600">for unlimited</span>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="relative">
            <div className="relative rounded-2xl bg-white/10 border border-white/10 backdrop-blur-xl overflow-hidden focus-within:border-violet-500/50 focus-within:ring-2 focus-within:ring-violet-500/20 transition-all flex items-end shadow-lg shadow-black/20">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isReady ? "Say something... (tag @vlad and he responds)" : "Join to start chatting..."}
                disabled={!isReady}
                rows={2}
                className="flex-1 bg-transparent px-4 py-3 pr-2 text-white placeholder-slate-500 resize-none focus:outline-none text-base disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed"
                style={{ minHeight: '60px', maxHeight: '200px' }}
              />
              <button
                type="submit"
                disabled={!input.trim() || sending || !isReady}
                className="flex-shrink-0 m-2 p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:opacity-50 transition-all duration-200 disabled:cursor-not-allowed"
              >
                <SendIcon className="w-4 h-4 text-white" />
              </button>
            </div>
          </form>
          
          <p className="text-center text-xs text-slate-600 mt-3">
            Messages are ephemeral and cleared daily at midnight UTC
          </p>
        </div>
      </div>
    </div>
  );
}
