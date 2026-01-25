// Reflexive Dashboard Types

export interface LogEntry {
  type: 'info' | 'warn' | 'error' | 'debug' | 'stdout' | 'stderr' | 'system' | 'breakpoint-prompt';
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface ProcessStatus {
  pid: number;
  uptime: number;
  memoryUsage?: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  isRunning: boolean;
  restartCount: number;
  entry?: string;
  customState: Record<string, unknown>;
}

export interface Capabilities {
  readFiles: boolean;
  writeFiles: boolean;
  shellAccess: boolean;
  restart: boolean;
  networkAccess: boolean;
  inject: boolean;
  eval: boolean;
  debug: boolean;
}

export interface Watch {
  id: number;
  pattern: string;
  prompt: string;
  enabled: boolean;
  hitCount: number;
}

export interface Breakpoint {
  id: string;
  file: string;
  line: number;
  enabled: boolean;
  condition?: string;
  prompt?: string;
  promptEnabled?: boolean;
  hitCount: number;
}

export interface CallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface DebuggerStatus {
  enabled: boolean;
  connected: boolean;
  paused: boolean;
  callStack?: CallFrame[];
  triggeredPrompts?: {
    breakpoint: Breakpoint;
    callFrames: CallFrame[];
  }[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  isBreakpointPrompt?: boolean;
  breakpointInfo?: {
    file: string;
    line: number;
  };
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface DashboardConfig {
  title?: string;
  showControls: boolean;
  interactive: boolean;
  inject: boolean;
  debug: boolean;
  capabilities: Capabilities;
  apiBase: string;
}

export type LogFilter = 'all' | 'stdout' | 'stderr' | 'system' | 'inject';
