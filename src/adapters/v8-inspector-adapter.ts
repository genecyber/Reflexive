/**
 * V8InspectorAdapter - Debug adapter for Node.js using V8 Inspector Protocol
 *
 * Connects to Node.js processes via the Chrome DevTools Protocol (CDP)
 * to provide debugging capabilities. This is a refactored version of RemoteDebugger
 * that implements the common DebugAdapter interface.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { resolve } from 'path';
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
 * Internal V8 script info
 */
interface V8ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  endLine: number;
  hash: string;
}

/**
 * Internal V8 call frame from CDP
 */
interface V8CallFrame {
  callFrameId: string;
  functionName: string;
  url: string;
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  };
  scopeChain: Array<{
    type: string;
    name?: string;
    object: {
      objectId?: string;
      type: string;
      className?: string;
    };
  }>;
}

/**
 * V8 Inspector Adapter
 *
 * Implements the DebugAdapter interface for Node.js debugging via V8 Inspector Protocol.
 */
export class V8InspectorAdapter extends EventEmitter implements DebugAdapter {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private scripts = new Map<string, V8ScriptInfo>();
  private breakpoints = new Map<string, BreakpointInfo>();
  private _connected = false;
  private _paused = false;
  private currentCallFrames: V8CallFrame[] | null = null;
  private pauseReason: string | null = null;

  // Store scope object IDs for variable lookup
  private scopeObjectIds = new Map<number, string>();
  private nextScopeRef = 1;

