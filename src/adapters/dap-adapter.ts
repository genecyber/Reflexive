/**
 * DAPAdapter - Debug Adapter Protocol client for multi-language debugging
 *
 * Connects to DAP-compliant debug servers (debugpy, delve, netcoredbg, codelldb, etc.)
 * to provide debugging capabilities for Python, Go, .NET, Rust, and other languages.
 */

import { EventEmitter } from 'events';
import { SocketDebugClient, LogLevel } from 'node-debugprotocol-client';
import type {
  DebugAdapter,
  DebugConnectionOptions,
  BreakpointResult,
  BreakpointInfo,
  StackFrame,
  Scope,
  Variable,
  EvaluateResult,
  Thread,
  PausedEventData,
} from '../types/debug.js';

/**
 * Internal breakpoint tracking with DAP details
 */
interface TrackedBreakpoint extends BreakpointInfo {
  sourceReference?: number;
}

/**
 * DAP Adapter
 *
 * Implements the DebugAdapter interface using the Debug Adapter Protocol.
 * Works with any DAP-compliant debugger: debugpy, delve, netcoredbg, codelldb, etc.
 */
export class DAPAdapter extends EventEmitter implements DebugAdapter {
  private client: SocketDebugClient | null = null;
  private _connected = false;
  private _paused = false;
  private _initialized = false;
  private currentThreadId: number = 1;
  private breakpoints = new Map<string, TrackedBreakpoint>();
  private breakpointsByFile = new Map<string, TrackedBreakpoint[]>();
  private nextBreakpointId = 1;

  // Store pending configuration for launch
  private launchConfig: Record<string, unknown> | null = null;
  // Store connection info for attach request
  private connectionHost: string = 'localhost';
  private connectionPort: number = 0;

