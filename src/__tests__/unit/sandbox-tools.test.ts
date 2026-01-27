/**
 * Unit tests for Sandbox MCP Tools
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSandboxTools, getSandboxAllowedTools } from '../../mcp/sandbox-tools.js';
import { SandboxManager } from '../../managers/sandbox-manager.js';
import { MockSandbox } from '../mocks/sandbox-mock.js';
import type { Capabilities } from '../../types/index.js';

// Mock the @vercel/sandbox module
vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: async () => MockSandbox.create()
  }
}));

describe('Sandbox MCP Tools', () => {
  let sandboxManager: SandboxManager;
  let capabilities: Capabilities;

  beforeEach(async () => {
    sandboxManager = new SandboxManager();
    await sandboxManager.create();

    capabilities = {
      readFiles: true,
      writeFiles: true,
      shellAccess: true,
      restart: true,
      inject: false,
      eval: false,
      debug: false
    };
  });

  describe('createSandboxTools', () => {
    it('creates tools array', () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('includes core tools', () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('get_sandbox_status');
      expect(toolNames).toContain('get_logs');
      expect(toolNames).toContain('search_logs');
      expect(toolNames).toContain('get_custom_state');
    });

    it('includes file tools when readFiles enabled', () => {
      const tools = createSandboxTools({
        sandboxManager,
        capabilities: { ...capabilities, readFiles: true }
      });
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('list_files');
    });

    it('excludes file read tools when readFiles disabled', () => {
      const tools = createSandboxTools({
        sandboxManager,
        capabilities: { ...capabilities, readFiles: false }
      });
      const toolNames = tools.map(t => t.name);

      expect(toolNames).not.toContain('read_file');
      expect(toolNames).not.toContain('list_files');
    });

    it('includes write_file when writeFiles enabled', () => {
      const tools = createSandboxTools({
        sandboxManager,
        capabilities: { ...capabilities, writeFiles: true }
      });
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('write_file');
    });

    it('excludes write_file when writeFiles disabled', () => {
      const tools = createSandboxTools({
        sandboxManager,
        capabilities: { ...capabilities, writeFiles: false }
      });
      const toolNames = tools.map(t => t.name);

      expect(toolNames).not.toContain('write_file');
    });

    it('includes run_command when shellAccess enabled', () => {
      const tools = createSandboxTools({
        sandboxManager,
        capabilities: { ...capabilities, shellAccess: true }
      });
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('run_command');
    });

    it('excludes run_command when shellAccess disabled', () => {
      const tools = createSandboxTools({
        sandboxManager,
        capabilities: { ...capabilities, shellAccess: false }
      });
      const toolNames = tools.map(t => t.name);

      expect(toolNames).not.toContain('run_command');
    });

    it('includes restart tools when restart enabled', () => {
      const tools = createSandboxTools({
        sandboxManager,
        capabilities: { ...capabilities, restart: true }
      });
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('restart_sandbox');
      expect(toolNames).toContain('stop_sandbox');
    });
  });

  describe('get_sandbox_status tool', () => {
    it('returns sandbox state', async () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'get_sandbox_status')!;

      const result = await tool.handler({});

      expect(result.content[0].type).toBe('text');
      const state = JSON.parse(result.content[0].text);
      expect(state).toHaveProperty('isCreated');
      expect(state).toHaveProperty('isRunning');
    });
  });

  describe('get_logs tool', () => {
    it('returns logs', async () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'get_logs')!;

      const result = await tool.handler({});

      expect(result.content[0].type).toBe('text');
      const logs = JSON.parse(result.content[0].text);
      expect(Array.isArray(logs)).toBe(true);
    });

    it('accepts count parameter', async () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'get_logs')!;

      const result = await tool.handler({ count: 10 });

      expect(result.content[0].type).toBe('text');
    });
  });

  describe('search_logs tool', () => {
    it('searches logs', async () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'search_logs')!;

      const result = await tool.handler({ query: 'test' });

      expect(result.content[0].type).toBe('text');
    });
  });

  describe('get_custom_state tool', () => {
    it('returns custom state', async () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'get_custom_state')!;

      const result = await tool.handler({});

      expect(result.content[0].type).toBe('text');
      const state = JSON.parse(result.content[0].text);
      expect(typeof state).toBe('object');
    });

    it('accepts key parameter', async () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'get_custom_state')!;

      const result = await tool.handler({ key: 'myKey' });

      expect(result.content[0].type).toBe('text');
    });
  });

  describe('restart_sandbox tool', () => {
    it('returns error when restart not enabled', async () => {
      const tools = createSandboxTools({
        sandboxManager,
        capabilities: { ...capabilities, restart: false }
      });
      // restart_sandbox won't be in the list, so test via allowed tools
      const allowedTools = getSandboxAllowedTools({ ...capabilities, restart: false });
      expect(allowedTools).not.toContain('restart_sandbox');
    });
  });

  describe('read_file tool', () => {
    it('reads file from sandbox', async () => {
      const sandbox = sandboxManager.getSandbox() as MockSandbox;
      sandbox.files.set('/app/test.txt', 'file content');

      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'read_file')!;

      const result = await tool.handler({ path: '/app/test.txt' });

      expect(result.content[0].text).toBe('file content');
    });

    it('handles read errors', async () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'read_file')!;

      const result = await tool.handler({ path: '/nonexistent' });

      expect(result.isError).toBe(true);
    });
  });

  describe('write_file tool', () => {
    it('writes file to sandbox', async () => {
      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'write_file')!;

      const result = await tool.handler({ path: '/app/new.txt', content: 'new content' });

      const sandbox = sandboxManager.getSandbox() as MockSandbox;
      expect(sandbox.files.get('/app/new.txt')).toBe('new content');
    });
  });

  describe('run_command tool', () => {
    it('runs command in sandbox', async () => {
      const sandbox = sandboxManager.getSandbox() as MockSandbox;
      sandbox.runCommand = async () => ({
        exitCode: 0,
        stdout: async () => 'output',
        stderr: async () => ''
      });

      const tools = createSandboxTools({ sandboxManager, capabilities });
      const tool = tools.find(t => t.name === 'run_command')!;

      const result = await tool.handler({ cmd: 'echo', args: ['hello'] });

      const output = JSON.parse(result.content[0].text);
      expect(output.stdout).toBe('output');
      expect(output.exitCode).toBe(0);
    });
  });
});

describe('getSandboxAllowedTools', () => {
  it('returns core tools', () => {
    const tools = getSandboxAllowedTools({
      readFiles: false,
      writeFiles: false,
      shellAccess: false,
      restart: false,
      inject: false,
      eval: false,
      debug: false
    });

    expect(tools).toContain('get_sandbox_status');
    expect(tools).toContain('get_logs');
    expect(tools).toContain('search_logs');
    expect(tools).toContain('get_custom_state');
  });

  it('includes file tools based on capabilities', () => {
    const tools = getSandboxAllowedTools({
      readFiles: true,
      writeFiles: true,
      shellAccess: false,
      restart: false,
      inject: false,
      eval: false,
      debug: false
    });

    expect(tools).toContain('read_file');
    expect(tools).toContain('list_files');
    expect(tools).toContain('write_file');
  });

  it('includes shell tools based on capabilities', () => {
    const tools = getSandboxAllowedTools({
      readFiles: false,
      writeFiles: false,
      shellAccess: true,
      restart: false,
      inject: false,
      eval: false,
      debug: false
    });

    expect(tools).toContain('run_command');
  });

  it('includes restart tools based on capabilities', () => {
    const tools = getSandboxAllowedTools({
      readFiles: false,
      writeFiles: false,
      shellAccess: false,
      restart: true,
      inject: false,
      eval: false,
      debug: false
    });

    expect(tools).toContain('restart_sandbox');
    expect(tools).toContain('stop_sandbox');
  });
});
