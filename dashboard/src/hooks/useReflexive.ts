'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, ProcessStatus, DebuggerStatus, Breakpoint } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

export function useReflexive() {
  const [status, setStatus] = useState<ProcessStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [debuggerStatus, setDebuggerStatus] = useState<DebuggerStatus | null>(null);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/state`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setIsConnected(true);
      }
    } catch {
      setIsConnected(false);
    }
  }, []);

  // Fetch logs
  const fetchLogs = useCallback(async (count = 100) => {
    try {
      const res = await fetch(`${API_BASE}/logs?count=${count}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Fetch debugger status
  const fetchDebuggerStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/debugger-status`);
      if (res.ok) {
        const data = await res.json();
        setDebuggerStatus(data);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Fetch breakpoints
  const fetchBreakpoints = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/debugger-breakpoints`);
      if (res.ok) {
        const data = await res.json();
        setBreakpoints(data.breakpoints || []);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Process control
  const startProcess = useCallback(async () => {
    await fetch(`${API_BASE}/start`, { method: 'POST' });
    await fetchStatus();
  }, [fetchStatus]);

  const stopProcess = useCallback(async () => {
    await fetch(`${API_BASE}/stop`, { method: 'POST' });
    await fetchStatus();
  }, [fetchStatus]);

  const restartProcess = useCallback(async () => {
    await fetch(`${API_BASE}/restart`, { method: 'POST' });
    await fetchStatus();
  }, [fetchStatus]);

  const runApp = useCallback(async (path: string, args?: string[]) => {
    const res = await fetch(`${API_BASE}/run-app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args }),
    });
    const data = await res.json();
    await fetchStatus();
    return data;
  }, [fetchStatus]);

  const shutdown = useCallback(async () => {
    await fetch(`${API_BASE}/shutdown`, { method: 'POST' });
  }, []);

  // Debugger controls
  const debuggerResume = useCallback(async () => {
    await fetch(`${API_BASE}/debugger-resume`, { method: 'POST' });
  }, []);

  const debuggerStepOver = useCallback(async () => {
    await fetch(`${API_BASE}/debugger-step-over`, { method: 'POST' });
  }, []);

  const debuggerStepInto = useCallback(async () => {
    await fetch(`${API_BASE}/debugger-step-into`, { method: 'POST' });
  }, []);

  const debuggerStepOut = useCallback(async () => {
    await fetch(`${API_BASE}/debugger-step-out`, { method: 'POST' });
  }, []);

  // Breakpoint management
  const addBreakpoint = useCallback(async (file: string, line: number, options?: { condition?: string; prompt?: string }) => {
    await fetch(`${API_BASE}/debugger-breakpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, line, ...options }),
    });
    await fetchBreakpoints();
  }, [fetchBreakpoints]);

  const updateBreakpoint = useCallback(async (id: string, updates: Partial<Breakpoint>) => {
    await fetch(`${API_BASE}/debugger-breakpoint/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    await fetchBreakpoints();
  }, [fetchBreakpoints]);

  const deleteBreakpoint = useCallback(async (id: string) => {
    await fetch(`${API_BASE}/debugger-breakpoint/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await fetchBreakpoints();
  }, [fetchBreakpoints]);

  // CLI input
  const sendCliInput = useCallback(async (input: string) => {
    await fetch(`${API_BASE}/cli-input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
  }, []);

  // Log a message
  const logMessage = useCallback(async (type: string, message: string) => {
    await fetch(`${API_BASE}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message }),
    });
  }, []);

  // Toggle permission
  const togglePermission = useCallback(async (permission: string) => {
    await fetch(`${API_BASE}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission, toggle: true }),
    });
    await fetchStatus();
  }, [fetchStatus]);

  // Reload reflexive with new settings
  const reloadSettings = useCallback(async (settings: {
    capabilities?: Record<string, boolean>;
    interactive?: boolean;
    debug?: boolean;
    eval?: boolean;
  }) => {
    const res = await fetch(`${API_BASE}/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (data.success) {
      // Refresh status to get new state
      await fetchStatus();
    }
    return data;
  }, [fetchStatus]);

  // Polling
  useEffect(() => {
    fetchStatus();
    fetchLogs();

    const statusInterval = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 2000);

    return () => clearInterval(statusInterval);
  }, [fetchStatus, fetchLogs]);

  // Debugger polling (faster when enabled)
  useEffect(() => {
    fetchDebuggerStatus();
    fetchBreakpoints();

    const debugInterval = setInterval(() => {
      fetchDebuggerStatus();
      fetchBreakpoints();
    }, 1000);

    return () => clearInterval(debugInterval);
  }, [fetchDebuggerStatus, fetchBreakpoints]);

  return {
    // State
    status,
    logs,
    debuggerStatus,
    breakpoints,
    isConnected,

    // Refresh functions
    fetchStatus,
    fetchLogs,
    fetchDebuggerStatus,
    fetchBreakpoints,

    // Process control
    startProcess,
    stopProcess,
    restartProcess,
    runApp,
    shutdown,

    // Debugger control
    debuggerResume,
    debuggerStepOver,
    debuggerStepInto,
    debuggerStepOut,

    // Breakpoints
    addBreakpoint,
    updateBreakpoint,
    deleteBreakpoint,

    // CLI
    sendCliInput,
    logMessage,

    // Permissions
    togglePermission,

    // Settings reload
    reloadSettings,

    // API base URL (for components that need direct access)
    apiBase: API_BASE,
  };
}

