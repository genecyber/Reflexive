'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { StatusBadge } from './Header';

// Regex to match tool call patterns: 🔧 **tool_name** (params) or 🔧 **tool_name**
const TOOL_CALL_REGEX = /🔧 \*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?/g;

interface ToolCallInfo {
  toolName: string;
  params: string | null;
  isSendInput: boolean;
}

// Parse tool calls from message content
function parseToolCalls(content: string): { segments: Array<{ type: 'text' | 'tool'; content: string; toolInfo?: ToolCallInfo }>; hasToolCalls: boolean } {
  const segments: Array<{ type: 'text' | 'tool'; content: string; toolInfo?: ToolCallInfo }> = [];
  let lastIndex = 0;
  let match;
  let hasToolCalls = false;

  const regex = new RegExp(TOOL_CALL_REGEX.source, 'g');

  while ((match = regex.exec(content)) !== null) {
    hasToolCalls = true;

    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex, match.index)
      });
    }

    const toolName = match[1];
    const params = match[2] || null;
    const isSendInput = toolName.toLowerCase() === 'send_input';

    segments.push({
      type: 'tool',
      content: match[0],
      toolInfo: { toolName, params, isSendInput }
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      content: content.slice(lastIndex)
    });
  }

  return { segments, hasToolCalls };
}

// Tool call - uses EXACT original CSS classes
function ToolCall({ toolInfo }: { toolInfo: ToolCallInfo }) {
  return (
    <div className={`tool-call ${toolInfo.isSendInput ? 'send-input' : ''}`}>
      <span className="tool-icon">⚡</span>
      <span className="tool-name">{toolInfo.toolName}</span>
      {toolInfo.params && (
        <span className="tool-params">{toolInfo.params}</span>
      )}
    </div>
  );
}

// Message content renderer - uses EXACT original .bubble class
function MessageContent({ content }: { content: string }) {
  const { segments, hasToolCalls } = useMemo(() => parseToolCalls(content || ''), [content]);

  if (!hasToolCalls) {
    return <ReactMarkdown>{content || '...'}</ReactMarkdown>;
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'tool' && segment.toolInfo) {
          return <ToolCall key={index} toolInfo={segment.toolInfo} />;
        }
        return <ReactMarkdown key={index}>{segment.content}</ReactMarkdown>;
      })}
    </>
  );
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isWatchTrigger?: boolean;
  watchPattern?: string;
  isBreakpointPrompt?: boolean;
  breakpointInfo?: { file: string; line: number };
  isAutoTrigger?: boolean;
}

interface ChatPanelProps {
  messages: Message[];
  isLoading: boolean;
  isRunning: boolean;
  showControls: boolean;
  interactive: boolean;
  autoHandleEnabled?: boolean;
  onSendMessage: (message: string) => void;
  onStopResponse: () => void;
  onClearMessages: () => void;
  onSendCliInput?: (input: string) => void;
  onAutoHandleChange?: (enabled: boolean) => void;
}

export function ChatPanel({
  messages,
  isLoading,
  isRunning,
  showControls,
  interactive,
  autoHandleEnabled = false,
  onSendMessage,
  onStopResponse,
  onClearMessages,
  onSendCliInput,
  onAutoHandleChange,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [cliInput, setCliInput] = useState('');
  const [inputMode, setInputMode] = useState<'agent' | 'cli'>('agent');
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

      {/* Messages - EXACT original structure */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '12px' }}>
        {messages.map((msg) => (
          <div key={msg.id} className="message" style={{ marginBottom: '12px' }}>
            {/* message-meta - EXACT original */}
            <div className="message-meta">
              {msg.isWatchTrigger && msg.role === 'assistant'
                ? `👁 watch triggered: ${msg.watchPattern?.slice(0, 30) || ''}`
                : msg.isBreakpointPrompt && msg.role === 'assistant'
                ? `🔴 breakpoint hit: ${msg.breakpointInfo?.file.split('/').pop() || ''}:${msg.breakpointInfo?.line || ''}`
                : msg.isAutoTrigger
                ? 'agent (auto)'
                : msg.role}
            </div>
            {/* bubble - EXACT original backgrounds and margins */}
            <div
              className="bubble"
              style={{
                background: msg.role === 'user' ? '#1e3a5f' : '#1a1a24',
                marginLeft: msg.role === 'user' ? '30px' : undefined,
                marginRight: msg.role === 'assistant' ? '30px' : undefined,
                borderLeft: msg.isWatchTrigger && msg.role === 'assistant'
                  ? '3px solid #3b82f6'
                  : msg.isBreakpointPrompt && msg.role === 'assistant'
                  ? '3px solid #ef4444'
                  : undefined,
              }}
            >
              {msg.role === 'assistant' ? (
                <MessageContent content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
          <div className="thinking">
            <span></span>
            <span></span>
            <span></span>
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

        {interactive && inputMode === 'cli' && (
          <div className="flex items-center mt-2 pt-2 border-t border-zinc-800">
            <span className="flex items-center gap-2 text-xs text-green-400">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              CLI waiting for input
            </span>
          </div>
        )}

        {showControls && (
          <div className="flex items-center mt-2 pt-2 border-t border-zinc-800">
            <label className={`flex items-center gap-2 text-xs cursor-pointer hover:text-white ${autoHandleEnabled ? 'text-blue-400' : 'text-zinc-500'}`}>
              <input
                type="checkbox"
                checked={autoHandleEnabled}
                onChange={(e) => onAutoHandleChange?.(e.target.checked)}
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
