import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCliTools } from '../../mcp/cli-tools.js';
import type { ProcessManager } from '../../managers/process-manager.js';
import type { Capabilities } from '../../types/index.js';

// Create a mock ProcessManager
function createMockProcessManager(overrides: Partial<ProcessManager> = {}): ProcessManager {
  const defaultMock = {
    getState: vi.fn().mockReturnValue({
      isRunning: true,
      pid: 12345,
      uptime: 60,
      restartCount: 0,
      exitCode: null,
      entry: '/app/test.js',
      cwd: '/app',
      interactive: false,
      waitingForInput: false,
      inject: false,
      injectionReady: false,
      debug: false,
      debuggerConnected: false,
      debuggerPaused: false,
      inspectorUrl: null
    }),
    getLogs: vi.fn().mockReturnValue([
      { type: 'stdout', message: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      { type: 'stderr', message: 'Error', timestamp: '2024-01-01T00:00:01Z' }
    ]),
    searchLogs: vi.fn().mockReturnValue([
      { type: 'stdout', message: 'Found', timestamp: '2024-01-01T00:00:00Z' }
    ]),
    restart: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    send: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    queryInjectedState: vi.fn(),
    getInjectedState: vi.fn().mockReturnValue({ key: 'value' }),
    evaluate: vi.fn().mockResolvedValue({ result: 42 }),
    isDebuggerConnected: vi.fn().mockReturnValue(false),
    isDebuggerPaused: vi.fn().mockReturnValue(false),
    debugSetBreakpoint: vi.fn().mockResolvedValue({ breakpointId: 'bp-1' }),
    debugRemoveBreakpoint: vi.fn().mockResolvedValue(undefined),
    debugListBreakpoints: vi.fn().mockReturnValue([]),
    debugResume: vi.fn().mockResolvedValue(undefined),
    debugPause: vi.fn().mockResolvedValue(undefined),
    debugStepOver: vi.fn().mockResolvedValue(undefined),
    debugStepInto: vi.fn().mockResolvedValue(undefined),
    debugStepOut: vi.fn().mockResolvedValue(undefined),
    debugGetCallStack: vi.fn().mockReturnValue(null),
    debugEvaluate: vi.fn().mockResolvedValue({ result: 'eval result' }),
    debugGetScopeVariables: vi.fn().mockResolvedValue([{ name: 'x', value: 1 }]),
    getDebuggerState: vi.fn().mockReturnValue({
      connected: false,
      paused: false,
      inspectorUrl: null,
      breakpoints: [],
      callStack: null
    }),
    ...overrides
  };

  return defaultMock as unknown as ProcessManager;
}

describe('CLI Tools', () => {
  const defaultCapabilities: Capabilities = {
    readFiles: true,
    writeFiles: false,
    shellAccess: false,
    restart: true,
    inject: false,
    eval: false,
    debug: false
  };

  describe('createCliTools', () => {
    it('creates base tools', () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('get_process_state');
      expect(toolNames).toContain('get_output_logs');
      expect(toolNames).toContain('restart_process');
      expect(toolNames).toContain('stop_process');
      expect(toolNames).toContain('start_process');
      expect(toolNames).toContain('send_input');
      expect(toolNames).toContain('search_logs');
    });

    it('does not include inject tools by default', () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const toolNames = tools.map(t => t.name);
      expect(toolNames).not.toContain('get_injected_state');
      expect(toolNames).not.toContain('get_injection_logs');
    });

    it('includes inject tools when enabled', () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        inject: true
      });

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('get_injected_state');
      expect(toolNames).toContain('get_injection_logs');
    });

    it('does not include eval tools by default', () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const toolNames = tools.map(t => t.name);
      expect(toolNames).not.toContain('evaluate_in_app');
      expect(toolNames).not.toContain('list_app_globals');
    });

    it('includes eval tools when enabled', () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        eval: true
      });

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('evaluate_in_app');
      expect(toolNames).toContain('list_app_globals');
    });

    it('does not include debug tools by default', () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const toolNames = tools.map(t => t.name);
      expect(toolNames).not.toContain('debug_set_breakpoint');
      expect(toolNames).not.toContain('debug_resume');
    });

    it('includes debug tools when enabled', () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        debug: true
      });

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('debug_set_breakpoint');
      expect(toolNames).toContain('debug_remove_breakpoint');
      expect(toolNames).toContain('debug_list_breakpoints');
      expect(toolNames).toContain('debug_resume');
      expect(toolNames).toContain('debug_pause');
      expect(toolNames).toContain('debug_step_over');
      expect(toolNames).toContain('debug_step_into');
      expect(toolNames).toContain('debug_step_out');
      expect(toolNames).toContain('debug_get_call_stack');
      expect(toolNames).toContain('debug_evaluate');
      expect(toolNames).toContain('debug_get_scope_variables');
      expect(toolNames).toContain('debug_get_state');
    });
  });

  describe('get_process_state', () => {
    it('returns process state', async () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const tool = tools.find(t => t.name === 'get_process_state')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('12345'); // pid
      expect(result.content[0].text).toContain('isRunning');
    });
  });

  describe('get_output_logs', () => {
    it('returns logs', async () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const tool = tools.find(t => t.name === 'get_output_logs')!;
      const result = await tool.handler({ count: 10 });

      expect(pm.getLogs).toHaveBeenCalledWith(10);
      expect(result.content[0].text).toContain('Hello');
    });

    it('filters logs by type', async () => {
      const pm = createMockProcessManager({
        getLogs: vi.fn().mockReturnValue([
          { type: 'stdout', message: 'out', timestamp: '' },
          { type: 'stderr', message: 'err', timestamp: '' }
        ])
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const tool = tools.find(t => t.name === 'get_output_logs')!;
      const result = await tool.handler({ type: 'stdout' });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.every((l: { type: string }) => l.type === 'stdout')).toBe(true);
    });
  });

  describe('restart_process', () => {
    it('restarts when capability enabled', async () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: { ...defaultCapabilities, restart: true }
      });

      const tool = tools.find(t => t.name === 'restart_process')!;
      const result = await tool.handler({});

      expect(pm.restart).toHaveBeenCalled();
      expect(result.content[0].text).toContain('restarted');
    });

    it('returns error when capability disabled', async () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: { ...defaultCapabilities, restart: false }
      });

      const tool = tools.find(t => t.name === 'restart_process')!;
      const result = await tool.handler({});

      expect(pm.restart).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('not enabled');
    });
  });

  describe('stop_process', () => {
    it('stops the process', async () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const tool = tools.find(t => t.name === 'stop_process')!;
      const result = await tool.handler({});

      expect(pm.stop).toHaveBeenCalled();
      expect(result.content[0].text).toContain('stopped');
    });
  });

  describe('start_process', () => {
    it('starts when not running', async () => {
      const pm = createMockProcessManager({
        isRunning: vi.fn().mockReturnValue(false)
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const tool = tools.find(t => t.name === 'start_process')!;
      const result = await tool.handler({});

      expect(pm.start).toHaveBeenCalled();
      expect(result.content[0].text).toContain('started');
    });

    it('returns message when already running', async () => {
      const pm = createMockProcessManager({
        isRunning: vi.fn().mockReturnValue(true)
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const tool = tools.find(t => t.name === 'start_process')!;
      const result = await tool.handler({});

      expect(pm.start).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('already running');
    });
  });

  describe('send_input', () => {
    it('sends input to stdin', async () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const tool = tools.find(t => t.name === 'send_input')!;
      const result = await tool.handler({ input: 'test input' });

      expect(pm.send).toHaveBeenCalledWith('test input');
      expect(result.content[0].text).toContain('test input');
    });
  });

  describe('search_logs', () => {
    it('searches logs', async () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities
      });

      const tool = tools.find(t => t.name === 'search_logs')!;
      const result = await tool.handler({ query: 'test' });

      expect(pm.searchLogs).toHaveBeenCalledWith('test');
      expect(result.content[0].text).toContain('Found');
    });
  });

  describe('inject tools', () => {
    it('get_injected_state returns state when ready', async () => {
      const pm = createMockProcessManager({
        getState: vi.fn().mockReturnValue({ injectionReady: true })
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        inject: true
      });

      const tool = tools.find(t => t.name === 'get_injected_state')!;
      const result = await tool.handler({});

      expect(pm.queryInjectedState).toHaveBeenCalled();
      expect(result.content[0].text).toContain('value');
    });

    it('get_injected_state returns message when not ready', async () => {
      const pm = createMockProcessManager({
        getState: vi.fn().mockReturnValue({ injectionReady: false })
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        inject: true
      });

      const tool = tools.find(t => t.name === 'get_injected_state')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('not ready');
    });
  });

  describe('eval tools', () => {
    it('evaluate_in_app evaluates code', async () => {
      const pm = createMockProcessManager({
        getState: vi.fn().mockReturnValue({ injectionReady: true })
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        eval: true
      });

      const tool = tools.find(t => t.name === 'evaluate_in_app')!;
      const result = await tool.handler({ code: '1 + 1' });

      expect(pm.evaluate).toHaveBeenCalledWith('1 + 1', 10000);
      expect(result.content[0].text).toContain('42');
    });

    it('evaluate_in_app handles errors', async () => {
      const pm = createMockProcessManager({
        getState: vi.fn().mockReturnValue({ injectionReady: true }),
        evaluate: vi.fn().mockRejectedValue(new Error('Eval failed'))
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        eval: true
      });

      const tool = tools.find(t => t.name === 'evaluate_in_app')!;
      const result = await tool.handler({ code: 'bad code' });

      expect(result.content[0].text).toContain('Eval error');
      expect(result.isError).toBe(true);
    });
  });

  describe('debug tools', () => {
    it('debug_set_breakpoint sets breakpoint when connected', async () => {
      const pm = createMockProcessManager({
        isDebuggerConnected: vi.fn().mockReturnValue(true)
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        debug: true
      });

      const tool = tools.find(t => t.name === 'debug_set_breakpoint')!;
      const result = await tool.handler({ file: '/app/test.js', line: 10 });

      expect(pm.debugSetBreakpoint).toHaveBeenCalledWith('/app/test.js', 10, undefined);
      expect(result.content[0].text).toContain('bp-1');
    });

    it('debug_set_breakpoint returns message when not connected', async () => {
      const pm = createMockProcessManager({
        isDebuggerConnected: vi.fn().mockReturnValue(false)
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        debug: true
      });

      const tool = tools.find(t => t.name === 'debug_set_breakpoint')!;
      const result = await tool.handler({ file: '/app/test.js', line: 10 });

      expect(result.content[0].text).toContain('not connected');
    });

    it('debug_resume resumes when paused', async () => {
      const pm = createMockProcessManager({
        isDebuggerPaused: vi.fn().mockReturnValue(true)
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        debug: true
      });

      const tool = tools.find(t => t.name === 'debug_resume')!;
      const result = await tool.handler({});

      expect(pm.debugResume).toHaveBeenCalled();
      expect(result.content[0].text).toContain('resumed');
    });

    it('debug_resume returns message when not paused', async () => {
      const pm = createMockProcessManager({
        isDebuggerPaused: vi.fn().mockReturnValue(false)
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        debug: true
      });

      const tool = tools.find(t => t.name === 'debug_resume')!;
      const result = await tool.handler({});

      expect(pm.debugResume).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('not paused');
    });

    it('debug_get_call_stack returns call stack when paused', async () => {
      const pm = createMockProcessManager({
        isDebuggerPaused: vi.fn().mockReturnValue(true),
        debugGetCallStack: vi.fn().mockReturnValue([
          { id: 'cf-1', name: 'main', source: { path: '/app.js', name: 'app.js' }, line: 10, column: 0 }
        ])
      });
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        debug: true
      });

      const tool = tools.find(t => t.name === 'debug_get_call_stack')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('main');
      expect(result.content[0].text).toContain('Call Stack');
    });

    it('debug_get_state returns debugger state', async () => {
      const pm = createMockProcessManager();
      const tools = createCliTools({
        processManager: pm,
        capabilities: defaultCapabilities,
        debug: true
      });

      const tool = tools.find(t => t.name === 'debug_get_state')!;
      const result = await tool.handler({});

      expect(pm.getDebuggerState).toHaveBeenCalled();
      expect(result.content[0].text).toContain('connected');
    });
  });
});
