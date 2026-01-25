/**
 * RemoteDebugger - V8 Inspector Protocol client for debugging
 *
 * Connects to Node.js processes via the Chrome DevTools Protocol
 * to provide debugging capabilities like breakpoints, stepping, and evaluation.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { resolve } from 'path';

export interface BreakpointInfo {
  id: string;
  file: string;
  line: number;
  condition: string | null;
  locations: unknown[];
}

export interface CallFrame {
  callFrameId: string;
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  scopeChain: ScopeInfo[];
}

export interface ScopeInfo {
  type: string;
  name?: string;
  objectId?: string;
}

export interface ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  endLine: number;
  hash: string;
}

export interface PausedEventData {
  callFrames: CallFrame[];
  reason: string;
  hitBreakpoints: string[];
  data?: unknown;
}

export interface ScopeVariable {
  name: string;
  type?: string;
  value?: unknown;
  description?: string;
}

export interface DebuggerEvents {
  paused: (data: PausedEventData) => void;
  resumed: () => void;
  disconnected: () => void;
  scriptParsed: (data: unknown) => void;
  breakpointResolved: (data: unknown) => void;
}

export class RemoteDebugger extends EventEmitter {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private scripts = new Map<string, ScriptInfo>();
  private breakpoints = new Map<string, BreakpointInfo>();
  private connected = false;
  private paused = false;
  private currentCallFrames: CallFrame[] | null = null;
  private pauseReason: string | null = null;

  /**
   * Connect to V8 Inspector via WebSocket
   */
  async connect(wsUrl: string, timeout = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Debugger connection timeout'));
      }, timeout);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (err: Error) => {
        clearTimeout(timer);
        this.connected = false;
        reject(err);
      });

      this.ws.on('message', (data: Buffer) => {
        this._handleMessage(JSON.parse(data.toString()));
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });
    });
  }

  private _handleMessage(msg: { id?: number; method?: string; params?: unknown; error?: { message: string }; result?: unknown }): void {
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
      this._handleEvent(msg.method, msg.params);
    }
  }

  private _handleEvent(method: string, params: unknown): void {
    const p = params as Record<string, unknown>;

    switch (method) {
      case 'Debugger.paused':
        this.paused = true;
        this.currentCallFrames = p.callFrames as CallFrame[];
        this.pauseReason = p.reason as string;
        this.emit('paused', {
          callFrames: p.callFrames,
          reason: p.reason,
          hitBreakpoints: (p.hitBreakpoints as string[]) || [],
          data: p.data
        });
        break;

      case 'Debugger.resumed':
        this.paused = false;
        this.currentCallFrames = null;
        this.pauseReason = null;
        this.emit('resumed');
        break;

      case 'Debugger.scriptParsed': {
        const scriptParams = p as { scriptId: string; url: string; startLine: number; endLine: number; hash: string };
        this.scripts.set(scriptParams.scriptId, {
          scriptId: scriptParams.scriptId,
          url: scriptParams.url,
          startLine: scriptParams.startLine,
          endLine: scriptParams.endLine,
          hash: scriptParams.hash
        });
        this.emit('scriptParsed', params);
        break;
      }

      case 'Debugger.breakpointResolved':
        this.emit('breakpointResolved', params);
        break;

      default:
        this.emit(method, params);
    }
  }

  /**
   * Send a command to the debugger
   */
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws) {
        reject(new Error('Not connected to debugger'));
        return;
      }

      const id = ++this.messageId;
      this.pending.set(id, { resolve, reject });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Enable debugger and runtime
   */
  async enable(): Promise<void> {
    await this.send('Debugger.enable');
    await this.send('Runtime.enable');
    // Don't pause on exceptions by default
    await this.send('Debugger.setPauseOnExceptions', { state: 'none' });
  }

  /**
   * Start execution if waiting for debugger (--inspect-brk)
   */
  async runIfWaitingForDebugger(): Promise<void> {
    await this.send('Runtime.runIfWaitingForDebugger');
  }

  /**
   * Set a breakpoint by URL
   */
  async setBreakpoint(file: string, line: number, condition?: string): Promise<{ breakpointId: string; locations: unknown[] }> {
    // Convert to absolute file URL if not already
    const url = file.startsWith('file://') ? file : `file://${resolve(file)}`;

    const result = await this.send('Debugger.setBreakpointByUrl', {
      lineNumber: line - 1,  // Convert to 0-based
      url: url,
      condition: condition || ''
    }) as { breakpointId: string; locations: unknown[] };

    // Track the breakpoint
    this.breakpoints.set(result.breakpointId, {
      id: result.breakpointId,
      file: file,
      line: line,
      condition: condition || null,
      locations: result.locations
    });

    return {
      breakpointId: result.breakpointId,
      locations: result.locations
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
   * List all active breakpoints
   */
  listBreakpoints(): BreakpointInfo[] {
    return Array.from(this.breakpoints.values());
  }

  /**
   * Resume execution
   */
  async resume(): Promise<void> {
    // Don't check this.paused - the event might not have arrived yet
    // Let CDP handle it - will error if not paused
    await this.send('Debugger.resume');
  }

  /**
   * Pause execution
   */
  async pause(): Promise<void> {
    await this.send('Debugger.pause');
  }

  /**
   * Step over current statement
   */
  async stepOver(): Promise<void> {
    if (!this.paused) return;
    await this.send('Debugger.stepOver');
  }

  /**
   * Step into function call
   */
  async stepInto(): Promise<void> {
    if (!this.paused) return;
    await this.send('Debugger.stepInto');
  }

  /**
   * Step out of current function
   */
  async stepOut(): Promise<void> {
    if (!this.paused) return;
    await this.send('Debugger.stepOut');
  }

  /**
   * Evaluate an expression
   */
  async evaluate(expression: string, callFrameId: string | null = null): Promise<unknown> {
    if (callFrameId && this.paused) {
      return await this.send('Debugger.evaluateOnCallFrame', {
        callFrameId,
        expression,
        returnByValue: true
      });
    } else {
      return await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true
      });
    }
  }

  /**
   * Get properties of a runtime object
   */
  async getProperties(objectId: string): Promise<{ result: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string } }> }> {
    return await this.send('Runtime.getProperties', {
      objectId,
      ownProperties: true
    }) as { result: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string } }> };
  }

  /**
   * Get the current call stack
   */
  getCallStack(): CallFrame[] | null {
    if (!this.paused || !this.currentCallFrames) {
      return null;
    }

    return this.currentCallFrames.map(frame => {
      const location = frame as unknown as { location: { lineNumber: number; columnNumber: number } };
      const scopeChain = frame as unknown as { scopeChain: Array<{ type: string; name?: string; object: { objectId?: string } }> };

      return {
        callFrameId: frame.callFrameId,
        functionName: frame.functionName || '(anonymous)',
        url: frame.url,
        lineNumber: location.location.lineNumber + 1,  // Convert to 1-based
        columnNumber: location.location.columnNumber,
        scopeChain: scopeChain.scopeChain.map(scope => ({
          type: scope.type,
          name: scope.name,
          objectId: scope.object.objectId
        }))
      };
    });
  }

  /**
   * Get variables in a scope
   */
  async getScopeVariables(callFrameId: string, scopeType = 'local'): Promise<ScopeVariable[] | null> {
    if (!this.paused || !this.currentCallFrames) {
      return null;
    }

    // Find the call frame
    const rawFrames = this.currentCallFrames as unknown as Array<{
      callFrameId: string;
      scopeChain: Array<{ type: string; object: { objectId?: string } }>;
    }>;
    const frame = rawFrames.find(f => f.callFrameId === callFrameId);
    if (!frame) return null;

    // Find the scope
    const scope = frame.scopeChain.find(s => s.type === scopeType);
    if (!scope || !scope.object.objectId) return null;

    // Get properties
    const result = await this.getProperties(scope.object.objectId);

    return result.result.map(prop => ({
      name: prop.name,
      type: prop.value?.type,
      value: prop.value?.value,
      description: prop.value?.description
    }));
  }

  /**
   * Check if debugger is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Check if connected to debugger
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from debugger
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.paused = false;
    this.currentCallFrames = null;
    this.breakpoints.clear();
    this.scripts.clear();
  }
}
