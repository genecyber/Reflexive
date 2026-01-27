/**
 * Core type definitions for Reflexive
 */

export type LogType = 'info' | 'warn' | 'error' | 'debug' | 'stdout' | 'stderr' | 'system' | 'stdin' | 'breakpoint-prompt';

export interface LogEntry {
  type: LogType | string; // Allow inject:* types
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface AppStatus {
  pid: number;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  customState: Record<string, unknown>;
  startTime: number;
}

export interface ProcessState {
  isRunning: boolean;
  pid: number | null;
  uptime: number;
  restartCount: number;
  exitCode: number | null;
  entry: string;
  cwd: string;
  interactive: boolean;
  waitingForInput: boolean;
  inject: boolean;
  injectionReady: boolean;
  injectedState?: Record<string, unknown>;
  clientState?: Record<string, unknown>;
  debug: boolean;
  debuggerConnected: boolean;
  debuggerPaused: boolean;
  inspectorUrl: string | null;
}

export interface Capabilities {
  readFiles: boolean;
  writeFiles: boolean;
  shellAccess: boolean;
  restart: boolean;
  inject: boolean;  // Required by cli.ts capabilities initialization
  eval: boolean;
  debug: boolean;
}

export interface CustomTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

export interface ReflexiveConfig {
  mode: 'local' | 'sandbox' | 'hosted';
  port: number;
  sandbox?: SandboxConfig;
  hosted?: HostedConfig;
  capabilities: Capabilities;
  tools?: CustomTool[];
}

export interface SandboxConfig {
  provider: 'vercel';
  vcpus: number;
  memory: number;
  timeout: string | number;
  runtime: 'node22' | 'node20';
}

export interface HostedConfig {
  maxSandboxes: number;
  defaultTimeout: string;
  snapshotStorage: StorageConfig;
}

export interface StorageConfig {
  provider: 's3' | 'r2' | 'memory';
  bucket?: string;
  endpoint?: string;
}

// Re-export from submodules
export * from './sandbox.js';
export * from './manager.js';
export * from './mcp.js';
