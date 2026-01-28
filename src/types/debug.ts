/**
 * Debug Adapter type definitions for multi-language debugging support
 *
 * This module defines the common interface that all debug adapters must implement,
 * allowing Reflexive to debug Node.js (V8 Inspector), Python (debugpy), Go (delve),
 * .NET (netcoredbg), and other languages through a unified API.
 */

import type { EventEmitter } from 'events';

/**
 * Connection options for debug adapters
 */
export interface DebugConnectionOptions {
  /** For socket-based connections (DAP) */
  port?: number;
  host?: string;
  /** For WebSocket-based connections (V8 Inspector) */
  wsUrl?: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
}

/**
 * Result of setting a breakpoint
 */
export interface BreakpointResult {
  breakpointId: string;
  verified: boolean;
  line?: number;
  column?: number;
  source?: string;
  message?: string;
}

/**
 * Information about a set breakpoint
 */
export interface BreakpointInfo {
  id: string;
  file: string;
  line: number;
  column?: number;
  condition?: string | null;
  hitCondition?: string | null;
  logMessage?: string | null;
  verified: boolean;
}

/**
 * A frame in the call stack
 */
export interface StackFrame {
  id: string;
  name: string;
  source?: {
    path?: string;
    name?: string;
    sourceReference?: number;
  };
  line: number;
  column: number;
  moduleId?: string | number;
}

/**
 * Scope information within a stack frame
 */
export interface Scope {
  name: string;
  type: 'local' | 'closure' | 'global' | 'with' | 'block' | 'script' | 'catch' | 'arguments' | string;
  variablesReference: number;
  expensive: boolean;
  namedVariables?: number;
  indexedVariables?: number;
}

/**
 * A variable in a scope
 */
export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
}

/**
 * Result of evaluating an expression
 */
export interface EvaluateResult {
  result: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
}

/**
 * Thread information
 */
export interface Thread {
  id: number;
  name: string;
}

/**
 * Data emitted when debugger pauses
 */
export interface PausedEventData {
  reason: 'breakpoint' | 'step' | 'exception' | 'pause' | 'entry' | 'goto' | 'function breakpoint' | 'data breakpoint' | string;
  description?: string;
  threadId?: number;
  allThreadsStopped?: boolean;
  hitBreakpointIds?: string[];
  text?: string;
}

/**
 * Events emitted by debug adapters
 */
export interface DebugAdapterEvents {
  /** Emitted when execution pauses (breakpoint, step, exception, etc.) */
  paused: (data: PausedEventData) => void;
  /** Emitted when execution resumes */
  resumed: () => void;
  /** Emitted when adapter disconnects */
  disconnected: () => void;
  /** Emitted when a new thread starts */
  threadStarted: (threadId: number) => void;
  /** Emitted when a thread exits */
  threadExited: (threadId: number) => void;
  /** Emitted on debug output */
  output: (category: string, output: string, source?: string, line?: number) => void;
  /** Emitted when a breakpoint is resolved/verified */
  breakpointResolved: (breakpointId: string, line: number, verified: boolean) => void;
}

/**
 * Debug Adapter interface
 *
 * All debug adapters (V8 Inspector, DAP, etc.) must implement this interface.
 * This allows ProcessManager and MCP tools to work uniformly across languages.
 */
export interface DebugAdapter extends EventEmitter {
  /**
   * Connect to the debug server/runtime
   */
  connect(options: DebugConnectionOptions): Promise<void>;

  /**
   * Disconnect from the debug server
   */
  disconnect(): void;

  /**
   * Check if connected to the debug server
   */
  isConnected(): boolean;

  /**
   * Check if execution is currently paused
   */
  isPaused(): boolean;

  /**
   * Initialize the debug session (called after connect)
   * For DAP this sends initialize + configurationDone
   * For V8 this enables Debugger and Runtime domains
   */
  initialize(): Promise<void>;

  /**
   * Launch or attach to the debuggee
   * For V8 this calls runIfWaitingForDebugger
   * For DAP this sends launch/attach request
   */
  launch(config?: Record<string, unknown>): Promise<void>;

