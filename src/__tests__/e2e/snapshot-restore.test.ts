/**
 * E2E Tests for Snapshot/Restore Flow
 *
 * Tests the complete snapshot and restore workflow using mock sandbox.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MultiSandboxManager } from '../../managers/multi-sandbox-manager.js';
import { MemoryStorage } from '../../sandbox/storage.js';

// Inline mock class to avoid hoisting issues
class InlineMockSandbox {
  sandboxId = 'mock-sandbox-' + Math.random().toString(36).slice(2);
  files: Map<string, string> = new Map();
  isRunning = false;
  private _nodeProcessResolve: (() => void) | null = null;

  static async create(): Promise<InlineMockSandbox> {
    return new InlineMockSandbox();
  }

  async writeFiles(files: { path: string; content: Buffer }[]): Promise<void> {
    files.forEach(f => this.files.set(f.path, f.content.toString()));
  }

  async readFileToBuffer(file: { path: string }): Promise<Buffer | null> {
    const content = this.files.get(file.path);
    return content ? Buffer.from(content) : null;
  }

  async runCommand(options: { cmd: string; args?: string[] }): Promise<{
    exitCode: number;
    stdout: () => Promise<string>;
    stderr: () => Promise<string>;
  }> {
    const args = options.args || [];

    if (options.cmd === 'cat' && args[0] === '/tmp/reflexive-logs.jsonl') {
      const logContent = this.files.get('/tmp/reflexive-logs.jsonl') || '';
      return { exitCode: 0, stdout: async () => logContent, stderr: async () => '' };
    }

    if (options.cmd === 'node') {
      this.isRunning = true;
      return new Promise((resolve) => {
        this._nodeProcessResolve = () => {
          resolve({ exitCode: 0, stdout: async () => '', stderr: async () => '' });
        };
      });
    }

    if (options.cmd === 'ls') {
      const path = args[args.length - 1] || '/';
      const entries: string[] = [];
      for (const key of this.files.keys()) {
        if (key.startsWith(path)) {
          const rest = key.slice(path.length).replace(/^\//, '');
          const parts = rest.split('/');
          if (parts[0] && !entries.includes(parts[0])) {
            entries.push(parts[0]);
          }
        }
      }
      return { exitCode: 0, stdout: async () => entries.join('\n'), stderr: async () => '' };
    }

    return { exitCode: 0, stdout: async () => '', stderr: async () => '' };
  }

  async shutdown(): Promise<void> {
    this.isRunning = false;
    if (this._nodeProcessResolve) {
      this._nodeProcessResolve();
      this._nodeProcessResolve = null;
    }
  }
}

// Mock @vercel/sandbox
vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: async () => InlineMockSandbox.create()
  }
}));

describe('Snapshot/Restore E2E', () => {
  let manager: MultiSandboxManager;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    manager = new MultiSandboxManager({
      maxSandboxes: 10,
      storage,
    });
  });

  afterEach(async () => {
    await manager.destroyAll();
  });

  describe('Basic Snapshot Flow', () => {
    it('should create and restore from snapshot', async () => {
      // Create sandbox and add some files
      await manager.create('original');
      await manager.uploadFiles('original', [
        { path: '/app/main.js', content: 'console.log("original")' },
        { path: '/app/config.json', content: '{"port": 3000}' },
      ]);

      // Start the sandbox
      await manager.start('original', '/app/main.js');
      expect(manager.get('original')?.status).toBe('running');

      // Create snapshot
      const { snapshotId } = await manager.snapshot('original', {
        files: ['/app/main.js', '/app/config.json'],
      });

      // Verify snapshot was saved
      const snapshots = await manager.listSnapshots();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].id).toBe(snapshotId);

      // Stop and destroy original
      await manager.stop('original');
      await manager.destroy('original');
      expect(manager.get('original')).toBeUndefined();

      // Resume from snapshot
      const { id: newId } = await manager.resume(snapshotId);
      expect(manager.get(newId)).toBeDefined();
      expect(manager.get(newId)?.status).toBe('created');
    });

    it('should preserve files across snapshot/restore', async () => {
      // Create and write files
      await manager.create('original');
      await manager.writeFile('original', '/app/data.txt', 'important data');

      // Snapshot
      const { snapshotId } = await manager.snapshot('original', {
        files: ['/app/data.txt'],
      });

      // Verify snapshot contains file
      const snapshot = await manager.getSnapshot(snapshotId);
      expect(snapshot?.files).toHaveLength(1);
      expect(snapshot?.files[0].path).toBe('/app/data.txt');
      expect(snapshot?.files[0].content).toBe('important data');

      // Resume
      const { id: newId } = await manager.resume(snapshotId);

      // File should be restored
      const content = await manager.readFile(newId, '/app/data.txt');
      expect(content).toBe('important data');
    });
  });

  describe('Multiple Snapshots', () => {
    it('should support multiple snapshots of same sandbox', async () => {
      await manager.create('sandbox-1');

      // Create multiple snapshots at different points
      await manager.writeFile('sandbox-1', '/app/version.txt', 'v1');
      const { snapshotId: snap1 } = await manager.snapshot('sandbox-1', {
        files: ['/app/version.txt'],
      });

      await manager.writeFile('sandbox-1', '/app/version.txt', 'v2');
      const { snapshotId: snap2 } = await manager.snapshot('sandbox-1', {
        files: ['/app/version.txt'],
      });

      // List should show both
      const snapshots = await manager.listSnapshots();
      expect(snapshots).toHaveLength(2);

      // Resume from first snapshot (v1)
      const { id: id1 } = await manager.resume(snap1, { newId: 'restore-v1' });
      const v1Content = await manager.readFile(id1, '/app/version.txt');
      expect(v1Content).toBe('v1');

      // Resume from second snapshot (v2)
      const { id: id2 } = await manager.resume(snap2, { newId: 'restore-v2' });
      const v2Content = await manager.readFile(id2, '/app/version.txt');
      expect(v2Content).toBe('v2');
    });

    it('should delete individual snapshots', async () => {
      await manager.create('sandbox-1');
      const { snapshotId: snap1 } = await manager.snapshot('sandbox-1');
      const { snapshotId: snap2 } = await manager.snapshot('sandbox-1');
      const { snapshotId: snap3 } = await manager.snapshot('sandbox-1');

      expect((await manager.listSnapshots()).length).toBe(3);

      await manager.deleteSnapshot(snap2);

      const remaining = await manager.listSnapshots();
      expect(remaining.length).toBe(2);
      expect(remaining.map(s => s.id)).not.toContain(snap2);
    });
  });

  describe('Sandbox Lifecycle with Snapshots', () => {
    it('should snapshot running sandbox', async () => {
      await manager.create('running-sandbox');
      await manager.start('running-sandbox', '/app/main.js');

      expect(manager.get('running-sandbox')?.status).toBe('running');

      const { snapshotId } = await manager.snapshot('running-sandbox');

      expect(snapshotId).toMatch(/^snap_/);
      expect((await manager.listSnapshots()).length).toBe(1);
    });

    it('should snapshot stopped sandbox', async () => {
      await manager.create('stopped-sandbox');
      await manager.start('stopped-sandbox', '/app/main.js');
      await manager.stop('stopped-sandbox');

      expect(manager.get('stopped-sandbox')?.status).toBe('stopped');

      const { snapshotId } = await manager.snapshot('stopped-sandbox');

      expect(snapshotId).toMatch(/^snap_/);
    });

    it('should resume to a new sandbox when original is destroyed', async () => {
      await manager.create('temp-sandbox');
      await manager.writeFile('temp-sandbox', '/app/app.js', 'temp code');
      const { snapshotId } = await manager.snapshot('temp-sandbox', {
        files: ['/app/app.js'],
      });

      // Destroy the original
      await manager.destroy('temp-sandbox');
      expect(manager.count()).toBe(0);

      // Resume should work
      const { id } = await manager.resume(snapshotId);
      expect(manager.count()).toBe(1);
      expect(manager.get(id)).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should fail to resume from non-existent snapshot', async () => {
      await expect(manager.resume('non-existent-snapshot')).rejects.toThrow(
        "Snapshot 'non-existent-snapshot' not found"
      );
    });

    it('should fail to snapshot non-existent sandbox', async () => {
      await expect(manager.snapshot('non-existent-sandbox')).rejects.toThrow(
        "Sandbox 'non-existent-sandbox' not found"
      );
    });

    it('should fail to delete non-existent snapshot', async () => {
      await expect(manager.deleteSnapshot('non-existent')).rejects.toThrow(
        "Snapshot 'non-existent' not found"
      );
    });

    it('should fail to resume with duplicate ID', async () => {
      await manager.create('sandbox-1');
      const { snapshotId } = await manager.snapshot('sandbox-1');

      await expect(manager.resume(snapshotId, { newId: 'sandbox-1' })).rejects.toThrow(
        "Sandbox with id 'sandbox-1' already exists"
      );
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent snapshots', async () => {
      await manager.create('sandbox-1');
      await manager.create('sandbox-2');
      await manager.create('sandbox-3');

      // Create snapshots concurrently
      const results = await Promise.all([
        manager.snapshot('sandbox-1'),
        manager.snapshot('sandbox-2'),
        manager.snapshot('sandbox-3'),
      ]);

      expect(results).toHaveLength(3);
      expect(new Set(results.map(r => r.snapshotId)).size).toBe(3);

      const snapshots = await manager.listSnapshots();
      expect(snapshots).toHaveLength(3);
    });

    it('should handle multiple resumes from same snapshot', async () => {
      await manager.create('original');
      const { snapshotId } = await manager.snapshot('original');

      // Resume to multiple sandboxes sequentially
      // (parallel resume might race with module loading)
      const result1 = await manager.resume(snapshotId, { newId: 'clone-1' });
      const result2 = await manager.resume(snapshotId, { newId: 'clone-2' });
      const result3 = await manager.resume(snapshotId, { newId: 'clone-3' });

      expect(result1.id).toBe('clone-1');
      expect(result2.id).toBe('clone-2');
      expect(result3.id).toBe('clone-3');
      expect(manager.count()).toBe(4); // original + 3 clones
    });
  });

  describe('Large Data Handling', () => {
    it('should handle snapshots with many files', async () => {
      await manager.create('many-files');

      // Write many files
      const files = Array.from({ length: 50 }, (_, i) => ({
        path: `/app/file${i}.js`,
        content: `// File ${i}\nconsole.log(${i});`,
      }));
      await manager.uploadFiles('many-files', files);

      // Snapshot
      const { snapshotId } = await manager.snapshot('many-files', {
        files: files.map(f => f.path),
      });

      const snapshot = await manager.getSnapshot(snapshotId);
      expect(snapshot?.files.length).toBe(50);

      // Resume and verify
      const { id } = await manager.resume(snapshotId, { newId: 'restore-many' });

      const content = await manager.readFile(id, '/app/file25.js');
      expect(content).toContain('console.log(25)');
    });
  });
});
