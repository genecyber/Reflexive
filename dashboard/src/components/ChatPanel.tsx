'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { StatusBadge } from './Header';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  messages: Message[];
  isLoading: boolean;
  isRunning: boolean;
  showControls: boolean;
  interactive: boolean;
  onSendMessage: (message: string) => void;
  onStopResponse: () => void;
  onClearMessages: () => void;
  onSendCliInput?: (input: string) => void;
}

export function ChatPanel({
  messages,
  isLoading,
  isRunning,
  showControls,
  interactive,
  onSendMessage,
  onStopResponse,
  onClearMessages,
  onSendCliInput,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [cliInput, setCliInput] = useState('');
  const [inputMode, setInputMode] = useState<'agent' | 'cli'>('agent');
  const [autoHandle, setAutoHandle] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleCliSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cliInput.trim() || !onSendCliInput) return;
    onSendCliInput(cliInput);
    setCliInput('');
  };

  return (
    <div className="flex-1 flex flex-col bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden min-w-0">
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-zinc-800/80 border-b border-zinc-800 flex justify-between items-center text-sm font-medium">
        <span>Chat with your app</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClearMessages}
            className="px-2 py-0.5 text-xs text-zinc-400 border border-zinc-700 rounded hover:bg-zinc-700 hover:text-white"
          >
            + New
          </button>
          {showControls && <StatusBadge isRunning={isRunning} />}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`${msg.role === 'user' ? 'ml-8' : 'mr-8'}`}>
            <div
              className={`p-3 rounded-lg text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-900/50'
                  : 'bg-zinc-800/80'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-zinc-950 prose-pre:p-3 prose-code:text-xs">
                  <ReactMarkdown>{msg.content || '...'}</ReactMarkdown>
                </div>
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
          <div className="flex gap-1 p-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '-0.32s' }} />
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '-0.16s' }} />
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-zinc-800">
        {interactive && (
          <div className="flex gap-1 mb-2">
            <button
              onClick={() => setInputMode('agent')}
              className={`px-2.5 py-1 text-xs rounded border ${
                inputMode === 'agent'
                  ? 'bg-blue-900/50 border-blue-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              Ask Agent
            </button>
            <button
              onClick={() => setInputMode('cli')}
              className={`px-2.5 py-1 text-xs rounded border ${
                inputMode === 'cli'
                  ? 'bg-blue-900/50 border-blue-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              Direct to CLI
            </button>
          </div>
        )}

        {inputMode === 'agent' ? (
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={interactive ? 'Ask the agent about the CLI...' : 'Ask about your app...'}
              className="flex-1 px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
              disabled={isLoading}
            />
            {isLoading ? (
              <button
                type="button"
                onClick={onStopResponse}
                className="px-3.5 py-2.5 bg-red-500 rounded-md text-white font-medium hover:bg-red-600"
              >
                ■
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="px-5 py-2.5 bg-blue-500 rounded-md text-white font-medium hover:bg-blue-600 disabled:opacity-50"
              >
                Send
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={handleCliSubmit} className="flex gap-2">
            <input
              type="text"
              value={cliInput}
              onChange={(e) => setCliInput(e.target.value)}
              placeholder="Type directly to the CLI..."
              className="flex-1 px-3 py-2.5 bg-green-950 border border-green-800 rounded-md text-sm text-green-400 font-mono placeholder:text-green-700 focus:outline-none focus:border-green-500"
            />
            <button
              type="submit"
              disabled={!cliInput.trim()}
              className="px-4 py-2.5 bg-green-700 rounded-md text-white font-medium hover:bg-green-600 disabled:opacity-50"
            >
              Send to CLI
            </button>
          </form>
        )}

        {showControls && (
          <div className="flex items-center mt-2 pt-2 border-t border-zinc-800">
            <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer hover:text-white">
              <input
                type="checkbox"
                checked={autoHandle}
                onChange={(e) => setAutoHandle(e.target.checked)}
                className="w-4 h-4 accent-blue-500"
              />
              <span>Let agent continue after output</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
