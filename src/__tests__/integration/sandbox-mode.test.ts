/**
 * Integration tests for Sandbox Mode
 *
 * Tests the SandboxManager with mock sandbox to verify:
 * - Sandbox lifecycle (create, start, stop, restart, destroy)
 * - Log polling and parsing
 * - File operations
 * - Command execution
 * - Custom state tracking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SandboxManager } from '../../managers/sandbox-manager.js';
import { MockSandbox } from '../mocks/sandbox-mock.js';

// Mock the @vercel/sandbox module
vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: async (opts: unknown) => MockSandbox.create(opts as Record<string, unknown>)
  }
}));

describe('SandboxManager Integration', () => {
  let manager: SandboxManager;

  beforeEach(() => {
    manager = new SandboxManager({
      vcpus: 2,
      memory: 2048,
      timeout: '30m'
    });
  });

  afterEach(async () => {
    await manager.destroy();
  });

  describe('lifecycle', () => {
    it('creates a sandbox', async () => {
      expect(manager.isCreated()).toBe(false);

      await manager.create();

      expect(manager.isCreated()).toBe(true);
      expect(manager.isRunning()).toBe(false);
    });

    it('throws when creating sandbox twice', async () => {
      await manager.create();

      await expect(manager.create()).rejects.toThrow('Sandbox already created');
    });

    it('starts the sandbox with entry file', async () => {
      await manager.create();

      await manager.start('/app/app.js');

      expect(manager.isRunning()).toBe(true);
      const state = manager.getState();
      expect(state.entry).toBe('/app/app.js');
    });

    it('throws when starting without creation', async () => {
      await expect(manager.start('/app/app.js')).rejects.toThrow('Sandbox not created');
    });

    it('stops a running sandbox', async () => {
      await manager.create();
      await manager.start('/app/app.js');

      await manager.stop();

      expect(manager.isRunning()).toBe(false);
    });

    it('restarts the sandbox', async () => {
      await manager.create();
      await manager.start('/app/app.js');

      await manager.restart();

      expect(manager.isRunning()).toBe(true);
    });

    it('throws when restarting without entry file', async () => {
      await manager.create();

      await expect(manager.restart()).rejects.toThrow('No entry file set');
    });

    it('destroys the sandbox', async () => {
      await manager.create();
      await manager.start('/app/app.js');

      await manager.destroy();

      expect(manager.isCreated()).toBe(false);
      expect(manager.isRunning()).toBe(false);
    });
  });

  describe('file operations', () => {
    beforeEach(async () => {
      await manager.create();
    });

    it('uploads files to sandbox', async () => {
      await manager.uploadFiles([
        { path: '/app/test.js', content: 'console.log("test");' }
      ]);

      const sandbox = manager.getSandbox() as MockSandbox;
      expect(sandbox.files.get('/app/test.js')).toBe('console.log("test");');
    });

    it('reads files from sandbox', async () => {
      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.files.set('/app/data.txt', 'Hello World');

      const content = await manager.readFile('/app/data.txt');

      expect(content).toBe('Hello World');
    });

    it('throws when reading non-existent file', async () => {
      await expect(manager.readFile('/nonexistent')).rejects.toThrow('File not found');
    });

    it('writes files to sandbox', async () => {
      await manager.writeFile('/app/new.js', 'const x = 1;');

      const sandbox = manager.getSandbox() as MockSandbox;
      expect(sandbox.files.get('/app/new.js')).toBe('const x = 1;');
    });

    it('lists files in directory', async () => {
      const sandbox = manager.getSandbox() as MockSandbox;
      // Mock the runCommand to return file list
      const originalRunCommand = sandbox.runCommand.bind(sandbox);
      sandbox.runCommand = async (opts: { cmd: string; args?: string[] }) => {
        if (opts.cmd === 'ls') {
          return {
            exitCode: 0,
            stdout: async () => 'app.js\nconfig.js\nutils.js',
            stderr: async () => ''
          };
        }
        return originalRunCommand(opts);
      };

      const files = await manager.listFiles('/app');

      expect(files).toContain('app.js');
      expect(files).toContain('config.js');
      expect(files).toContain('utils.js');
    });
  });

  describe('command execution', () => {
    beforeEach(async () => {
      await manager.create();
    });

    it('runs commands in sandbox', async () => {
      const result = await manager.runCommand('echo', ['hello']);

      const sandbox = manager.getSandbox() as MockSandbox;
      const lastCommand = sandbox.commands[sandbox.commands.length - 1];
      expect(lastCommand.cmd).toBe('echo');
      expect(lastCommand.args).toContain('hello');
    });

    it('returns command output', async () => {
      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.runCommand = async () => ({
        exitCode: 0,
        stdout: async () => 'command output',
        stderr: async () => ''
      });

      const result = await manager.runCommand('test');

      expect(result.stdout).toBe('command output');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('log polling', () => {
    beforeEach(async () => {
      await manager.create();
    });

    it('polls logs from sandbox', async () => {
      await manager.start('/app/app.js');

      // Simulate log entries in sandbox
      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.files.set('/tmp/reflexive-logs.jsonl',
        '{"type":"log","data":{"level":"info","message":"Hello world"},"ts":1706200000000}\n' +
        '{"type":"log","data":{"level":"error","message":"Error occurred"},"ts":1706200001000}\n'
      );

      await manager.pollLogs();

      const logs = manager.getLogs();
      expect(logs.some(l => l.message === 'Hello world')).toBe(true);
      expect(logs.some(l => l.message === 'Error occurred')).toBe(true);
    });

    it('tracks custom state from logs', async () => {
      await manager.start('/app/app.js');

      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.files.set('/tmp/reflexive-logs.jsonl',
        '{"type":"state","data":{"key":"count","value":42},"ts":1706200000000}\n'
      );

      await manager.pollLogs();

      expect(manager.getCustomState('count')).toBe(42);
    });

    it('returns all custom state', async () => {
      await manager.start('/app/app.js');

      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.files.set('/tmp/reflexive-logs.jsonl',
        '{"type":"state","data":{"key":"users","value":100},"ts":1706200000000}\n' +
        '{"type":"state","data":{"key":"active","value":true},"ts":1706200001000}\n'
      );

      await manager.pollLogs();

      const state = manager.getCustomState() as Record<string, unknown>;
      expect(state.users).toBe(100);
      expect(state.active).toBe(true);
    });

    it('processes ready message', async () => {
      const readyHandler = vi.fn();
      manager.on('injectionReady', readyHandler);

      await manager.start('/app/app.js');

      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.files.set('/tmp/reflexive-logs.jsonl',
        '{"type":"ready","data":{"pid":1234,"nodeVersion":"v22.0.0","platform":"linux"},"ts":1706200000000}\n'
      );

      await manager.pollLogs();

      expect(readyHandler).toHaveBeenCalledWith(
        expect.objectContaining({ pid: 1234, nodeVersion: 'v22.0.0' })
      );
    });

    it('processes error messages', async () => {
      await manager.start('/app/app.js');

      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.files.set('/tmp/reflexive-logs.jsonl',
        '{"type":"error","data":{"errorType":"uncaughtException","name":"TypeError","message":"undefined is not a function","stack":"..."},"ts":1706200000000}\n'
      );

      await manager.pollLogs();

      const logs = manager.getLogs();
      const errorLog = logs.find(l => l.type === 'inject:error');
      expect(errorLog).toBeDefined();
      expect(errorLog?.message).toContain('TypeError');
    });
  });

  describe('logs and search', () => {
    beforeEach(async () => {
      await manager.create();
      await manager.start('/app/app.js');

      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.files.set('/tmp/reflexive-logs.jsonl',
        '{"type":"log","data":{"level":"info","message":"Starting server"},"ts":1706200000000}\n' +
        '{"type":"log","data":{"level":"info","message":"Listening on port 3000"},"ts":1706200001000}\n' +
        '{"type":"log","data":{"level":"error","message":"Connection failed"},"ts":1706200002000}\n'
      );

      await manager.pollLogs();
    });

    it('gets logs with limit', () => {
      const logs = manager.getLogs(2);
      expect(logs.length).toBeLessThanOrEqual(2);
    });

    it('filters logs by type', () => {
      const logs = manager.getLogs(50, 'inject:error');
      expect(logs.every(l => l.type === 'inject:error')).toBe(true);
    });

    it('searches logs', () => {
      const allLogs = manager.getLogs(100);
      // Debug: check what logs exist
      const results = manager.searchLogs('port');
      // Logs may include "port" in message like "Listening on port 3000"
      expect(results.length).toBeGreaterThan(0);
    });

    it('searches are case-insensitive', () => {
      // Search is case-insensitive
      const resultsLower = manager.searchLogs('port');
      const resultsUpper = manager.searchLogs('PORT');
      expect(resultsLower.length).toBe(resultsUpper.length);
    });
  });

  describe('events', () => {
    it('emits events on lifecycle changes', async () => {
      const createdHandler = vi.fn();
      const startedHandler = vi.fn();
      const destroyedHandler = vi.fn();

      manager.on('created', createdHandler);
      manager.on('started', startedHandler);
      manager.on('destroyed', destroyedHandler);

      await manager.create();
      expect(createdHandler).toHaveBeenCalled();

      await manager.start('/app/app.js');
      expect(startedHandler).toHaveBeenCalled();

      await manager.destroy();
      expect(destroyedHandler).toHaveBeenCalled();
    });

    it('allows unsubscribing from events', async () => {
      const handler = vi.fn();
      manager.on('created', handler);
      manager.off('created', handler);

      await manager.create();

      expect(handler).not.toHaveBeenCalled();
    });

    it('emits state change events', async () => {
      const stateHandler = vi.fn();
      manager.on('stateChange', stateHandler);

      await manager.create();
      await manager.start('/app/app.js');

      const sandbox = manager.getSandbox() as MockSandbox;
      sandbox.files.set('/tmp/reflexive-logs.jsonl',
        '{"type":"state","data":{"key":"counter","value":1},"ts":1706200000000}\n'
      );

      await manager.pollLogs();

      expect(stateHandler).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'counter', value: 1 })
      );
    });
  });

  describe('state', () => {
    it('returns complete state', async () => {
      await manager.create();
      await manager.start('/app/app.js', ['--port', '3000']);

      const state = manager.getState();

      expect(state.isCreated).toBe(true);
      expect(state.isRunning).toBe(true);
      expect(state.entry).toBe('/app/app.js');
      expect(state.entryArgs).toEqual(['--port', '3000']);
      expect(state.startedAt).toBeGreaterThan(0);
    });

    it('returns initial state', () => {
      const state = manager.getState();

      expect(state.isCreated).toBe(false);
      expect(state.isRunning).toBe(false);
      expect(state.entry).toBeNull();
      expect(state.customState).toEqual({});
    });
  });

  describe('inject script upload', () => {
    it('uploads inject script on start', async () => {
      await manager.create();
      await manager.start('/app/app.js');

      const sandbox = manager.getSandbox() as MockSandbox;
      const injectScript = sandbox.files.get('/app/sandbox-inject.js');

      expect(injectScript).toBeDefined();
      expect(injectScript).toContain('process.reflexive');
      expect(injectScript).toContain('/tmp/reflexive-logs.jsonl');
    });
  });
});