  /**
   * Connect to DAP server
   */
  async connect(options: DebugConnectionOptions): Promise<void> {
    const port = options.port;
    const host = options.host || 'localhost';
    const timeout = options.timeout || 10000;

    if (!port) {
      throw new Error('DAPAdapter requires port in connection options');
    }

    // Store for attach request
    this.connectionHost = host;
    this.connectionPort = port;

    this.client = new SocketDebugClient({
      port,
      host,
      logLevel: LogLevel.Off,
      loggerName: 'reflexive-dap',
    });

    // Set up event handlers before connecting
    this.setupEventHandlers();

    // Connect with timeout
    const connectPromise = this.client.connectAdapter();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('DAP connection timeout')), timeout);
    });

    await Promise.race([connectPromise, timeoutPromise]);
    this._connected = true;
  }

  /**
   * Set up DAP event handlers
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // Stopped event (breakpoint hit, step complete, etc.)
    this.client.onStopped((event) => {
      this._paused = true;
      this.currentThreadId = event.threadId || 1;

      const eventData: PausedEventData = {
        reason: event.reason as PausedEventData['reason'],
        description: event.description,
        threadId: event.threadId,
        allThreadsStopped: event.allThreadsStopped,
        hitBreakpointIds: event.hitBreakpointIds?.map(String),
        text: event.text,
      };

      this.emit('paused', eventData);
    });

    // Continued event
    this.client.onContinued((event) => {
      this._paused = false;
      if (event.allThreadsContinued !== false) {
        this.emit('resumed');
      }
    });

    // Thread events
    this.client.onThread((event) => {
      if (event.reason === 'started') {
        this.emit('threadStarted', event.threadId);
      } else if (event.reason === 'exited') {
        this.emit('threadExited', event.threadId);
      }
    });

    // Output event
    this.client.onOutput((event) => {
      this.emit('output', event.category || 'console', event.output, event.source?.path, event.line);
    });

    // Breakpoint event (verified, changed location, etc.)
    this.client.onBreakpoint((event) => {
      if (event.breakpoint.id !== undefined) {
        this.emit(
          'breakpointResolved',
          String(event.breakpoint.id),
          event.breakpoint.line || 0,
          event.breakpoint.verified || false
        );
      }
    });

    // Terminated/exited events
    this.client.onTerminated(() => {
      this._connected = false;
      this.emit('disconnected');
    });

    this.client.onExited(() => {
      this._connected = false;
      this.emit('disconnected');
    });
  }

  /**
   * Disconnect from DAP server
   */
  disconnect(): void {
    if (this.client) {
      try {
        this.client.disconnectAdapter();
      } catch {
        // Ignore disconnect errors
      }
      this.client = null;
    }
    this._connected = false;
    this._paused = false;
    this._initialized = false;
    this.breakpoints.clear();
    this.breakpointsByFile.clear();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this._connected;
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this._paused;
  }

  /**
   * Initialize the debug session
   *
   * DAP sequence: initialize → attach → (wait for initialized event) → configurationDone
   */
  async initialize(): Promise<void> {
    if (!this.client || this._initialized) return;

    // Set up promise to wait for initialized event
    const initializedPromise = new Promise<void>((resolve) => {
      this.client!.onInitialized(() => {
        resolve();
      }, true); // 'true' = once
    });

    // Send initialize request
    await this.client.initialize({
      clientID: 'reflexive',
      clientName: 'Reflexive Debugger',
      adapterID: 'reflexive',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: false,
      supportsRunInTerminalRequest: false,
      supportsProgressReporting: false,
    });

    // Send attach request - for debugpy with --wait-for-client, this tells it we're connected
    // debugpy expects a 'connect' object with host and port per VSCode's configuration spec
    await this.client.attach({
      connect: {
        host: this.connectionHost,
        port: this.connectionPort,
      },
    } as Record<string, unknown>);

    // Wait for initialized event (with timeout)
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for initialized event')), 5000);
    });

    await Promise.race([initializedPromise, timeoutPromise]);

    // Now send configurationDone to signal we're ready for execution to continue
    await this.client.configurationDone({});

    this._initialized = true;
  }

  /**
   * Launch or attach to the debuggee (no-op since initialization handles this)
   */
  async launch(_config?: Record<string, unknown>): Promise<void> {
    // Initialization already sent attach and configurationDone
    // This method exists for interface compatibility
  }

  // ─────────────────────────────────────────────────────────────────
  // Breakpoint Management
  // ─────────────────────────────────────────────────────────────────

  /**
   * Set a breakpoint
   */
  async setBreakpoint(file: string, line: number, condition?: string): Promise<BreakpointResult> {
    if (!this.client) {
      throw new Error('Not connected to DAP server');
    }

    // Get existing breakpoints for this file
    const existing = this.breakpointsByFile.get(file) || [];

    // Create new breakpoint
    const id = `bp_${this.nextBreakpointId++}`;
    const newBp: TrackedBreakpoint = {
      id,
      file,
      line,
      condition: condition || null,
      verified: false,
    };

    // Add to our tracking
    const allBps = [...existing, newBp];
    this.breakpointsByFile.set(file, allBps);
    this.breakpoints.set(id, newBp);

    // Send all breakpoints for this file to DAP server
    const response = await this.client.setBreakpoints({
      source: { path: file },
      breakpoints: allBps.map((bp) => ({
        line: bp.line,
        condition: bp.condition || undefined,
      })),
    });

    // Update verification status
    const resultBp = response.breakpoints[allBps.length - 1];
    if (resultBp) {
      newBp.verified = resultBp.verified || false;
      newBp.line = resultBp.line || line;

      return {
        breakpointId: id,
        verified: resultBp.verified || false,
        line: resultBp.line,
        column: resultBp.column,
        message: resultBp.message,
      };
    }

    return {
      breakpointId: id,
      verified: false,
      line,
    };
  }

  /**
   * Remove a breakpoint
   */
  async removeBreakpoint(breakpointId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to DAP server');
    }

    const bp = this.breakpoints.get(breakpointId);
    if (!bp) return;

    // Remove from our tracking
    this.breakpoints.delete(breakpointId);
    const fileBps = this.breakpointsByFile.get(bp.file) || [];
    const remaining = fileBps.filter((b) => b.id !== breakpointId);

    if (remaining.length === 0) {
      this.breakpointsByFile.delete(bp.file);
    } else {
      this.breakpointsByFile.set(bp.file, remaining);
    }

    // Update DAP server with remaining breakpoints for this file
    await this.client.setBreakpoints({
      source: { path: bp.file },
      breakpoints: remaining.map((b) => ({
        line: b.line,
        condition: b.condition || undefined,
      })),
    });
  }

  /**
   * List all breakpoints
   */
  listBreakpoints(): BreakpointInfo[] {
    return Array.from(this.breakpoints.values());
  }

  /**
   * Clear all breakpoints in a file
   */
  async clearBreakpoints(file: string): Promise<void> {
    if (!this.client) return;

    // Remove from tracking
    const fileBps = this.breakpointsByFile.get(file) || [];
    for (const bp of fileBps) {
      this.breakpoints.delete(bp.id);
    }
    this.breakpointsByFile.delete(file);

    // Clear on DAP server
    await this.client.setBreakpoints({
      source: { path: file },
      breakpoints: [],
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Execution Control
  // ─────────────────────────────────────────────────────────────────

  /**
   * Resume execution
   */
  async resume(threadId?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to DAP server');
    }
    await this.client.continue({ threadId: threadId || this.currentThreadId });
  }

  /**
   * Pause execution
   */
  async pause(threadId?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to DAP server');
    }
    await this.client.pause({ threadId: threadId || this.currentThreadId });
  }

  /**
   * Step over
   */
  async stepOver(threadId?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to DAP server');
    }
    await this.client.next({ threadId: threadId || this.currentThreadId });
  }

  /**
   * Step into
   */
  async stepInto(threadId?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to DAP server');
    }
    await this.client.stepIn({ threadId: threadId || this.currentThreadId });
  }

  /**
   * Step out
   */
  async stepOut(threadId?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to DAP server');
    }
    await this.client.stepOut({ threadId: threadId || this.currentThreadId });
  }

  // ─────────────────────────────────────────────────────────────────
  // Inspection
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the call stack
   */
  async getCallStack(threadId?: number): Promise<StackFrame[]> {
    if (!this.client) {
      return [];
    }

    const response = await this.client.stackTrace({
      threadId: threadId || this.currentThreadId,
      startFrame: 0,
      levels: 100, // Get up to 100 frames
    });

    return response.stackFrames.map((frame: {
      id: number;
      name: string;
      source?: { path?: string; name?: string; sourceReference?: number };
      line: number;
      column: number;
      moduleId?: string | number;
    }) => ({
      id: String(frame.id),
      name: frame.name,
      source: frame.source
        ? {
            path: frame.source.path,
            name: frame.source.name,
            sourceReference: frame.source.sourceReference,
          }
        : undefined,
      line: frame.line,
      column: frame.column,
      moduleId: frame.moduleId,
    }));
  }

  /**
   * Get scopes for a frame
   */
  async getScopes(frameId: string): Promise<Scope[]> {
    if (!this.client) {
      return [];
    }

    const response = await this.client.scopes({ frameId: parseInt(frameId, 10) });

    return response.scopes.map((scope: {
      name: string;
      presentationHint?: string;
      variablesReference: number;
      expensive?: boolean;
      namedVariables?: number;
      indexedVariables?: number;
    }) => ({
      name: scope.name,
      type: this.mapScopeType(scope.presentationHint),
      variablesReference: scope.variablesReference,
      expensive: scope.expensive || false,
      namedVariables: scope.namedVariables,
      indexedVariables: scope.indexedVariables,
    }));
  }

  /**
   * Map DAP scope presentation hint to our type
   */
  private mapScopeType(hint?: string): Scope['type'] {
    if (!hint) return 'local';

    const mapping: Record<string, Scope['type']> = {
      arguments: 'arguments',
      locals: 'local',
      registers: 'local',
      globals: 'global',
    };

    return mapping[hint] || hint;
  }

  /**
   * Get variables
   */
  async getVariables(variablesReference: number): Promise<Variable[]> {
    if (!this.client || variablesReference === 0) {
      return [];
    }

    const response = await this.client.variables({ variablesReference });

    return response.variables.map((v: {
      name: string;
      value: string;
      type?: string;
      variablesReference?: number;
      namedVariables?: number;
      indexedVariables?: number;
      evaluateName?: string;
    }) => ({
      name: v.name,
      value: v.value,
      type: v.type,
      variablesReference: v.variablesReference || 0,
      namedVariables: v.namedVariables,
      indexedVariables: v.indexedVariables,
      evaluateName: v.evaluateName,
    }));
  }

  /**
   * Evaluate an expression
   */
  async evaluate(
    expression: string,
    frameId?: string,
    context?: 'watch' | 'repl' | 'hover'
  ): Promise<EvaluateResult> {
    if (!this.client) {
      throw new Error('Not connected to DAP server');
    }

    const response = await this.client.evaluate({
      expression,
      frameId: frameId ? parseInt(frameId, 10) : undefined,
      context: context || 'repl',
    });

    return {
      result: response.result,
      type: response.type,
      variablesReference: response.variablesReference || 0,
      namedVariables: response.namedVariables,
      indexedVariables: response.indexedVariables,
    };
  }

  /**
   * Get all threads
   */
  async getThreads(): Promise<Thread[]> {
    if (!this.client) {
      return [];
    }

    const response = await this.client.threads({});

    return response.threads.map((t: { id: number; name: string }) => ({
      id: t.id,
      name: t.name,
    }));
  }

  /**
   * Get current thread ID
   */
  getCurrentThreadId(): number {
    return this.currentThreadId;
  }
}