  // ─────────────────────────────────────────────────────────────────
  // Breakpoint Management
  // ─────────────────────────────────────────────────────────────────

  /**
   * Set a breakpoint at a file and line
   */
  setBreakpoint(file: string, line: number, condition?: string): Promise<BreakpointResult>;

  /**
   * Remove a breakpoint by ID
   */
  removeBreakpoint(breakpointId: string): Promise<void>;

  /**
   * List all active breakpoints
   */
  listBreakpoints(): BreakpointInfo[];

  /**
   * Clear all breakpoints in a file (optional, for DAP efficiency)
   */
  clearBreakpoints?(file: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────
  // Execution Control
  // ─────────────────────────────────────────────────────────────────

  /**
   * Resume execution
   */
  resume(threadId?: number): Promise<void>;

  /**
   * Pause execution
   */
  pause(threadId?: number): Promise<void>;

  /**
   * Step over the current statement
   */
  stepOver(threadId?: number): Promise<void>;

  /**
   * Step into a function call
   */
  stepInto(threadId?: number): Promise<void>;

  /**
   * Step out of the current function
   */
  stepOut(threadId?: number): Promise<void>;

  // ─────────────────────────────────────────────────────────────────
  // Inspection
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the current call stack
   */
  getCallStack(threadId?: number): Promise<StackFrame[]>;

  /**
   * Get scopes for a stack frame
   */
  getScopes(frameId: string): Promise<Scope[]>;

  /**
   * Get variables in a scope
   */
  getVariables(variablesReference: number): Promise<Variable[]>;

  /**
   * Evaluate an expression in the current context
   */
  evaluate(expression: string, frameId?: string, context?: 'watch' | 'repl' | 'hover'): Promise<EvaluateResult>;

  // ─────────────────────────────────────────────────────────────────
  // Threading (optional, mainly for multi-threaded runtimes)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get all threads
   */
  getThreads?(): Promise<Thread[]>;

  /**
   * Get the current/primary thread ID
   */
  getCurrentThreadId?(): number | undefined;
}

/**
 * Configuration for a language runtime
 */
export interface LanguageRuntime {
  /** Runtime identifier */
  name: string;

  /** Display name for UI */
  displayName: string;

  /** File extensions this runtime handles (e.g., ['.py', '.pyw']) */
  extensions: string[];

  /** The command to execute (e.g., 'python', 'go', 'dotnet') */
  command: string;

  /**
   * Build the arguments to spawn the process with debugging enabled
   * @param port - The debug port to use
   * @param entryFile - The file to run
   * @param args - Additional arguments to pass to the program
   */
  buildArgs(port: number, entryFile: string, args?: string[]): string[];

  /**
   * Build environment variables for the debug session
   */
  buildEnv?(port: number): Record<string, string>;

  /**
   * Parse debug connection info from process output
   * Returns the connection options when the debugger is ready, null otherwise
   */
  parseDebugReady(output: string, port: number): DebugConnectionOptions | null;

  /**
   * Create the appropriate debug adapter for this runtime
   */
  createAdapter(): DebugAdapter;

  /**
   * Default debug port (will be overridden if port is in use)
   */
  defaultPort: number;

  /**
   * Whether this runtime uses DAP or a custom protocol
   */
  protocol: 'dap' | 'v8-inspector' | 'gdb-mi' | 'custom';

  /**
   * Additional setup required before debugging (e.g., checking for debugpy)
   */
  validateSetup?(): Promise<{ valid: boolean; message?: string }>;
}

/**
 * Registry of available language runtimes
 */
export interface RuntimeRegistry {
  /** Get a runtime by name */
  get(name: string): LanguageRuntime | undefined;

  /** Get a runtime by file extension */
  getByExtension(ext: string): LanguageRuntime | undefined;

  /** List all registered runtimes */
  list(): LanguageRuntime[];

  /** Register a new runtime */
  register(runtime: LanguageRuntime): void;
}
