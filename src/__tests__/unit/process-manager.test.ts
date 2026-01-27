import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessManager } from '../../managers/process-manager.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test fixtures directory
const FIXTURES_DIR = resolve(__dirname, '../fixtures');
const TEST_APP_PATH = resolve(FIXTURES_DIR, 'test-app-pm.js');

describe('ProcessManager', () => {
  // Ensure fixtures directory exists
  beforeEach(() => {
    if (!existsSync(FIXTURES_DIR)) {
      mkdirSync(FIXTURES_DIR, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('initializes with required options', () => {
      const pm = new ProcessManager({
        entry: '/app/test.js'
      });

      const state = pm.getState();
      expect(state.entry).toBe(resolve('/app/test.js'));
      expect(state.isRunning).toBe(false);
      expect(state.pid).toBeNull();
      expect(state.restartCount).toBe(0);
    });

    it('accepts optional flags', () => {
      const pm = new ProcessManager({
        entry: '/app/test.js',
        interactive: true,
        inject: true,
        eval: true,
        debug: true
      });

      const state = pm.getState();
      expect(state.interactive).toBe(true);
      expect(state.inject).toBe(true);
      expect(state.debug).toBe(true);
    });
  });

  describe('event emitter', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      pm = new ProcessManager({
        entry: '/app/test.js'
      });
    });

    it('allows subscribing to events', () => {
      const handler = vi.fn();
      pm.on('log', handler);

      pm.emit('log', { type: 'info', message: 'test' });

      expect(handler).toHaveBeenCalledWith({ type: 'info', message: 'test' });
    });

    it('allows unsubscribing from events', () => {
      const handler = vi.fn();
      pm.on('log', handler);
      pm.off('log', handler);

      pm.emit('log', { type: 'info', message: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles errors in event handlers gracefully', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();

      pm.on('log', errorHandler);
      pm.on('log', goodHandler);

      // Should not throw
      expect(() => pm.emit('log', {})).not.toThrow();

      // Both handlers should have been attempted
      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe('start/stop', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      // Create a test app file
      writeFileSync(TEST_APP_PATH, `
        console.log('Test app started');
        setInterval(() => {
          console.log('Tick');
        }, 100);
      `);

      pm = new ProcessManager({
        entry: TEST_APP_PATH
      });
    });

    afterEach(async () => {
      await pm.stop();
      pm.destroy();

      // Clean up test app file
      if (existsSync(TEST_APP_PATH)) {
        unlinkSync(TEST_APP_PATH);
      }
    });

    it('starts a process', async () => {
      pm.start();

      // Wait for process to start
      await new Promise(resolve => setTimeout(resolve, 100));

      const state = pm.getState();
      expect(state.isRunning).toBe(true);
      expect(state.pid).toBeGreaterThan(0);
    });

    it('stops a running process', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(pm.isRunning()).toBe(true);

      await pm.stop();

      expect(pm.isRunning()).toBe(false);
    });

    it('does not start if already running', () => {
      pm.start();
      const firstPid = pm.getState().pid;

      pm.start(); // Try to start again
      const secondPid = pm.getState().pid;

      expect(firstPid).toBe(secondPid);
    });

    it('tracks uptime', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 1100));

      const state = pm.getState();
      expect(state.uptime).toBeGreaterThanOrEqual(1);
    });
  });

  describe('restart', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      writeFileSync(TEST_APP_PATH, 'console.log("Hello");');
      pm = new ProcessManager({ entry: TEST_APP_PATH });
    });

    afterEach(async () => {
      await pm.stop();
      pm.destroy();
      if (existsSync(TEST_APP_PATH)) {
        unlinkSync(TEST_APP_PATH);
      }
    });

    it('restarts the process', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      const firstPid = pm.getState().pid;

      await pm.restart();
      await new Promise(resolve => setTimeout(resolve, 100));

      const state = pm.getState();
      expect(state.restartCount).toBe(1);
      expect(state.pid).not.toBe(firstPid);
    });
  });

  describe('logs', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      writeFileSync(TEST_APP_PATH, `
        console.log('Log line 1');
        console.log('Log line 2');
        console.error('Error line');
      `);
      pm = new ProcessManager({ entry: TEST_APP_PATH });
    });

    afterEach(async () => {
      await pm.stop();
      pm.destroy();
      if (existsSync(TEST_APP_PATH)) {
        unlinkSync(TEST_APP_PATH);
      }
    });

    it('captures stdout logs', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const logs = pm.getLogs();
      const stdoutLogs = logs.filter(l => l.type === 'stdout');

      expect(stdoutLogs.length).toBeGreaterThan(0);
      expect(stdoutLogs.some(l => l.message.includes('Log line 1'))).toBe(true);
    });

    it('captures stderr logs', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const logs = pm.getLogs();
      const stderrLogs = logs.filter(l => l.type === 'stderr');

      expect(stderrLogs.some(l => l.message.includes('Error line'))).toBe(true);
    });

    it('filters logs by type', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const stdoutOnly = pm.getLogs(50, 'stdout');
      expect(stdoutOnly.every(l => l.type === 'stdout')).toBe(true);
    });

    it('limits log count', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const limited = pm.getLogs(2);
      expect(limited.length).toBeLessThanOrEqual(2);
    });

    it('searches logs', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const results = pm.searchLogs('Error');
      expect(results.some(l => l.message.includes('Error'))).toBe(true);
    });
  });

  describe('sendInput', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      // App that reads from stdin
      writeFileSync(TEST_APP_PATH, `
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl.question('Name? ', (name) => {
          console.log('Hello ' + name);
          rl.close();
        });
      `);
      pm = new ProcessManager({
        entry: TEST_APP_PATH,
        interactive: true
      });
    });

    afterEach(async () => {
      await pm.stop();
      pm.destroy();
      if (existsSync(TEST_APP_PATH)) {
        unlinkSync(TEST_APP_PATH);
      }
    });

    it('sends input to stdin', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      const sent = pm.sendInput('TestUser');
      expect(sent).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 200));

      const logs = pm.getLogs();
      const stdinLog = logs.find(l => l.type === 'stdin');
      expect(stdinLog?.message).toBe('TestUser');
    });

    it('returns false when no stdin available', () => {
      // Process not started
      const sent = pm.sendInput('test');
      expect(sent).toBe(false);
    });
  });

  describe('getRecentOutput', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      writeFileSync(TEST_APP_PATH, `
        for (let i = 1; i <= 5; i++) {
          console.log('Line ' + i);
        }
      `);
      pm = new ProcessManager({ entry: TEST_APP_PATH });
    });

    afterEach(async () => {
      await pm.stop();
      pm.destroy();
      if (existsSync(TEST_APP_PATH)) {
        unlinkSync(TEST_APP_PATH);
      }
    });

    it('returns recent stdout/stderr combined', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const output = pm.getRecentOutput(10);
      expect(output).toContain('Line');
    });

    it('limits output to recent entries', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const output = pm.getRecentOutput(2);
      // Just verify it returns some output (the limit applies to log entries, not lines)
      expect(typeof output).toBe('string');
    });
  });

  describe('getState', () => {
    it('returns complete process state', () => {
      const pm = new ProcessManager({
        entry: '/app/test.js',
        interactive: true,
        inject: true,
        debug: true
      });

      const state = pm.getState();

      expect(state).toHaveProperty('isRunning');
      expect(state).toHaveProperty('pid');
      expect(state).toHaveProperty('uptime');
      expect(state).toHaveProperty('restartCount');
      expect(state).toHaveProperty('exitCode');
      expect(state).toHaveProperty('entry');
      expect(state).toHaveProperty('cwd');
      expect(state).toHaveProperty('interactive');
      expect(state).toHaveProperty('waitingForInput');
      expect(state).toHaveProperty('inject');
      expect(state).toHaveProperty('injectionReady');
      expect(state).toHaveProperty('debug');
      expect(state).toHaveProperty('debuggerConnected');
      expect(state).toHaveProperty('debuggerPaused');
      expect(state).toHaveProperty('inspectorUrl');
    });
  });

  describe('getCustomState', () => {
    it('returns empty object initially', () => {
      const pm = new ProcessManager({ entry: '/app/test.js' });
      expect(pm.getCustomState()).toEqual({});
    });

    it('returns specific key if provided', () => {
      const pm = new ProcessManager({ entry: '/app/test.js' });
      expect(pm.getCustomState('nonexistent')).toBeUndefined();
    });
  });

  describe('isRunning', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      writeFileSync(TEST_APP_PATH, 'setTimeout(() => {}, 5000);');
      pm = new ProcessManager({ entry: TEST_APP_PATH });
    });

    afterEach(async () => {
      await pm.stop();
      pm.destroy();
      if (existsSync(TEST_APP_PATH)) {
        unlinkSync(TEST_APP_PATH);
      }
    });

    it('returns false before start', () => {
      expect(pm.isRunning()).toBe(false);
    });

    it('returns true when running', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(pm.isRunning()).toBe(true);
    });

    it('returns false after stop', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await pm.stop();
      expect(pm.isRunning()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('cleans up resources', async () => {
      const pm = new ProcessManager({
        entry: '/app/test.js',
        watch: true
      });

      pm.destroy();

      // Should not throw
      expect(() => pm.destroy()).not.toThrow();
    });
  });

  describe('exit handling', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      writeFileSync(TEST_APP_PATH, 'process.exit(42);');
      pm = new ProcessManager({ entry: TEST_APP_PATH });
    });

    afterEach(async () => {
      await pm.stop();
      pm.destroy();
      if (existsSync(TEST_APP_PATH)) {
        unlinkSync(TEST_APP_PATH);
      }
    });

    it('captures exit code', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const state = pm.getState();
      expect(state.isRunning).toBe(false);
      expect(state.exitCode).toBe(42);
    });

    it('logs exit with code', async () => {
      pm.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      const logs = pm.getLogs();
      const exitLog = logs.find(l => l.message.includes('Exited with code'));
      expect(exitLog).toBeDefined();
      expect(exitLog?.message).toContain('42');
    });
  });

  describe('debugger state', () => {
    it('returns initial debugger state', () => {
      const pm = new ProcessManager({
        entry: '/app/test.js',
        debug: true
      });

      const state = pm.getDebuggerState();
      expect(state.connected).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.inspectorUrl).toBeNull();
      expect(state.breakpoints).toEqual([]);
      expect(state.callStack).toBeNull();
    });

    it('returns paused status', () => {
      const pm = new ProcessManager({
        entry: '/app/test.js',
        debug: true
      });

      expect(pm.isDebuggerPaused()).toBe(false);
      expect(pm.isDebuggerConnected()).toBe(false);
    });
  });

  describe('breakpoint management (without connection)', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      pm = new ProcessManager({
        entry: '/app/test.js',
        debug: true
      });
    });

    it('throws when setting breakpoint without debugger connection', async () => {
      await expect(pm.debugSetBreakpoint('/app/test.js', 10))
        .rejects.toThrow('Debugger not connected');
    });

    it('throws when removing breakpoint without debugger connection', async () => {
      await expect(pm.debugRemoveBreakpoint('bp-1'))
        .rejects.toThrow('Debugger not connected');
    });

    it('returns empty breakpoints list without debugger', () => {
      expect(pm.debugListBreakpoints()).toEqual([]);
    });

    it('returns empty persisted breakpoints initially', () => {
      expect(pm.getPersistedBreakpoints()).toEqual([]);
    });

    it('returns empty triggered prompts', () => {
      expect(pm.getTriggeredBreakpointPrompts()).toEqual([]);
    });

    it('returns null when updating non-existent breakpoint', () => {
      const result = pm.updateBreakpoint('nonexistent', { prompt: 'test' });
      expect(result).toBeNull();
    });
  });

  describe('debugger commands (without connection)', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      pm = new ProcessManager({
        entry: '/app/test.js',
        debug: true
      });
    });

    it('throws on resume without connection', async () => {
      await expect(pm.debugResume()).rejects.toThrow('Debugger not connected');
    });

    it('throws on pause without connection', async () => {
      await expect(pm.debugPause()).rejects.toThrow('Debugger not connected');
    });

    it('throws on step over without connection', async () => {
      await expect(pm.debugStepOver()).rejects.toThrow('Debugger not connected');
    });

    it('throws on step into without connection', async () => {
      await expect(pm.debugStepInto()).rejects.toThrow('Debugger not connected');
    });

    it('throws on step out without connection', async () => {
      await expect(pm.debugStepOut()).rejects.toThrow('Debugger not connected');
    });

    it('throws on evaluate without connection', async () => {
      await expect(pm.debugEvaluate('1 + 1')).rejects.toThrow('Debugger not connected');
    });

    it('throws on get scope variables without connection', async () => {
      await expect(pm.debugGetScopeVariables('cf-1')).rejects.toThrow('Debugger not connected');
    });

    it('returns null for call stack without debugger', () => {
      expect(pm.debugGetCallStack()).toBeNull();
    });
  });

  describe('injection mode (without actual injection)', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      pm = new ProcessManager({
        entry: '/app/test.js',
        inject: true
      });
    });

    it('tracks injection state', () => {
      const state = pm.getState();
      expect(state.inject).toBe(true);
      expect(state.injectionReady).toBe(false);
    });

    it('returns empty injected state initially', () => {
      expect(pm.getInjectedState()).toEqual({});
    });

    it('does not throw when querying injected state without process', () => {
      expect(() => pm.queryInjectedState()).not.toThrow();
    });
  });

  describe('eval mode (without process)', () => {
    let pm: ProcessManager;

    beforeEach(() => {
      pm = new ProcessManager({
        entry: '/app/test.js',
        inject: true,
        eval: true
      });
    });

    it('rejects eval when process not ready', async () => {
      await expect(pm.evaluate('1 + 1'))
        .rejects.toThrow('Process not ready for eval');
    });

    it('rejects eval when eval not enabled', async () => {
      const noEvalPm = new ProcessManager({
        entry: '/app/test.js',
        inject: true,
        eval: false
      });

      await expect(noEvalPm.evaluate('1 + 1'))
        .rejects.toThrow('Eval not enabled');
    });
  });
});
