/**
 * MultiSandboxManager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MultiSandboxManager } from '../../managers/multi-sandbox-manager.js';
import { MemoryStorage } from '../../sandbox/storage.js';
import { MockSandbox } from '../mocks/sandbox-mock.js';

// Mock @vercel/sandbox
vi.mock('@vercel/sandbox', () => ({
  Sandbox: MockSandbox,
}));

describe('MultiSandboxManager', () => {
  let manager: MultiSandboxManager;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    manager = new MultiSandboxManager({
      maxSandboxes: 5,
      storage,
    });
  });

  afterEach(async () => {
    await manager.destroyAll();
  });

  describe('create', () => {
    it('should create a new sandbox', async () => {
      const instance = await manager.create('test-1');

      expect(instance.id).toBe('test-1');
      expect(instance.status).toBe('created');
      expect(instance.config.provider).toBe('vercel');
      expect(instance.createdAt).toBeGreaterThan(0);
    });

    it('should create sandbox with custom config', async () => {
      const instance = await manager.create('test-1', {
        vcpus: 4,
        memory: 4096,
      });

      expect(instance.config.vcpus).toBe(4);
      expect(instance.config.memory).toBe(4096);
    });

    it('should throw when ID already exists', async () => {
      await manager.create('test-1');

      await expect(manager.create('test-1')).rejects.toThrow(
        "Sandbox with id 'test-1' already exists"
      );
    });

    it('should throw when max sandboxes reached', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.create(`test-${i}`);
      }

      await expect(manager.create('test-5')).rejects.toThrow(
        'Maximum sandbox limit (5) reached'
      );
    });
  });

  describe('start', () => {
    it('should start a created sandbox', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js');

      const instance = manager.get('test-1');
      expect(instance?.status).toBe('running');
      expect(instance?.startedAt).toBeGreaterThan(0);
    });

    it('should start with arguments', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js', ['--port', '3000']);

      expect(manager.get('test-1')?.status).toBe('running');
    });

    it('should throw when sandbox not found', async () => {
      await expect(manager.start('non-existent', '/app/main.js')).rejects.toThrow(
        "Sandbox 'non-existent' not found"
      );
    });

    it('should throw when already running', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js');

      await expect(manager.start('test-1', '/app/main.js')).rejects.toThrow(
        "Sandbox 'test-1' is already running"
      );
    });
  });

  describe('stop', () => {
    it('should stop a running sandbox', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js');
      await manager.stop('test-1');

      const instance = manager.get('test-1');
      expect(instance?.status).toBe('stopped');
      expect(instance?.stoppedAt).toBeGreaterThan(0);
    });

    it('should be idempotent for stopped sandbox', async () => {
      await manager.create('test-1');
      await manager.stop('test-1');

      // Should not throw
      await manager.stop('test-1');
    });

    it('should throw when sandbox not found', async () => {
      await expect(manager.stop('non-existent')).rejects.toThrow(
        "Sandbox 'non-existent' not found"
      );
    });
  });

  describe('destroy', () => {
    it('should destroy a sandbox', async () => {
      await manager.create('test-1');
      await manager.destroy('test-1');

      expect(manager.get('test-1')).toBeUndefined();
      expect(manager.count()).toBe(0);
    });

    it('should be idempotent for non-existent sandbox', async () => {
      // Should not throw
      await manager.destroy('non-existent');
    });

    it('should stop running sandbox before destroying', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js');
      await manager.destroy('test-1');

      expect(manager.get('test-1')).toBeUndefined();
    });
  });

  describe('destroyAll', () => {
    it('should destroy all sandboxes', async () => {
      await manager.create('test-1');
      await manager.create('test-2');
      await manager.create('test-3');

      await manager.destroyAll();

      expect(manager.count()).toBe(0);
    });
  });

  describe('list', () => {
    it('should list all sandboxes', async () => {
      await manager.create('test-1');
      await manager.create('test-2');

      const list = manager.list();

      expect(list).toHaveLength(2);
      expect(list.map(s => s.id).sort()).toEqual(['test-1', 'test-2']);
    });

    it('should return empty array when no sandboxes', () => {
      expect(manager.list()).toEqual([]);
    });

    it('should return copies, not references', async () => {
      await manager.create('test-1');

      const list = manager.list();
      list[0].status = 'error';

      expect(manager.get('test-1')?.status).toBe('created');
    });
  });

  describe('get', () => {
    it('should get sandbox by ID', async () => {
      await manager.create('test-1');

      const sandbox = manager.get('test-1');

      expect(sandbox?.id).toBe('test-1');
    });

    it('should return undefined for non-existent sandbox', () => {
      expect(manager.get('non-existent')).toBeUndefined();
    });
  });

  describe('count', () => {
    it('should return count of sandboxes', async () => {
      expect(manager.count()).toBe(0);

      await manager.create('test-1');
      expect(manager.count()).toBe(1);

      await manager.create('test-2');
      expect(manager.count()).toBe(2);
    });
  });

  describe('runningCount', () => {
    it('should return count of running sandboxes', async () => {
      expect(manager.runningCount()).toBe(0);

      await manager.create('test-1');
      expect(manager.runningCount()).toBe(0);

      await manager.start('test-1', '/app/main.js');
      expect(manager.runningCount()).toBe(1);

      await manager.create('test-2');
      await manager.start('test-2', '/app/main.js');
      expect(manager.runningCount()).toBe(2);

      await manager.stop('test-1');
      expect(manager.runningCount()).toBe(1);
    });
  });

  describe('snapshot', () => {
    it('should create a snapshot of a sandbox', async () => {
      await manager.create('test-1');

      const result = await manager.snapshot('test-1');

      expect(result.snapshotId).toMatch(/^snap_/);
      expect(storage.size()).toBe(1);
    });

    it('should throw when sandbox not found', async () => {
      await expect(manager.snapshot('non-existent')).rejects.toThrow(
        "Sandbox 'non-existent' not found"
      );
    });
  });

  describe('listSnapshots', () => {
    it('should list all snapshots', async () => {
      await manager.create('test-1');
      await manager.snapshot('test-1');
      await manager.snapshot('test-1');

      const snapshots = await manager.listSnapshots();

      expect(snapshots).toHaveLength(2);
    });
  });

  describe('resume', () => {
    it('should resume from a snapshot', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await manager.resume(snapshotId);

      expect(result.id).toContain('test-1-resume');
      expect(manager.count()).toBe(2);
    });

    it('should resume with custom ID', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await manager.resume(snapshotId, { newId: 'test-2' });

      expect(result.id).toBe('test-2');
    });

    it('should throw when snapshot not found', async () => {
      await expect(manager.resume('non-existent')).rejects.toThrow(
        "Snapshot 'non-existent' not found"
      );
    });
  });

  describe('deleteSnapshot', () => {
    it('should delete a snapshot', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      await manager.deleteSnapshot(snapshotId);

      expect(storage.size()).toBe(0);
    });

    it('should throw when snapshot not found', async () => {
      await expect(manager.deleteSnapshot('non-existent')).rejects.toThrow(
        "Snapshot 'non-existent' not found"
      );
    });
  });

  describe('getLogs', () => {
    it('should get logs from a sandbox', async () => {
      await manager.create('test-1');

      const logs = manager.getLogs('test-1');

      expect(Array.isArray(logs)).toBe(true);
    });

    it('should throw when sandbox not found', () => {
      expect(() => manager.getLogs('non-existent')).toThrow(
        "Sandbox 'non-existent' not found"
      );
    });
  });

  describe('searchLogs', () => {
    it('should search logs from a sandbox', async () => {
      await manager.create('test-1');

      const logs = manager.searchLogs('test-1', 'test');

      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe('getCustomState', () => {
    it('should get custom state from a sandbox', async () => {
      await manager.create('test-1');

      const state = manager.getCustomState('test-1');

      expect(typeof state).toBe('object');
    });
  });

  describe('file operations', () => {
    it('should upload files to a sandbox', async () => {
      await manager.create('test-1');

      await manager.uploadFiles('test-1', [
        { path: '/app/test.js', content: 'console.log("test")' },
      ]);

      // Verify via readFile
      const content = await manager.readFile('test-1', '/app/test.js');
      expect(content).toBe('console.log("test")');
    });

    it('should write and read files', async () => {
      await manager.create('test-1');

      await manager.writeFile('test-1', '/app/test.js', 'console.log("test")');
      const content = await manager.readFile('test-1', '/app/test.js');

      expect(content).toBe('console.log("test")');
    });

    it('should list files', async () => {
      await manager.create('test-1');
      await manager.writeFile('test-1', '/app/test.js', 'test');

      const files = await manager.listFiles('test-1', '/app');

      expect(Array.isArray(files)).toBe(true);
    });
  });

  describe('runCommand', () => {
    it('should run a command in a sandbox', async () => {
      await manager.create('test-1');

      const result = await manager.runCommand('test-1', 'echo', ['hello']);

      expect(result.exitCode).toBe(0);
    });
  });

  describe('getManager', () => {
    it('should return the underlying SandboxManager', async () => {
      await manager.create('test-1');

      const sandboxManager = manager.getManager('test-1');

      expect(sandboxManager).toBeDefined();
      expect(sandboxManager.isCreated()).toBe(true);
    });
  });
});