  /**
   * Connect to V8 Inspector via WebSocket
   */
  async connect(options: DebugConnectionOptions): Promise<void> {
    const wsUrl = options.wsUrl;
    if (!wsUrl) {
      throw new Error('V8InspectorAdapter requires wsUrl in connection options');
    }

    const timeout = options.timeout || 5000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Debugger connection timeout'));
      }, timeout);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        clearTimeout(timer);
        this._connected = true;
        resolve();
      });

      this.ws.on('error', (err: Error) => {
        clearTimeout(timer);
        this._connected = false;
        reject(err);
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(JSON.parse(data.toString()));
      });

      this.ws.on('close', () => {
        this._connected = false;
        this.emit('disconnected');
      });
    });
  }

  /**
   * Handle incoming CDP messages
   */
  private handleMessage(msg: {
    id?: number;
    method?: string;
    params?: unknown;
    error?: { message: string };
    result?: unknown;
  }): void {
    if (msg.id !== undefined) {
      // Response to a command
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (msg.method) {
      // Event notification
      this.handleEvent(msg.method, msg.params);
    }
  }

  /**
   * Handle CDP events
   */
  private handleEvent(method: string, params: unknown): void {
    const p = params as Record<string, unknown>;

    switch (method) {
      case 'Debugger.paused': {
        this._paused = true;
        this.currentCallFrames = p.callFrames as V8CallFrame[];
        this.pauseReason = p.reason as string;

        const eventData: PausedEventData = {
          reason: this.mapPauseReason(p.reason as string),
          threadId: 1, // V8 is single-threaded
          allThreadsStopped: true,
          hitBreakpointIds: (p.hitBreakpoints as string[]) || [],
        };

        this.emit('paused', eventData);
        break;
      }

      case 'Debugger.resumed':
        this._paused = false;
        this.currentCallFrames = null;
        this.pauseReason = null;
        this.emit('resumed');
        break;

      case 'Debugger.scriptParsed': {
        const scriptParams = p as {
          scriptId: string;
          url: string;
          startLine: number;
          endLine: number;
          hash: string;
        };
        this.scripts.set(scriptParams.scriptId, {
          scriptId: scriptParams.scriptId,
          url: scriptParams.url,
          startLine: scriptParams.startLine,
          endLine: scriptParams.endLine,
          hash: scriptParams.hash,
        });
        break;
      }

      case 'Debugger.breakpointResolved': {
        const bpParams = p as {
          breakpointId: string;
          location: { lineNumber: number };
        };
        this.emit('breakpointResolved', bpParams.breakpointId, bpParams.location.lineNumber + 1, true);
        break;
      }

      case 'Runtime.consoleAPICalled': {
        const consoleParams = p as {
          type: string;
          args: Array<{ value?: unknown; description?: string }>;
        };
        const output = consoleParams.args.map(a => a.value ?? a.description ?? '').join(' ');
        this.emit('output', consoleParams.type, output);
        break;
      }

      default:
        // Forward unknown events
        this.emit(method, params);
    }
  }

  /**
   * Map V8 pause reasons to DAP-compatible reasons
   */
  private mapPauseReason(v8Reason: string): PausedEventData['reason'] {
    const mapping: Record<string, PausedEventData['reason']> = {
      'Break on start': 'entry',
      'debugCommand': 'pause',
      'other': 'breakpoint',
      'exception': 'exception',
      'XHR': 'breakpoint',
      'DOM': 'breakpoint',
      'EventListener': 'breakpoint',
      'instrumentation': 'function breakpoint',
    };
    return mapping[v8Reason] || 'breakpoint';
  }

  /**
   * Send a command to the debugger
   */
  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this._connected || !this.ws) {
        reject(new Error('Not connected to debugger'));
        return;
      }

      const id = ++this.messageId;
      this.pending.set(id, { resolve, reject });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Disconnect from debugger
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this._paused = false;
    this.currentCallFrames = null;
    this.breakpoints.clear();
    this.scripts.clear();
    this.scopeObjectIds.clear();
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
   */
  async initialize(): Promise<void> {
    await this.send('Debugger.enable');
    await this.send('Runtime.enable');
    // Don't pause on exceptions by default
    await this.send('Debugger.setPauseOnExceptions', { state: 'none' });
  }

  /**
   * Launch/start execution (for --inspect-brk)
   */
  async launch(_config?: Record<string, unknown>): Promise<void> {
    await this.send('Runtime.runIfWaitingForDebugger');
  }

  // ─────────────────────────────────────────────────────────────────
  // Breakpoint Management
  // ─────────────────────────────────────────────────────────────────

  /**
   * Set a breakpoint
   */
  async setBreakpoint(file: string, line: number, condition?: string): Promise<BreakpointResult> {
    // Convert to absolute file URL
    const url = file.startsWith('file://') ? file : `file://${resolve(file)}`;

    const result = (await this.send('Debugger.setBreakpointByUrl', {
      lineNumber: line - 1, // Convert to 0-based
      url: url,
      condition: condition || '',
    })) as { breakpointId: string; locations: Array<{ lineNumber: number; columnNumber: number }> };

    // Track the breakpoint
    const info: BreakpointInfo = {
      id: result.breakpointId,
      file: file,
      line: line,
      condition: condition || null,
      verified: result.locations.length > 0,
    };
    this.breakpoints.set(result.breakpointId, info);

    return {
      breakpointId: result.breakpointId,
      verified: result.locations.length > 0,
      line: result.locations[0]?.lineNumber !== undefined ? result.locations[0].lineNumber + 1 : line,
      column: result.locations[0]?.columnNumber,
    };
  }

  /**
   * Remove a breakpoint
   */
  async removeBreakpoint(breakpointId: string): Promise<void> {
    await this.send('Debugger.removeBreakpoint', { breakpointId });
    this.breakpoints.delete(breakpointId);
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
    const toRemove = Array.from(this.breakpoints.values()).filter(bp => bp.file === file);
    for (const bp of toRemove) {
      await this.removeBreakpoint(bp.id);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Execution Control
  // ─────────────────────────────────────────────────────────────────

  /**
   * Resume execution
   */
  async resume(_threadId?: number): Promise<void> {
    await this.send('Debugger.resume');
  }

  /**
   * Pause execution
   */
  async pause(_threadId?: number): Promise<void> {
    await this.send('Debugger.pause');
  }

  /**
   * Step over
   */
  async stepOver(_threadId?: number): Promise<void> {
    if (!this._paused) return;
    await this.send('Debugger.stepOver');
  }

  /**
   * Step into
   */
  async stepInto(_threadId?: number): Promise<void> {
    if (!this._paused) return;
    await this.send('Debugger.stepInto');
  }

  /**
   * Step out
   */
  async stepOut(_threadId?: number): Promise<void> {
    if (!this._paused) return;
    await this.send('Debugger.stepOut');
  }

  // ─────────────────────────────────────────────────────────────────
  // Inspection
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the call stack
   */
  async getCallStack(_threadId?: number): Promise<StackFrame[]> {
    if (!this._paused || !this.currentCallFrames) {
      return [];
    }

    return this.currentCallFrames.map((frame, index) => {
      // Extract file path from URL
      let sourcePath = frame.url;
      if (sourcePath.startsWith('file://')) {
        sourcePath = sourcePath.slice(7);
      }

      return {
        id: frame.callFrameId,
        name: frame.functionName || '(anonymous)',
        source: {
          path: sourcePath,
          name: sourcePath.split('/').pop() || sourcePath,
        },
        line: frame.location.lineNumber + 1, // Convert to 1-based
        column: frame.location.columnNumber,
      };
    });
  }

  /**
   * Get scopes for a frame
   */
  async getScopes(frameId: string): Promise<Scope[]> {
    if (!this._paused || !this.currentCallFrames) {
      return [];
    }

    const frame = this.currentCallFrames.find(f => f.callFrameId === frameId);
    if (!frame) {
      return [];
    }

    return frame.scopeChain.map(scope => {
      // Create a reference for this scope's object
      let variablesReference = 0;
      if (scope.object.objectId) {
        variablesReference = this.nextScopeRef++;
        this.scopeObjectIds.set(variablesReference, scope.object.objectId);
      }

      return {
        name: scope.name || this.getScopeName(scope.type),
        type: scope.type as Scope['type'],
        variablesReference,
        expensive: scope.type === 'global',
      };
    });
  }

  /**
   * Get human-readable scope name
   */
  private getScopeName(type: string): string {
    const names: Record<string, string> = {
      local: 'Local',
      closure: 'Closure',
      global: 'Global',
      with: 'With',
      block: 'Block',
      script: 'Script',
      catch: 'Catch',
    };
    return names[type] || type;
  }

  /**
   * Get variables for a scope reference
   */
  async getVariables(variablesReference: number): Promise<Variable[]> {
    const objectId = this.scopeObjectIds.get(variablesReference);
    if (!objectId) {
      return [];
    }

    const result = (await this.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
    })) as {
      result: Array<{
        name: string;
        value?: {
          type: string;
          value?: unknown;
          description?: string;
          objectId?: string;
        };
      }>;
    };

    return result.result.map(prop => {
      let variablesReference = 0;

      // If this is an object, create a reference for expanding it
      if (prop.value?.objectId && prop.value.type === 'object') {
        variablesReference = this.nextScopeRef++;
        this.scopeObjectIds.set(variablesReference, prop.value.objectId);
      }

      return {
        name: prop.name,
        value: this.formatValue(prop.value),
        type: prop.value?.type,
        variablesReference,
      };
    });
  }

  /**
   * Format a V8 value for display
   */
  private formatValue(value?: { type: string; value?: unknown; description?: string }): string {
    if (!value) return 'undefined';

    if (value.type === 'undefined') return 'undefined';
    if (value.type === 'null') return 'null';
    if (value.type === 'string') return JSON.stringify(value.value);
    if (value.type === 'number' || value.type === 'boolean') return String(value.value);
    if (value.type === 'function') return value.description || '[Function]';
    if (value.type === 'object') return value.description || '[Object]';

    return value.description || String(value.value);
  }

  /**
   * Evaluate an expression
   */
  async evaluate(
    expression: string,
    frameId?: string,
    _context?: 'watch' | 'repl' | 'hover'
  ): Promise<EvaluateResult> {
    let result: {
      result: {
        type: string;
        value?: unknown;
        description?: string;
        objectId?: string;
      };
      exceptionDetails?: { text: string };
    };

    if (frameId && this._paused) {
      result = (await this.send('Debugger.evaluateOnCallFrame', {
        callFrameId: frameId,
        expression,
        returnByValue: false,
      })) as typeof result;
    } else {
      result = (await this.send('Runtime.evaluate', {
        expression,
        returnByValue: false,
      })) as typeof result;
    }

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text);
    }

    let variablesReference = 0;
    if (result.result.objectId && result.result.type === 'object') {
      variablesReference = this.nextScopeRef++;
      this.scopeObjectIds.set(variablesReference, result.result.objectId);
    }

    return {
      result: this.formatValue(result.result),
      type: result.result.type,
      variablesReference,
    };
  }

  /**
   * Get threads (V8 is single-threaded)
   */
  async getThreads(): Promise<Thread[]> {
    return [{ id: 1, name: 'Main Thread' }];
  }

  /**
   * Get current thread ID
   */
  getCurrentThreadId(): number {
    return 1;
  }

  // ─────────────────────────────────────────────────────────────────
  // Legacy compatibility methods (for existing ProcessManager)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Enable debugger domains (legacy)
   * @deprecated Use initialize() instead
   */
  async enable(): Promise<void> {
    return this.initialize();
  }

  /**
   * Run if waiting for debugger (legacy)
   * @deprecated Use launch() instead
   */
  async runIfWaitingForDebugger(): Promise<void> {
    return this.launch();
  }

  /**
   * Get call stack in legacy format
   * @deprecated Use getCallStack() instead
   */
  getLegacyCallStack(): Array<{
    callFrameId: string;
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    scopeChain: Array<{ type: string; name?: string; objectId?: string }>;
  }> | null {
    if (!this._paused || !this.currentCallFrames) {
      return null;
    }

    return this.currentCallFrames.map(frame => ({
      callFrameId: frame.callFrameId,
      functionName: frame.functionName || '(anonymous)',
      url: frame.url,
      lineNumber: frame.location.lineNumber + 1,
      columnNumber: frame.location.columnNumber,
      scopeChain: frame.scopeChain.map(scope => ({
        type: scope.type,
        name: scope.name,
        objectId: scope.object.objectId,
      })),
    }));
  }

  /**
   * Get scope variables in legacy format
   * @deprecated Use getScopes() and getVariables() instead
   */
  async getLegacyScopeVariables(
    callFrameId: string,
    scopeType = 'local'
  ): Promise<Array<{ name: string; type?: string; value?: unknown; description?: string }> | null> {
    if (!this._paused || !this.currentCallFrames) {
      return null;
    }

    const frame = this.currentCallFrames.find(f => f.callFrameId === callFrameId);
    if (!frame) return null;

    const scope = frame.scopeChain.find(s => s.type === scopeType);
    if (!scope || !scope.object.objectId) return null;

    const result = (await this.send('Runtime.getProperties', {
      objectId: scope.object.objectId,
      ownProperties: true,
    })) as {
      result: Array<{
        name: string;
        value?: { type?: string; value?: unknown; description?: string };
      }>;
    };

    return result.result.map(prop => ({
      name: prop.name,
      type: prop.value?.type,
      value: prop.value?.value,
      description: prop.value?.description,
    }));
  }
}

// Re-export types for convenience
export type {
  BreakpointInfo,
  StackFrame as CallFrame,
} from '../types/debug.js';
