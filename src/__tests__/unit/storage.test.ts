/**
 * Storage Provider Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage, createStorageProvider } from '../../sandbox/storage.js';
import type { Snapshot } from '../../types/index.js';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  const createTestSnapshot = (id: string): Snapshot => ({
    id,
    sandboxId: 'test-sandbox',
    timestamp: Date.now(),
    files: [
      { path: '/app/test.js', content: 'console.log("test")', encoding: 'utf8' as const },
    ],
    state: { count: 42, name: 'test' },
    logs: [
      { type: 'info', message: 'test log', timestamp: new Date().toISOString() },
    ],
  });

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('save', () => {
    it('should save a snapshot', async () => {
      const snapshot = createTestSnapshot('snap-1');
      await storage.save(snapshot);

      expect(storage.size()).toBe(1);
    });

    it('should overwrite existing snapshot with same id', async () => {
      const snapshot1 = createTestSnapshot('snap-1');
      const snapshot2 = { ...createTestSnapshot('snap-1'), timestamp: Date.now() + 1000 };

      await storage.save(snapshot1);
      await storage.save(snapshot2);

      expect(storage.size()).toBe(1);
      const loaded = await storage.load('snap-1');
      expect(loaded?.timestamp).toBe(snapshot2.timestamp);
    });
  });

  describe('load', () => {
    it('should load an existing snapshot', async () => {
      const snapshot = createTestSnapshot('snap-1');
      await storage.save(snapshot);

      const loaded = await storage.load('snap-1');

      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe('snap-1');
      expect(loaded?.sandboxId).toBe('test-sandbox');
      expect(loaded?.files).toHaveLength(1);
      expect(loaded?.state).toEqual({ count: 42, name: 'test' });
    });

    it('should return null for non-existent snapshot', async () => {
      const loaded = await storage.load('non-existent');
      expect(loaded).toBeNull();
    });

    it('should return a deep copy (not reference)', async () => {
      const snapshot = createTestSnapshot('snap-1');
      await storage.save(snapshot);

      const loaded = await storage.load('snap-1');
      loaded!.state = { modified: true };

      const loadedAgain = await storage.load('snap-1');
      expect(loadedAgain?.state).toEqual({ count: 42, name: 'test' });
    });
  });

  describe('list', () => {
    it('should list all snapshots', async () => {
      await storage.save(createTestSnapshot('snap-1'));
      await storage.save(createTestSnapshot('snap-2'));
      await storage.save(createTestSnapshot('snap-3'));

      const snapshots = await storage.list();

      expect(snapshots).toHaveLength(3);
      expect(snapshots.map(s => s.id).sort()).toEqual(['snap-1', 'snap-2', 'snap-3']);
    });

    it('should return empty array when no snapshots', async () => {
      const snapshots = await storage.list();
      expect(snapshots).toEqual([]);
    });

    it('should return deep copies', async () => {
      await storage.save(createTestSnapshot('snap-1'));

      const list1 = await storage.list();
      list1[0].state = { modified: true };

      const list2 = await storage.list();
      expect(list2[0].state).toEqual({ count: 42, name: 'test' });
    });
  });

  describe('delete', () => {
    it('should delete an existing snapshot', async () => {
      await storage.save(createTestSnapshot('snap-1'));

      const result = await storage.delete('snap-1');

      expect(result).toBe(true);
      expect(storage.size()).toBe(0);
    });

    it('should return false for non-existent snapshot', async () => {
      const result = await storage.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true for existing snapshot', async () => {
      await storage.save(createTestSnapshot('snap-1'));

      const exists = await storage.exists('snap-1');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent snapshot', async () => {
      const exists = await storage.exists('non-existent');
      expect(exists).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all snapshots', async () => {
      await storage.save(createTestSnapshot('snap-1'));
      await storage.save(createTestSnapshot('snap-2'));

      storage.clear();

      expect(storage.size()).toBe(0);
    });
  });
});

describe('createStorageProvider', () => {
  it('should create MemoryStorage for memory provider', () => {
    const storage = createStorageProvider({ provider: 'memory' });
    expect(storage).toBeInstanceOf(MemoryStorage);
  });

  it('should throw for s3 without bucket', () => {
    expect(() => createStorageProvider({ provider: 's3' })).toThrow(
      'S3/R2 storage requires a bucket configuration'
    );
  });

  it('should throw for r2 without bucket', () => {
    expect(() => createStorageProvider({ provider: 'r2' })).toThrow(
      'S3/R2 storage requires a bucket configuration'
    );
  });

  it('should throw for unknown provider', () => {
    // @ts-expect-error Testing invalid provider
    expect(() => createStorageProvider({ provider: 'unknown' })).toThrow(
      'Unknown storage provider: unknown'
    );
  });
});
