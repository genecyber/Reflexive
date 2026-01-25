import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Create a mock WebSocket class factory
function createMockWebSocket() {
  return class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;

    readyState = MockWebSocket.OPEN;
    private sentMessages: string[] = [];

    constructor(_url: string) {
      super();
      // Simulate connection after a tick
      setTimeout(() => this.emit('open'), 0);
    }

    send(data: string): void {
      this.sentMessages.push(data);
    }

    getSentMessages(): string[] {
      return this.sentMessages;
    }

    close(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
    }

    simulateMessage(msg: unknown): void {
      this.emit('message', Buffer.from(JSON.stringify(msg)));
    }

    simulateError(error: Error): void {
      this.emit('error', error);
    }
  };
}

// Mock WebSocket before importing the module
const MockWebSocket = createMockWebSocket();

vi.mock('ws', () => {
  const MockWS = createMockWebSocket();
  return {
    default: MockWS,
    WebSocket: MockWS
  };
});

// Import after mock setup
import { RemoteDebugger } from '../../managers/remote-debugger.js';

describe('RemoteDebugger', () => {
  let debugger_: RemoteDebugger;

  beforeEach(() => {
    debugger_ = new RemoteDebugger();
  });

  describe('constructor', () => {
    it('initializes in disconnected state', () => {
      expect(debugger_.isConnected()).toBe(false);
      expect(debugger_.isPaused()).toBe(false);
    });
  });

  describe('connect', () => {
    it('connects successfully', async () => {
      await debugger_.connect('ws://localhost:9229/debugger');
      expect(debugger_.isConnected()).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('disconnects and resets state', async () => {
      await debugger_.connect('ws://localhost:9229/debugger');
      expect(debugger_.isConnected()).toBe(true);

      debugger_.disconnect();

      expect(debugger_.isConnected()).toBe(false);
      expect(debugger_.isPaused()).toBe(false);
    });

    it('clears breakpoints on disconnect', async () => {
      await debugger_.connect('ws://localhost:9229/debugger');

      // Manually set a breakpoint in the internal map for testing
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const setPromise = debugger_.setBreakpoint('/app/index.js', 10);
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({
        id: 1,
        result: { breakpointId: 'bp-1', locations: [] }
      });
      await setPromise;

      expect(debugger_.listBreakpoints()).toHaveLength(1);

      debugger_.disconnect();

      expect(debugger_.listBreakpoints()).toHaveLength(0);
    });
  });

  describe('send', () => {
    it('rejects if not connected', async () => {
      await expect(debugger_.send('Debugger.enable')).rejects.toThrow('Not connected');
    });

    it('sends commands and receives responses', async () => {
      await debugger_.connect('ws://localhost:9229/debugger');

      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const sendPromise = debugger_.send('Debugger.enable');
      await new Promise(resolve => setTimeout(resolve, 0));

      ws.simulateMessage({ id: 1, result: { debuggerId: 'test-debugger' } });

      const result = await sendPromise;
      expect(result).toEqual({ debuggerId: 'test-debugger' });
    });

    it('rejects on error response', async () => {
      await debugger_.connect('ws://localhost:9229/debugger');

      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const sendPromise = debugger_.send('Invalid.method');
      await new Promise(resolve => setTimeout(resolve, 0));

      ws.simulateMessage({ id: 1, error: { message: 'Unknown method' } });

      await expect(sendPromise).rejects.toThrow('Unknown method');
    });
  });

  describe('breakpoints', () => {
    beforeEach(async () => {
      await debugger_.connect('ws://localhost:9229/debugger');
    });

    it('sets breakpoints', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const setPromise = debugger_.setBreakpoint('/app/index.js', 10);
      await new Promise(resolve => setTimeout(resolve, 0));

      ws.simulateMessage({
        id: 1,
        result: {
          breakpointId: 'bp-1',
          locations: [{ scriptId: 's-1', lineNumber: 9, columnNumber: 0 }]
        }
      });

      const result = await setPromise;
      expect(result.breakpointId).toBe('bp-1');

      const breakpoints = debugger_.listBreakpoints();
      expect(breakpoints).toHaveLength(1);
      expect(breakpoints[0].file).toBe('/app/index.js');
      expect(breakpoints[0].line).toBe(10);
    });

    it('sets conditional breakpoints', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const setPromise = debugger_.setBreakpoint('/app/index.js', 10, 'x > 5');
      await new Promise(resolve => setTimeout(resolve, 0));

      const sentMessages = ws.getSentMessages();
      const lastMessage = JSON.parse(sentMessages[sentMessages.length - 1]);
      expect(lastMessage.params.condition).toBe('x > 5');

      ws.simulateMessage({
        id: 1,
        result: { breakpointId: 'bp-2', locations: [] }
      });

      await setPromise;

      const breakpoints = debugger_.listBreakpoints();
      expect(breakpoints[0].condition).toBe('x > 5');
    });

    it('removes breakpoints', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      // Set breakpoint first
      const setPromise = debugger_.setBreakpoint('/app/index.js', 10);
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({
        id: 1,
        result: { breakpointId: 'bp-1', locations: [] }
      });
      await setPromise;

      expect(debugger_.listBreakpoints()).toHaveLength(1);

      // Remove it
      const removePromise = debugger_.removeBreakpoint('bp-1');
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({ id: 2, result: {} });
      await removePromise;

      expect(debugger_.listBreakpoints()).toHaveLength(0);
    });
  });

  describe('pause/resume', () => {
    beforeEach(async () => {
      await debugger_.connect('ws://localhost:9229/debugger');
    });

    it('handles paused events', () => {
      const pauseHandler = vi.fn();
      debugger_.on('paused', pauseHandler);

      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;
      ws.simulateMessage({
        method: 'Debugger.paused',
        params: {
          callFrames: [
            {
              callFrameId: 'cf-1',
              functionName: 'main',
              url: 'file:///app/index.js',
              location: { lineNumber: 9, columnNumber: 0 },
              scopeChain: []
            }
          ],
          reason: 'breakpoint',
          hitBreakpoints: ['bp-1']
        }
      });

      expect(debugger_.isPaused()).toBe(true);
      expect(pauseHandler).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'breakpoint',
        hitBreakpoints: ['bp-1']
      }));
    });

    it('handles resumed events', () => {
      const resumeHandler = vi.fn();
      debugger_.on('resumed', resumeHandler);

      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      // First pause
      ws.simulateMessage({
        method: 'Debugger.paused',
        params: { callFrames: [], reason: 'breakpoint', hitBreakpoints: [] }
      });
      expect(debugger_.isPaused()).toBe(true);

      // Then resume
      ws.simulateMessage({ method: 'Debugger.resumed' });

      expect(debugger_.isPaused()).toBe(false);
      expect(resumeHandler).toHaveBeenCalled();
    });

    it('resumes execution', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const resumePromise = debugger_.resume();
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({ id: 1, result: {} });
      await resumePromise;

      const sentMessages = ws.getSentMessages();
      const lastMessage = JSON.parse(sentMessages[sentMessages.length - 1]);
      expect(lastMessage.method).toBe('Debugger.resume');
    });

    it('pauses execution', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const pausePromise = debugger_.pause();
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({ id: 1, result: {} });
      await pausePromise;

      const sentMessages = ws.getSentMessages();
      const lastMessage = JSON.parse(sentMessages[sentMessages.length - 1]);
      expect(lastMessage.method).toBe('Debugger.pause');
    });
  });

  describe('stepping', () => {
    beforeEach(async () => {
      await debugger_.connect('ws://localhost:9229/debugger');

      // Put debugger in paused state
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;
      ws.simulateMessage({
        method: 'Debugger.paused',
        params: { callFrames: [], reason: 'breakpoint', hitBreakpoints: [] }
      });
    });

    it('steps over', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const stepPromise = debugger_.stepOver();
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({ id: 1, result: {} });
      await stepPromise;

      const sentMessages = ws.getSentMessages();
      const lastMessage = JSON.parse(sentMessages[sentMessages.length - 1]);
      expect(lastMessage.method).toBe('Debugger.stepOver');
    });

    it('steps into', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const stepPromise = debugger_.stepInto();
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({ id: 1, result: {} });
      await stepPromise;

      const sentMessages = ws.getSentMessages();
      const lastMessage = JSON.parse(sentMessages[sentMessages.length - 1]);
      expect(lastMessage.method).toBe('Debugger.stepInto');
    });

    it('steps out', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const stepPromise = debugger_.stepOut();
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({ id: 1, result: {} });
      await stepPromise;

      const sentMessages = ws.getSentMessages();
      const lastMessage = JSON.parse(sentMessages[sentMessages.length - 1]);
      expect(lastMessage.method).toBe('Debugger.stepOut');
    });

    it('does not step when not paused', async () => {
      // Resume first
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;
      ws.simulateMessage({ method: 'Debugger.resumed' });

      const initialMessageCount = ws.getSentMessages().length;

      await debugger_.stepOver();
      await debugger_.stepInto();
      await debugger_.stepOut();

      // No new messages should have been sent
      expect(ws.getSentMessages().length).toBe(initialMessageCount);
    });
  });

  describe('evaluation', () => {
    beforeEach(async () => {
      await debugger_.connect('ws://localhost:9229/debugger');
    });

    it('evaluates expressions in runtime context', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      const evalPromise = debugger_.evaluate('1 + 1');
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({
        id: 1,
        result: { result: { type: 'number', value: 2 } }
      });

      const result = await evalPromise;
      expect(result).toEqual({ result: { type: 'number', value: 2 } });

      const sentMessages = ws.getSentMessages();
      const lastMessage = JSON.parse(sentMessages[sentMessages.length - 1]);
      expect(lastMessage.method).toBe('Runtime.evaluate');
    });

    it('evaluates on call frame when paused', async () => {
      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;

      // Pause with call frames
      ws.simulateMessage({
        method: 'Debugger.paused',
        params: {
          callFrames: [{
            callFrameId: 'cf-1',
            functionName: 'test',
            url: 'file:///test.js',
            location: { lineNumber: 0, columnNumber: 0 },
            scopeChain: []
          }],
          reason: 'breakpoint',
          hitBreakpoints: []
        }
      });

      const evalPromise = debugger_.evaluate('localVar', 'cf-1');
      await new Promise(resolve => setTimeout(resolve, 0));
      ws.simulateMessage({
        id: 1,
        result: { result: { type: 'string', value: 'test value' } }
      });

      await evalPromise;

      const sentMessages = ws.getSentMessages();
      const lastMessage = JSON.parse(sentMessages[sentMessages.length - 1]);
      expect(lastMessage.method).toBe('Debugger.evaluateOnCallFrame');
      expect(lastMessage.params.callFrameId).toBe('cf-1');
    });
  });

  describe('call stack', () => {
    it('returns null when not paused', async () => {
      await debugger_.connect('ws://localhost:9229/debugger');
      expect(debugger_.getCallStack()).toBeNull();
    });

    it('returns call stack when paused', async () => {
      await debugger_.connect('ws://localhost:9229/debugger');

      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;
      ws.simulateMessage({
        method: 'Debugger.paused',
        params: {
          callFrames: [
            {
              callFrameId: 'cf-1',
              functionName: 'main',
              url: 'file:///app/index.js',
              location: { lineNumber: 9, columnNumber: 0 },
              scopeChain: [
                { type: 'local', object: { objectId: 'obj-1' } }
              ]
            },
            {
              callFrameId: 'cf-2',
              functionName: '', // anonymous
              url: 'file:///app/helper.js',
              location: { lineNumber: 4, columnNumber: 5 },
              scopeChain: []
            }
          ],
          reason: 'breakpoint',
          hitBreakpoints: []
        }
      });

      const callStack = debugger_.getCallStack();

      expect(callStack).toHaveLength(2);
      expect(callStack![0].functionName).toBe('main');
      expect(callStack![0].lineNumber).toBe(10); // 1-based
      expect(callStack![1].functionName).toBe('(anonymous)');
    });
  });

  describe('script parsing', () => {
    it('tracks parsed scripts', async () => {
      await debugger_.connect('ws://localhost:9229/debugger');

      const scriptHandler = vi.fn();
      debugger_.on('scriptParsed', scriptHandler);

      const ws = (debugger_ as unknown as { ws: InstanceType<typeof MockWebSocket> }).ws;
      ws.simulateMessage({
        method: 'Debugger.scriptParsed',
        params: {
          scriptId: 's-1',
          url: 'file:///app/index.js',
          startLine: 0,
          endLine: 100,
          hash: 'abc123'
        }
      });

      expect(scriptHandler).toHaveBeenCalledWith(expect.objectContaining({
        scriptId: 's-1',
        url: 'file:///app/index.js'
      }));
    });
  });
});
