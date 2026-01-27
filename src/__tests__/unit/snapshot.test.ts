/**
 * Snapshot Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSnapshot,
  restoreFromSnapshot,
  getSnapshotSize,
  validateSnapshot,
  createEmptySnapshot,
} from '../../sandbox/snapshot.js';
import type { Snapshot, LogEntry } from '../../types/index.js';
import type { SandboxManager, SandboxState } from '../../managers/sandbox-manager.js';

// Mock SandboxManager
function createMockManager(overrides: Partial<{
  customState: Record<string, unknown>;
  logs: LogEntry[];
  files: Map<string, string>;
}> = {}) {
  const files = overrides.files || new Map<string, string>();
  const customState = overrides.customState || {};
  const logs = overrides.logs || [];

  return {
    getCustomState: vi.fn((key?: string) => {
      if (key) return customState[key];
      return { ...customState };
    }),
    getLogs: vi.fn((count?: number) => {
      return logs.slice(-(count || 500));
    }),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    listFiles: vi.fn(async (path: string) => {
      const result: string[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(path)) {
          const rest = key.slice(path.length).replace(/^\//, '');
          const parts = rest.split('/');
          if (parts[0] && !result.includes(parts[0])) {
            result.push(parts[0]);
          }
        }
      }
      return result;
    }),
  } as unknown as SandboxManager;
}

describe('createSnapshot', () => {
  it('should create a snapshot with basic metadata', async () => {
    const manager = createMockManager();

    const snapshot = await createSnapshot('test-sandbox', manager);

    expect(snapshot.id).toMatch(/^snap_[a-z0-9]+_[a-z0-9]+$/);
    expect(snapshot.sandboxId).toBe('test-sandbox');
    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.files).toEqual([]);
    expect(snapshot.state).toEqual({});
    expect(snapshot.logs).toEqual([]);
  });

  it('should capture custom state', async () => {
    const manager = createMockManager({
      customState: { count: 42, users: ['alice', 'bob'] },
    });

    const snapshot = await createSnapshot('test-sandbox', manager);

    expect(snapshot.state).toEqual({ count: 42, users: ['alice', 'bob'] });
  });

  it('should capture logs', async () => {
    const logs: LogEntry[] = [
      { type: 'info', message: 'log 1', timestamp: '2024-01-01T00:00:00Z' },
      { type: 'error', message: 'log 2', timestamp: '2024-01-01T00:00:01Z' },
    ];
    const manager = createMockManager({ logs });

    const snapshot = await createSnapshot('test-sandbox', manager);

    expect(snapshot.logs).toHaveLength(2);
    expect(snapshot.logs[0].message).toBe('log 1');
  });

  it('should capture specified files', async () => {
    const files = new Map<string, string>([
      ['/app/main.js', 'console.log("main")'],
      ['/app/config.json', '{"port": 3000}'],
    ]);
    const manager = createMockManager({ files });

    const snapshot = await createSnapshot('test-sandbox', manager, {
      files: ['/app/main.js', '/app/config.json'],
    });

    expect(snapshot.files).toHaveLength(2);
    expect(snapshot.files[0]).toEqual({
      path: '/app/main.js',
      content: 'console.log("main")',
      encoding: 'utf8',
    });
  });

  it('should skip non-existent files', async () => {
    const files = new Map<string, string>([
      ['/app/main.js', 'console.log("main")'],
    ]);
    const manager = createMockManager({ files });

    const snapshot = await createSnapshot('test-sandbox', manager, {
      files: ['/app/main.js', '/app/missing.js'],
    });

    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0].path).toBe('/app/main.js');
  });

  it('should respect maxLogs option', async () => {
    const logs: LogEntry[] = Array.from({ length: 100 }, (_, i) => ({
      type: 'info',
      message: `log ${i}`,
      timestamp: new Date().toISOString(),
    }));
    const manager = createMockManager({ logs });

    const snapshot = await createSnapshot('test-sandbox', manager, {
      maxLogs: 10,
    });

    expect(manager.getLogs).toHaveBeenCalledWith(10);
  });

  it('should exclude state when includeState is false', async () => {
    const manager = createMockManager({
      customState: { count: 42 },
    });

    const snapshot = await createSnapshot('test-sandbox', manager, {
      includeState: false,
    });

    expect(snapshot.state).toEqual({});
    expect(manager.getCustomState).not.toHaveBeenCalled();
  });

  it('should exclude logs when includeLogs is false', async () => {
    const manager = createMockManager({
      logs: [{ type: 'info', message: 'test', timestamp: '' }],
    });

    const snapshot = await createSnapshot('test-sandbox', manager, {
      includeLogs: false,
    });

    expect(snapshot.logs).toEqual([]);
    expect(manager.getLogs).not.toHaveBeenCalled();
  });
});

describe('restoreFromSnapshot', () => {
  it('should restore files from snapshot', async () => {
    const files = new Map<string, string>();
    const manager = createMockManager({ files });

    const snapshot: Snapshot = {
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: Date.now(),
      files: [
        { path: '/app/main.js', content: 'console.log("restored")', encoding: 'utf8' },
        { path: '/app/config.json', content: '{"port": 4000}', encoding: 'utf8' },
      ],
      state: {},
      logs: [],
    };

    const result = await restoreFromSnapshot(manager, snapshot);

    expect(result.filesRestored).toBe(2);
    expect(manager.writeFile).toHaveBeenCalledTimes(2);
    expect(manager.writeFile).toHaveBeenCalledWith('/app/main.js', 'console.log("restored")');
  });

  it('should handle base64 encoded files', async () => {
    const files = new Map<string, string>();
    const manager = createMockManager({ files });

    const content = Buffer.from('hello world').toString('base64');
    const snapshot: Snapshot = {
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: Date.now(),
      files: [
        { path: '/app/data.bin', content, encoding: 'base64' },
      ],
      state: {},
      logs: [],
    };

    const result = await restoreFromSnapshot(manager, snapshot);

    expect(result.filesRestored).toBe(1);
    expect(manager.writeFile).toHaveBeenCalledWith('/app/data.bin', 'hello world');
  });

  it('should write state file when state exists', async () => {
    const files = new Map<string, string>();
    const manager = createMockManager({ files });

    const snapshot: Snapshot = {
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: Date.now(),
      files: [],
      state: { count: 42, name: 'test' },
      logs: [],
    };

    const result = await restoreFromSnapshot(manager, snapshot);

    expect(result.stateRestored).toBe(true);
    expect(manager.writeFile).toHaveBeenCalledWith(
      '/tmp/reflexive-state.json',
      JSON.stringify({ count: 42, name: 'test' })
    );
  });

  it('should not write state file when state is empty', async () => {
    const files = new Map<string, string>();
    const manager = createMockManager({ files });

    const snapshot: Snapshot = {
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: Date.now(),
      files: [],
      state: {},
      logs: [],
    };

    const result = await restoreFromSnapshot(manager, snapshot);

    expect(result.stateRestored).toBe(false);
  });

  it('should report logs that would be restored', async () => {
    const manager = createMockManager();

    const snapshot: Snapshot = {
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: Date.now(),
      files: [],
      state: {},
      logs: [
        { type: 'info', message: 'log 1', timestamp: '' },
        { type: 'info', message: 'log 2', timestamp: '' },
      ],
    };

    const result = await restoreFromSnapshot(manager, snapshot);

    expect(result.logsRestored).toBe(2);
  });

  it('should handle file write errors gracefully', async () => {
    const manager = createMockManager();
    vi.mocked(manager.writeFile).mockRejectedValueOnce(new Error('Write failed'));

    const snapshot: Snapshot = {
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: Date.now(),
      files: [
        { path: '/app/fail.js', content: 'fail', encoding: 'utf8' },
        { path: '/app/success.js', content: 'success', encoding: 'utf8' },
      ],
      state: {},
      logs: [],
    };

    const result = await restoreFromSnapshot(manager, snapshot);

    expect(result.filesRestored).toBe(1);
  });
});

describe('getSnapshotSize', () => {
  it('should calculate size of snapshot', () => {
    const snapshot: Snapshot = {
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: Date.now(),
      files: [
        { path: '/app/main.js', content: 'x'.repeat(1000), encoding: 'utf8' },
      ],
      state: { data: 'test' },
      logs: [{ type: 'info', message: 'test', timestamp: '' }],
    };

    const size = getSnapshotSize(snapshot);

    // Should include file path + content + state + logs + overhead
    expect(size).toBeGreaterThan(1000);
    expect(size).toBeLessThan(2000);
  });
});

describe('validateSnapshot', () => {
  it('should validate a correct snapshot', () => {
    const snapshot: Snapshot = {
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: Date.now(),
      files: [{ path: '/app/main.js', content: 'code', encoding: 'utf8' }],
      state: { count: 1 },
      logs: [{ type: 'info', message: 'test', timestamp: '' }],
    };

    expect(validateSnapshot(snapshot)).toBe(true);
  });

  it('should reject null', () => {
    expect(validateSnapshot(null)).toBe(false);
  });

  it('should reject non-object', () => {
    expect(validateSnapshot('string')).toBe(false);
    expect(validateSnapshot(123)).toBe(false);
  });

  it('should reject missing id', () => {
    expect(validateSnapshot({ sandboxId: 'test', timestamp: 123, files: [], state: {}, logs: [] })).toBe(false);
  });

  it('should reject empty id', () => {
    expect(validateSnapshot({ id: '', sandboxId: 'test', timestamp: 123, files: [], state: {}, logs: [] })).toBe(false);
  });

  it('should reject missing sandboxId', () => {
    expect(validateSnapshot({ id: 'snap-1', timestamp: 123, files: [], state: {}, logs: [] })).toBe(false);
  });

  it('should reject non-number timestamp', () => {
    expect(validateSnapshot({ id: 'snap-1', sandboxId: 'test', timestamp: '123', files: [], state: {}, logs: [] })).toBe(false);
  });

  it('should reject non-array files', () => {
    expect(validateSnapshot({ id: 'snap-1', sandboxId: 'test', timestamp: 123, files: {}, state: {}, logs: [] })).toBe(false);
  });

  it('should reject null state', () => {
    expect(validateSnapshot({ id: 'snap-1', sandboxId: 'test', timestamp: 123, files: [], state: null, logs: [] })).toBe(false);
  });

  it('should reject invalid file entry', () => {
    expect(validateSnapshot({
      id: 'snap-1',
      sandboxId: 'test',
      timestamp: 123,
      files: [{ path: '/test', content: 'x', encoding: 'invalid' }],
      state: {},
      logs: [],
    })).toBe(false);
  });
});

describe('createEmptySnapshot', () => {
  it('should create an empty snapshot', () => {
    const snapshot = createEmptySnapshot('test-sandbox');

    expect(snapshot.id).toMatch(/^snap_[a-z0-9]+_[a-z0-9]+$/);
    expect(snapshot.sandboxId).toBe('test-sandbox');
    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.files).toEqual([]);
    expect(snapshot.state).toEqual({});
    expect(snapshot.logs).toEqual([]);
  });
});
