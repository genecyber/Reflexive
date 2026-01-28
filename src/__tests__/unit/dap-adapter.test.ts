import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Factory function for MockSocketDebugClient
 *
 * Key insight: debugpy (and similar DAP servers) have unusual response ordering:
 * - attach request is sent
 * - initialized EVENT fires (before attach response!)
 * - configurationDone request is sent
 * - configurationDone response arrives
 * - attach response arrives LAST
 *
 * This means we cannot await attach() - we must fire it and wait for the initialized event.
 */
function createMockSocketDebugClient() {
  return class MockSocketDebugClient extends EventEmitter {
  private initializeCallback: (() => void) | null = null;
  private _onInitializedCallbacks: Array<{ callback: () => void; once: boolean }> = [];
  private _onStoppedCallbacks: Array<(event: unknown) => void> = [];
  private _onContinuedCallbacks: Array<(event: unknown) => void> = [];
  private _onThreadCallbacks: Array<(event: unknown) => void> = [];
  private _onOutputCallbacks: Array<(event: unknown) => void> = [];
  private _onBreakpointCallbacks: Array<(event: unknown) => void> = [];
  private _onTerminatedCallbacks: Array<() => void> = [];
  private _onExitedCallbacks: Array<() => void> = [];

  // Track what was called for assertions
  public initializeCalled = false;
  public initializeArgs: unknown = null;
  public attachCalled = false;
  public attachArgs: unknown = null;
  public configurationDoneCalled = false;
  public setBreakpointsCalls: unknown[] = [];

  // Control test behavior
  public simulateDebugpyBehavior = true; // If true, simulates debugpy's unusual response ordering

  async connectAdapter(): Promise<void> {
    // Simulate successful connection
  }

  disconnectAdapter(): void {
    // Cleanup
  }

  async initialize(args: unknown): Promise<{ supportsConfigurationDoneRequest: boolean }> {
    this.initializeCalled = true;
    this.initializeArgs = args;
    return { supportsConfigurationDoneRequest: true };
  }

  async attach(args: unknown): Promise<void> {
    this.attachCalled = true;
    this.attachArgs = args;

    if (this.simulateDebugpyBehavior) {
      // debugpy fires initialized event BEFORE returning attach response
      // This is why we can't await attach() - we'd deadlock waiting for configurationDone
      setTimeout(() => {
        this._onInitializedCallbacks.forEach(({ callback, once }, index) => {
          callback();
          if (once) {
            this._onInitializedCallbacks.splice(index, 1);
          }
        });
      }, 0);

      // Simulate debugpy's delayed response - attach response comes AFTER configurationDone
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async configurationDone(_args: unknown): Promise<void> {
    this.configurationDoneCalled = true;
  }

  async setBreakpoints(args: unknown): Promise<{ breakpoints: Array<{ verified: boolean; line?: number }> }> {
    this.setBreakpointsCalls.push(args);
    return { breakpoints: [{ verified: true }] };
  }

  async continue(args: unknown): Promise<void> {
    // Simulate continue
  }

  async pause(args: unknown): Promise<void> {
    // Simulate pause
  }

  async next(args: unknown): Promise<void> {
    // Simulate step over
  }

  async stepIn(args: unknown): Promise<void> {
    // Simulate step into
  }

  async stepOut(args: unknown): Promise<void> {
    // Simulate step out
  }

  async stackTrace(_args: unknown): Promise<{ stackFrames: unknown[] }> {
    return { stackFrames: [] };
  }

  async scopes(_args: unknown): Promise<{ scopes: unknown[] }> {
    return { scopes: [] };
  }

  async variables(_args: unknown): Promise<{ variables: unknown[] }> {
    return { variables: [] };
  }

  async evaluate(_args: unknown): Promise<{ result: string; type?: string; variablesReference?: number }> {
    return { result: 'test', variablesReference: 0 };
  }

  async threads(_args: unknown): Promise<{ threads: unknown[] }> {
    return { threads: [{ id: 1, name: 'MainThread' }] };
  }

  // Event registration methods
  onInitialized(callback: () => void, once = false): void {
    this._onInitializedCallbacks.push({ callback, once });
  }

  onStopped(callback: (event: unknown) => void): void {
    this._onStoppedCallbacks.push(callback);
  }

  onContinued(callback: (event: unknown) => void): void {
    this._onContinuedCallbacks.push(callback);
  }

  onThread(callback: (event: unknown) => void): void {
    this._onThreadCallbacks.push(callback);
  }

  onOutput(callback: (event: unknown) => void): void {
    this._onOutputCallbacks.push(callback);
  }

  onBreakpoint(callback: (event: unknown) => void): void {
    this._onBreakpointCallbacks.push(callback);
  }

  onTerminated(callback: () => void): void {
    this._onTerminatedCallbacks.push(callback);
  }

  onExited(callback: () => void): void {
    this._onExitedCallbacks.push(callback);
  }

  // Test helpers to simulate events
  simulateStopped(event: unknown): void {
    this._onStoppedCallbacks.forEach(cb => cb(event));
  }

  simulateContinued(event: unknown): void {
    this._onContinuedCallbacks.forEach(cb => cb(event));
  }

  simulateTerminated(): void {
    this._onTerminatedCallbacks.forEach(cb => cb());
  }
  };
}

// Create the mock class
const MockSocketDebugClient = createMockSocketDebugClient();
type MockSocketDebugClientType = InstanceType<typeof MockSocketDebugClient>;

// Mock the node-debugprotocol-client module
vi.mock('node-debugprotocol-client', () => {
  const MockClass = createMockSocketDebugClient();
  return {
    SocketDebugClient: MockClass,
    LogLevel: { Off: 0, On: 1 }
  };
});

// Import after mock setup
import { DAPAdapter } from '../../adapters/dap-adapter.js';

describe('DAPAdapter', () => {
  let adapter: DAPAdapter;
  let mockClient: MockSocketDebugClientType;

  beforeEach(() => {
    adapter = new DAPAdapter();
    // Access the mock client after connection
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('initializes in disconnected state', () => {
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.isPaused()).toBe(false);
    });
  });

  describe('connect', () => {
    it('requires port in connection options', async () => {
      await expect(adapter.connect({})).rejects.toThrow('DAPAdapter requires port');
    });

    it('connects successfully with port', async () => {
      await adapter.connect({ port: 5678 });
      expect(adapter.isConnected()).toBe(true);
    });

    it('uses default host localhost', async () => {
      await adapter.connect({ port: 5678 });
      // Connection succeeds with default host
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('initialize - DAP protocol sequence', () => {
    /**
     * CRITICAL: This test documents the correct DAP sequence for debugpy
     *
     * The sequence MUST be:
     * 1. initialize() - await response
     * 2. attach() - DO NOT await (fire and forget)
     * 3. wait for 'initialized' event
     * 4. configurationDone() - await response
     *
     * debugpy sends the attach response AFTER configurationDone, not before.
     * If we await attach(), we'd deadlock.
     */
    it('follows correct DAP sequence: initialize → attach (no await) → initialized event → configurationDone', async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;

      await adapter.initialize();

      // Verify the sequence
      expect(mockClient.initializeCalled).toBe(true);
      expect(mockClient.attachCalled).toBe(true);
      expect(mockClient.configurationDoneCalled).toBe(true);
    });

    it('sends correct initialize arguments', async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;

      await adapter.initialize();

      expect(mockClient.initializeArgs).toMatchObject({
        clientID: 'reflexive',
        clientName: 'Reflexive Debugger',
        adapterID: 'reflexive',
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
      });
    });

    /**
     * CRITICAL: attach arguments for debugpy
     *
     * When debugpy is started with --listen --wait-for-client:
     * - DO NOT use { connect: { host, port } } - this tells debugpy to connect to ANOTHER process
     * - Use { justMyCode: true } or similar minimal args
     *
     * The { connect: ... } pattern is for when the debug adapter needs to connect
     * to a separate debuggee. But with --wait-for-client, debugpy IS both adapter and debuggee.
     */
    it('sends attach with { justMyCode: true }, NOT { connect: { host, port } }', async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;

      await adapter.initialize();

      // MUST be { justMyCode: true }, not { connect: { host, port } }
      expect(mockClient.attachArgs).toEqual({ justMyCode: true });
      expect(mockClient.attachArgs).not.toHaveProperty('connect');
    });

    it('waits for initialized event before configurationDone', async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;

      // Track order of operations
      const callOrder: string[] = [];
      const originalConfigDone = mockClient.configurationDone.bind(mockClient);
      mockClient.configurationDone = async (args: unknown) => {
        callOrder.push('configurationDone');
        return originalConfigDone(args);
      };

      // The onInitialized callback should be registered
      const originalOnInitialized = mockClient.onInitialized.bind(mockClient);
      mockClient.onInitialized = (callback: () => void, once?: boolean) => {
        const wrappedCallback = () => {
          callOrder.push('initialized-event');
          callback();
        };
        originalOnInitialized(wrappedCallback, once);
      };

      await adapter.initialize();

      // initialized event must come before configurationDone
      const initIndex = callOrder.indexOf('initialized-event');
      const configIndex = callOrder.indexOf('configurationDone');
      expect(initIndex).toBeLessThan(configIndex);
    });
  });

  describe('disconnect', () => {
    it('disconnects and resets state', async () => {
      await adapter.connect({ port: 5678 });
      expect(adapter.isConnected()).toBe(true);

      adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
      expect(adapter.isPaused()).toBe(false);
    });

    it('clears breakpoints on disconnect', async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;
      await adapter.initialize();

      // Set a breakpoint
      await adapter.setBreakpoint('/app/test.py', 10);
      expect(adapter.listBreakpoints()).toHaveLength(1);

      adapter.disconnect();

      expect(adapter.listBreakpoints()).toHaveLength(0);
    });
  });

  describe('breakpoints', () => {
    beforeEach(async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;
      await adapter.initialize();
    });

    it('sets breakpoints', async () => {
      const result = await adapter.setBreakpoint('/app/test.py', 10);

      expect(result.breakpointId).toBeDefined();
      expect(result.verified).toBe(true);

      const breakpoints = adapter.listBreakpoints();
      expect(breakpoints).toHaveLength(1);
      expect(breakpoints[0].file).toBe('/app/test.py');
      expect(breakpoints[0].line).toBe(10);
    });

    it('sets conditional breakpoints', async () => {
      await adapter.setBreakpoint('/app/test.py', 10, 'x > 5');

      const breakpoints = adapter.listBreakpoints();
      expect(breakpoints[0].condition).toBe('x > 5');

      // Verify condition was sent to DAP server
      const lastCall = mockClient.setBreakpointsCalls[mockClient.setBreakpointsCalls.length - 1] as {
        breakpoints: Array<{ condition?: string }>;
      };
      expect(lastCall.breakpoints[0].condition).toBe('x > 5');
    });

    it('removes breakpoints', async () => {
      const result = await adapter.setBreakpoint('/app/test.py', 10);
      expect(adapter.listBreakpoints()).toHaveLength(1);

      await adapter.removeBreakpoint(result.breakpointId);

      expect(adapter.listBreakpoints()).toHaveLength(0);
    });

    it('clears all breakpoints in a file', async () => {
      await adapter.setBreakpoint('/app/test.py', 10);
      await adapter.setBreakpoint('/app/test.py', 20);
      await adapter.setBreakpoint('/app/other.py', 5);

      expect(adapter.listBreakpoints()).toHaveLength(3);

      await adapter.clearBreakpoints('/app/test.py');

      const remaining = adapter.listBreakpoints();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].file).toBe('/app/other.py');
    });
  });

  describe('execution control', () => {
    beforeEach(async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;
      await adapter.initialize();
    });

    it('resumes execution', async () => {
      await adapter.resume();
      // Should not throw
    });

    it('pauses execution', async () => {
      await adapter.pause();
      // Should not throw
    });

    it('steps over', async () => {
      await adapter.stepOver();
      // Should not throw
    });

    it('steps into', async () => {
      await adapter.stepInto();
      // Should not throw
    });

    it('steps out', async () => {
      await adapter.stepOut();
      // Should not throw
    });
  });

  describe('events', () => {
    beforeEach(async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;
    });

    it('emits paused event on stopped', async () => {
      const pausedHandler = vi.fn();
      adapter.on('paused', pausedHandler);

      await adapter.initialize();

      mockClient.simulateStopped({
        reason: 'breakpoint',
        threadId: 1,
        allThreadsStopped: true,
        hitBreakpointIds: [1],
      });

      expect(pausedHandler).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'breakpoint',
        threadId: 1,
      }));
      expect(adapter.isPaused()).toBe(true);
    });

    it('emits resumed event on continued', async () => {
      const resumedHandler = vi.fn();
      adapter.on('resumed', resumedHandler);

      await adapter.initialize();

      // First pause
      mockClient.simulateStopped({ reason: 'breakpoint', threadId: 1 });
      expect(adapter.isPaused()).toBe(true);

      // Then continue
      mockClient.simulateContinued({ allThreadsContinued: true });

      expect(resumedHandler).toHaveBeenCalled();
      expect(adapter.isPaused()).toBe(false);
    });

    it('emits disconnected on terminated', async () => {
      const disconnectedHandler = vi.fn();
      adapter.on('disconnected', disconnectedHandler);

      await adapter.initialize();

      mockClient.simulateTerminated();

      expect(disconnectedHandler).toHaveBeenCalled();
    });
  });

  describe('inspection', () => {
    beforeEach(async () => {
      await adapter.connect({ port: 5678 });
      mockClient = (adapter as unknown as { client: MockSocketDebugClient }).client;
      await adapter.initialize();
    });

    it('gets call stack', async () => {
      const stack = await adapter.getCallStack();
      expect(Array.isArray(stack)).toBe(true);
    });

    it('gets threads', async () => {
      const threads = await adapter.getThreads();
      expect(Array.isArray(threads)).toBe(true);
    });

    it('evaluates expressions', async () => {
      const result = await adapter.evaluate('1 + 1');
      expect(result).toHaveProperty('result');
    });
  });
});

/**
 * Integration test documentation for DAP adapter with real debugpy
 *
 * To test with a real debugpy instance:
 *
 * 1. Start debugpy:
 *    python -m debugpy --listen 5679 --wait-for-client your_script.py
 *
 * 2. The adapter will:
 *    - Connect to port 5679
 *    - Send initialize request
 *    - Send attach request with { justMyCode: true } (NOT awaited)
 *    - Wait for initialized event
 *    - Send configurationDone
 *    - Script starts executing
 *
 * 3. Key learnings from debugpy behavior:
 *    - debugpy outputs "ptvsd" and "debugpy" on connect (legacy compatibility)
 *    - attach response comes AFTER configurationDone (unusual but documented)
 *    - { connect: { host, port } } is WRONG - it tries to connect to another process
 *    - { justMyCode: true } is the correct minimal attach argument
 */