// Chat message type with optional metadata
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isWatchTrigger?: boolean;
  watchPattern?: string;
  isBreakpointPrompt?: boolean;
  breakpointInfo?: { file: string; line: number };
  isAutoTrigger?: boolean;
  isCliOutput?: boolean;  // CLI stdout/stderr streamed to chat
  isCliInput?: boolean;   // User input sent directly to CLI
}

// Chat hook for streaming
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch chat history ONCE on mount (like old UI)
  useEffect(() => {
    if (historyLoaded) return;

    fetch(`${API_BASE}/chat-history`)
      .then(res => res.json())
      .then((history: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: string;
        isCliOutput?: boolean;
        isCliInput?: boolean;
        isWatchTrigger?: boolean;
        watchPattern?: string;
        isBreakpointPrompt?: boolean;
        breakpointFile?: string;
        breakpointLine?: number;
        isAutoTrigger?: boolean;
      }>) => {
        if (history && history.length > 0) {
          const loaded: ChatMessage[] = history.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            isCliOutput: msg.isCliOutput,
            isCliInput: msg.isCliInput,
            isWatchTrigger: msg.isWatchTrigger,
            watchPattern: msg.watchPattern,
            isBreakpointPrompt: msg.isBreakpointPrompt,
            breakpointInfo: msg.breakpointFile ? { file: msg.breakpointFile, line: msg.breakpointLine || 0 } : undefined,
            isAutoTrigger: msg.isAutoTrigger,
          }));
          setMessages(loaded);
        }
        setHistoryLoaded(true);
      })
      .catch(() => {
        setHistoryLoaded(true);
      });
  }, [historyLoaded]);

  // Add CLI output as a chat message (for interactive mode)
  const addCliOutput = useCallback((content: string, isStderr = false) => {
    const cliMessage: ChatMessage = {
      id: `cli-${Date.now()}`,
      role: 'assistant',
      content,
      isCliOutput: true,
    };
    setMessages(prev => [...prev, cliMessage]);

    // Also store on server for persistence
    fetch(`${API_BASE}/chat-cli-output`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, isStderr }),
    }).catch(() => {});
  }, []);

  // Add CLI input as a user message (for interactive mode)
  const addCliInput = useCallback((content: string) => {
    const cliMessage: ChatMessage = {
      id: `cli-input-${Date.now()}`,
      role: 'user',
      content,
      isCliInput: true,
    };
    setMessages(prev => [...prev, cliMessage]);
  }, []);

  const sendMessage = useCallback(async (message: string, options?: { isWatchTrigger?: boolean; watchPattern?: string; isBreakpointPrompt?: boolean; breakpointInfo?: { file: string; line: number }; isAutoTrigger?: boolean; isCliInput?: boolean; skipUserBubble?: boolean }) => {
    // Only add user message if not skipping (auto-continue skips user bubble)
    if (!options?.skipUserBubble) {
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user' as const,
        content: message,
        isWatchTrigger: options?.isWatchTrigger,
        watchPattern: options?.watchPattern,
        isBreakpointPrompt: options?.isBreakpointPrompt,
        breakpointInfo: options?.breakpointInfo,
        isAutoTrigger: options?.isAutoTrigger,
      };
      setMessages(prev => [...prev, userMessage]);
    }

    setIsLoading(true);

    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant' as const,
      content: '',
      isWatchTrigger: options?.isWatchTrigger,
      watchPattern: options?.watchPattern,
      isBreakpointPrompt: options?.isBreakpointPrompt,
      breakpointInfo: options?.breakpointInfo,
      isAutoTrigger: options?.isAutoTrigger,
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      abortControllerRef.current = new AbortController();

      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          skipUserStorage: options?.skipUserBubble,
          // Pass metadata for persistence on refresh
          isWatchTrigger: options?.isWatchTrigger,
          watchPattern: options?.watchPattern,
          isBreakpointPrompt: options?.isBreakpointPrompt,
          breakpointFile: options?.breakpointInfo?.file,
          breakpointLine: options?.breakpointInfo?.line,
          isAutoTrigger: options?.isAutoTrigger,
        }),
        signal: abortControllerRef.current.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'text') {
                  fullText += data.content;
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (updated[lastIdx]?.role === 'assistant') {
                      updated[lastIdx] = { ...updated[lastIdx], content: fullText };
                    }
                    return updated;
                  });
                } else if (data.type === 'tool') {
                  const toolName = data.name.replace(/^mcp__[^_]+__/, '');
                  // Truncate values to keep display compact and regex-safe
                  const truncate = (val: unknown, maxLen = 50): string => {
                    const str = typeof val === 'string' ? val : JSON.stringify(val);
                    // Remove newlines, collapse whitespace, strip ) to prevent regex breakage
                    const clean = str.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/[()]/g, '');
                    return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
                  };
                  const inputs = Object.entries(data.input || {})
                    .map(([k, v]) => `${k}: ${truncate(v)}`)
                    .join(', ');
                  fullText += `\n\n🔧 **${toolName}**${inputs ? ` (${inputs})` : ''}\n\n`;
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (updated[lastIdx]?.role === 'assistant') {
                      updated[lastIdx] = { ...updated[lastIdx], content: fullText };
                    }
                    return updated;
                  });
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx] = { ...updated[lastIdx], content: `Error: ${(err as Error).message}` };
          }
          return updated;
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, []);

  const stopResponse = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }, []);

  const clearMessages = useCallback(async () => {
    setMessages([]);
    // Also reset on server
    try {
      await fetch(`${API_BASE}/reset-conversation`, { method: 'POST' });
    } catch {
      // Ignore
    }
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    stopResponse,
    clearMessages,
    addCliOutput,
    addCliInput,
  };
}
