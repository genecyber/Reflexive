/**
 * Manager interface type definitions
 */

import type { LogEntry, AppStatus, SandboxConfig, ProcessState } from './index.js';
import type { SandboxInstance, Snapshot, SandboxFile, CommandResult } from './sandbox.js';

/**
 * Event handler type for manager events
 */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * Base manager interface for all manager types
 */
export interface BaseManager {
  // Lifecycle
  start(entryFile: string, args?: string[]): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;

  // State
  isRunning(): boolean;
  getStatus(): AppStatus | ProcessState;
  getLogs(count?: number, filter?: string): LogEntry[];
  searchLogs(query: string): LogEntry[];
  getCustomState(key?: string): unknown;

  // Events
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  emit(event: string, data: unknown): void;
}

/**
 * Interface for sandbox manager (single sandbox control)
 */
export interface SandboxManagerInterface extends BaseManager {
  create(): Promise<void>;
  destroy(): Promise<void>;
  isCreated(): boolean;
  getSandbox(): unknown; // Returns the underlying sandbox object

  // File operations
  uploadFiles(files: SandboxFile[]): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(path: string): Promise<string[]>;

  // Command execution
  runCommand(cmd: string, args?: string[]): Promise<CommandResult>;

  // Log polling (for sandbox mode)
  pollLogs(): Promise<void>;
}

/**
 * Interface for multi-sandbox manager (hosted mode)
 */
export interface MultiSandboxManagerInterface {
  // Sandbox lifecycle
  create(id: string, config: SandboxConfig): Promise<SandboxInstance>;
  start(id: string, entryFile: string, args?: string[]): Promise<void>;
  stop(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  destroyAll(): Promise<void>;

  // Snapshot operations
  snapshot(id: string): Promise<{ snapshotId: string }>;
  resume(snapshotId: string): Promise<{ id: string }>;
  listSnapshots(): Promise<Snapshot[]>;
  deleteSnapshot(snapshotId: string): Promise<void>;

  // Query operations
  list(): SandboxInstance[];
  get(id: string): SandboxInstance | undefined;
  getLogs(id: string, count?: number): LogEntry[];
  getCustomState(id: string, key?: string): unknown;

  // File operations
  uploadFiles(id: string, files: SandboxFile[]): Promise<void>;
  readFile(id: string, path: string): Promise<string>;
  writeFile(id: string, path: string, content: string): Promise<void>;

  // Command execution
  runCommand(id: string, cmd: string, args?: string[]): Promise<CommandResult>;
}

/**
 * Process manager specific interface (local mode)
 */
export interface ProcessManagerInterface extends BaseManager {
  // Process control
  send(message: string): void;
  sendInput(text: string, addNewline?: boolean): boolean;

  // Injection
  evaluate(code: string, timeout?: number): Promise<unknown>;
  queryInjectedState(): void;
  getInjectedState(): Record<string, unknown>;

  // Debugging
  debugSetBreakpoint(file: string, line: number, condition?: string): Promise<{ breakpointId: string }>;
  debugRemoveBreakpoint(breakpointId: string): Promise<void>;
  debugListBreakpoints(): Array<{ id: string; file: string; line: number; condition?: string }>;
  debugResume(): Promise<void>;
  debugPause(): Promise<void>;
  debugStepOver(): Promise<void>;
  debugStepInto(): Promise<void>;
  debugStepOut(): Promise<void>;
  debugEvaluate(expression: string, callFrameId?: string): Promise<unknown>;
  debugGetCallStack(): unknown;
  debugGetScopeVariables(callFrameId: string, scopeType?: string): Promise<unknown>;
  isDebuggerPaused(): boolean;
  isDebuggerConnected(): boolean;
  getDebuggerState(): {
    connected: boolean;
    paused: boolean;
    inspectorUrl: string | null;
    breakpoints: unknown[];
    callStack: unknown;
  };
}
