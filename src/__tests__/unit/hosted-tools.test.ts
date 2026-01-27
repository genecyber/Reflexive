/**
 * Hosted Tools Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHostedTools, getHostedToolNames } from '../../mcp/hosted-tools.js';
import { MultiSandboxManager } from '../../managers/multi-sandbox-manager.js';
import { MemoryStorage } from '../../sandbox/storage.js';
import { MockSandbox } from '../mocks/sandbox-mock.js';
import type { AnyToolDefinition } from '../../mcp/tools.js';

// Mock @vercel/sandbox
vi.mock('@vercel/sandbox', () => ({
  Sandbox: MockSandbox,
}));

describe('Hosted Tools', () => {
  let manager: MultiSandboxManager;
  let tools: AnyToolDefinition[];

  function findTool(name: string): AnyToolDefinition {
    const tool = tools.find(t => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool;
  }

  async function runTool(name: string, input: Record<string, unknown>) {
    const tool = findTool(name);
    return tool.handler(input);
  }

  beforeEach(() => {
    const storage = new MemoryStorage();
    manager = new MultiSandboxManager({
      maxSandboxes: 5,
      storage,
    });
    tools = createHostedTools(manager);
  });

  afterEach(async () => {
    await manager.destroyAll();
  });

  describe('list_sandboxes', () => {
    it('should list all sandboxes', async () => {
      await manager.create('test-1');
      await manager.create('test-2');

      const result = await runTool('list_sandboxes', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(2);
      expect(data.sandboxes).toHaveLength(2);
    });

    it('should include running count', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js');

      const result = await runTool('list_sandboxes', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.running).toBe(1);
    });
  });

  describe('create_sandbox', () => {
    it('should create a sandbox', async () => {
      const result = await runTool('create_sandbox', { id: 'new-sandbox' });

      const data = JSON.parse(result.content[0].text);
      expect(data.message).toContain("'new-sandbox' created");
      expect(data.sandbox.id).toBe('new-sandbox');
      expect(result.isError).toBeFalsy();
    });

    it('should create sandbox with config', async () => {
      const result = await runTool('create_sandbox', {
        id: 'new-sandbox',
        vcpus: 4,
        memory: 4096,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.sandbox.config.vcpus).toBe(4);
      expect(data.sandbox.config.memory).toBe(4096);
    });

    it('should return error for duplicate id', async () => {
      await manager.create('test-1');

      const result = await runTool('create_sandbox', { id: 'test-1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('already exists');
    });
  });

  describe('start_sandbox', () => {
    it('should start a sandbox', async () => {
      await manager.create('test-1');

      const result = await runTool('start_sandbox', {
        id: 'test-1',
        entryFile: '/app/main.js',
      });

      expect(result.content[0].text).toContain("'test-1' started");
      expect(manager.get('test-1')?.status).toBe('running');
    });

    it('should start with arguments', async () => {
      await manager.create('test-1');

      const result = await runTool('start_sandbox', {
        id: 'test-1',
        entryFile: '/app/main.js',
        args: ['--port', '3000'],
      });

      expect(result.content[0].text).toContain('started');
    });

    it('should return error for non-existent sandbox', async () => {
      const result = await runTool('start_sandbox', {
        id: 'non-existent',
        entryFile: '/app/main.js',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('stop_sandbox', () => {
    it('should stop a sandbox', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js');

      const result = await runTool('stop_sandbox', { id: 'test-1' });

      expect(result.content[0].text).toContain("'test-1' stopped");
      expect(manager.get('test-1')?.status).toBe('stopped');
    });
  });

  describe('destroy_sandbox', () => {
    it('should destroy a sandbox', async () => {
      await manager.create('test-1');

      const result = await runTool('destroy_sandbox', { id: 'test-1' });

      expect(result.content[0].text).toContain("'test-1' destroyed");
      expect(manager.get('test-1')).toBeUndefined();
    });
  });

  describe('get_sandbox', () => {
    it('should get sandbox details', async () => {
      await manager.create('test-1');

      const result = await runTool('get_sandbox', { id: 'test-1' });

      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe('test-1');
      expect(data.status).toBe('created');
    });

    it('should return error for non-existent sandbox', async () => {
      const result = await runTool('get_sandbox', { id: 'non-existent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('create_snapshot', () => {
    it('should create a snapshot', async () => {
      await manager.create('test-1');

      const result = await runTool('create_snapshot', { id: 'test-1' });

      const data = JSON.parse(result.content[0].text);
      expect(data.message).toContain('Snapshot created');
      expect(data.snapshotId).toMatch(/^snap_/);
    });

    it('should accept specific files', async () => {
      await manager.create('test-1');

      const result = await runTool('create_snapshot', {
        id: 'test-1',
        files: ['/app/main.js'],
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('list_snapshots', () => {
    it('should list all snapshots', async () => {
      await manager.create('test-1');
      await manager.snapshot('test-1');
      await manager.snapshot('test-1');

      const result = await runTool('list_snapshots', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(2);
      expect(data.snapshots).toHaveLength(2);
    });

    it('should include snapshot metadata', async () => {
      await manager.create('test-1');
      await manager.snapshot('test-1');

      const result = await runTool('list_snapshots', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.snapshots[0]).toHaveProperty('id');
      expect(data.snapshots[0]).toHaveProperty('sandboxId');
      expect(data.snapshots[0]).toHaveProperty('timestamp');
      expect(data.snapshots[0]).toHaveProperty('date');
    });
  });

  describe('resume_from_snapshot', () => {
    it('should resume from snapshot', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await runTool('resume_from_snapshot', { snapshotId });

      const data = JSON.parse(result.content[0].text);
      expect(data.message).toContain('resumed');
      expect(data.sandboxId).toContain('test-1-resume');
    });

    it('should resume with custom ID', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await runTool('resume_from_snapshot', {
        snapshotId,
        newId: 'test-2',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.sandboxId).toBe('test-2');
    });
  });

  describe('delete_snapshot', () => {
    it('should delete a snapshot', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await runTool('delete_snapshot', { snapshotId });

      expect(result.content[0].text).toContain('deleted');
    });
  });

  describe('sandbox_get_logs', () => {
    it('should get logs', async () => {
      await manager.create('test-1');

      const result = await runTool('sandbox_get_logs', { id: 'test-1' });

      const data = JSON.parse(result.content[0].text);
      expect(data.sandboxId).toBe('test-1');
      expect(Array.isArray(data.logs)).toBe(true);
    });

    it('should search logs', async () => {
      await manager.create('test-1');

      const result = await runTool('sandbox_get_logs', {
        id: 'test-1',
        query: 'error',
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('sandbox_get_state', () => {
    it('should get state', async () => {
      await manager.create('test-1');

      const result = await runTool('sandbox_get_state', { id: 'test-1' });

      const data = JSON.parse(result.content[0].text);
      expect(data.sandboxId).toBe('test-1');
      expect(data.state).toBeDefined();
    });

    it('should get specific key', async () => {
      await manager.create('test-1');

      const result = await runTool('sandbox_get_state', {
        id: 'test-1',
        key: 'count',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.key).toBe('count');
    });
  });

  describe('sandbox_run_command', () => {
    it('should run a command', async () => {
      await manager.create('test-1');

      const result = await runTool('sandbox_run_command', {
        id: 'test-1',
        cmd: 'echo',
        args: ['hello'],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.sandboxId).toBe('test-1');
      expect(data.command).toBe('echo hello');
      expect(data.exitCode).toBe(0);
    });
  });

  describe('sandbox_read_file', () => {
    it('should read a file', async () => {
      await manager.create('test-1');
      await manager.writeFile('test-1', '/app/test.js', 'console.log("test")');

      const result = await runTool('sandbox_read_file', {
        id: 'test-1',
        path: '/app/test.js',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.sandboxId).toBe('test-1');
      expect(data.path).toBe('/app/test.js');
      expect(data.content).toBe('console.log("test")');
    });
  });

  describe('sandbox_write_file', () => {
    it('should write a file', async () => {
      await manager.create('test-1');

      const result = await runTool('sandbox_write_file', {
        id: 'test-1',
        path: '/app/test.js',
        content: 'console.log("test")',
      });

      expect(result.content[0].text).toContain('/app/test.js');
      expect(result.isError).toBeFalsy();
    });
  });

  describe('sandbox_list_files', () => {
    it('should list files', async () => {
      await manager.create('test-1');
      await manager.writeFile('test-1', '/app/test.js', 'test');

      const result = await runTool('sandbox_list_files', {
        id: 'test-1',
        path: '/app',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.sandboxId).toBe('test-1');
      expect(data.path).toBe('/app');
      expect(Array.isArray(data.files)).toBe(true);
    });
  });

  describe('sandbox_upload_files', () => {
    it('should upload multiple files', async () => {
      await manager.create('test-1');

      const result = await runTool('sandbox_upload_files', {
        id: 'test-1',
        files: [
          { path: '/app/a.js', content: 'a' },
          { path: '/app/b.js', content: 'b' },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.uploaded).toBe(2);
      expect(data.paths).toContain('/app/a.js');
      expect(data.paths).toContain('/app/b.js');
    });
  });
});

describe('getHostedToolNames', () => {
  it('should return all tool names', () => {
    const names = getHostedToolNames();

    expect(names).toContain('list_sandboxes');
    expect(names).toContain('create_sandbox');
    expect(names).toContain('start_sandbox');
    expect(names).toContain('stop_sandbox');
    expect(names).toContain('destroy_sandbox');
    expect(names).toContain('create_snapshot');
    expect(names).toContain('list_snapshots');
    expect(names).toContain('resume_from_snapshot');
    expect(names.length).toBeGreaterThan(10);
  });
});
