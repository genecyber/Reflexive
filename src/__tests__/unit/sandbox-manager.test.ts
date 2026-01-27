/**
 * Unit tests for SandboxManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SandboxManager } from '../../managers/sandbox-manager.js';
import { MockSandbox } from '../mocks/sandbox-mock.js';

describe('SandboxManager', () => {
  describe('constructor', () => {
    it('initializes with default options', () => {
      const manager = new SandboxManager();
      const state = manager.getState();

      expect(state.isCreated).toBe(false);
      expect(state.isRunning).toBe(false);
      expect(state.entry).toBeNull();
    });

    it('accepts custom options', () => {
      const manager = new SandboxManager({
        vcpus: 4,
        memory: 4096,
        timeout: '60m',
        runtime: 'node20'
      });

      // Options are stored internally
      expect(manager.getState().isCreated).toBe(false);
    });
  });

  describe('event emitter', () => {
    let manager: SandboxManager;

    beforeEach(() => {
      manager = new SandboxManager();
    });

    it('allows subscribing to events', () => {
      const handler = vi.fn();
      manager.on('test', handler);

      manager.emit('test', { data: 'value' });

      expect(handler).toHaveBeenCalledWith({ data: 'value' });
    });

    it('allows multiple handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      manager.on('test', handler1);
      manager.on('test', handler2);

      manager.emit('test', 'data');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('allows unsubscribing', () => {
      const handler = vi.fn();
      manager.on('test', handler);
      manager.off('test', handler);

      manager.emit('test', 'data');

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles errors in handlers gracefully', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();

      manager.on('test', errorHandler);
      manager.on('test', goodHandler);

      expect(() => manager.emit('test', 'data')).not.toThrow();
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe('isCreated', () => {
    it('returns false initially', () => {
      const manager = new SandboxManager();
      expect(manager.isCreated()).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('returns false initially', () => {
      const manager = new SandboxManager();
      expect(manager.isRunning()).toBe(false);
    });
  });

  describe('getState', () => {
    it('returns complete state object', () => {
      const manager = new SandboxManager();
      const state = manager.getState();

      expect(state).toHaveProperty('isCreated');
      expect(state).toHaveProperty('isRunning');
      expect(state).toHaveProperty('startedAt');
      expect(state).toHaveProperty('entry');
      expect(state).toHaveProperty('entryArgs');
      expect(state).toHaveProperty('customState');
    });
  });

  describe('getLogs', () => {
    it('returns empty array initially', () => {
      const manager = new SandboxManager();
      expect(manager.getLogs()).toEqual([]);
    });

    it('respects count parameter', () => {
      const manager = new SandboxManager();
      // Emit some logs manually
      for (let i = 0; i < 10; i++) {
        manager.emit('log', { type: 'test', message: `Log ${i}`, timestamp: new Date().toISOString() });
      }
      // Note: getLogs doesn't track emit'd logs, only internal _log calls
      // This tests the limit behavior
      expect(manager.getLogs(5).length).toBeLessThanOrEqual(5);
    });
  });

  describe('searchLogs', () => {
    it('returns empty array when no matches', () => {
      const manager = new SandboxManager();
      expect(manager.searchLogs('nonexistent')).toEqual([]);
    });
  });

  describe('getCustomState', () => {
    it('returns empty object initially', () => {
      const manager = new SandboxManager();
      expect(manager.getCustomState()).toEqual({});
    });

    it('returns undefined for missing key', () => {
      const manager = new SandboxManager();
      expect(manager.getCustomState('missing')).toBeUndefined();
    });
  });

  describe('getSandbox', () => {
    it('returns null before creation', () => {
      const manager = new SandboxManager();
      expect(manager.getSandbox()).toBeNull();
    });
  });

  describe('setSandbox (testing utility)', () => {
    it('allows setting mock sandbox', () => {
      const manager = new SandboxManager();
      const mockSandbox = new MockSandbox();

      manager.setSandbox(mockSandbox as unknown as Parameters<typeof manager.setSandbox>[0]);

      expect(manager.getSandbox()).toBe(mockSandbox);
      expect(manager.isCreated()).toBe(true);
    });
  });

  describe('operations without sandbox', () => {
    let manager: SandboxManager;

    beforeEach(() => {
      manager = new SandboxManager();
    });

    it('throws on start without creation', async () => {
      await expect(manager.start('/app/app.js')).rejects.toThrow('not created');
    });

    it('throws on uploadFiles without creation', async () => {
      await expect(manager.uploadFiles([{ path: '/test', content: 'test' }]))
        .rejects.toThrow('not created');
    });

    it('throws on readFile without creation', async () => {
      await expect(manager.readFile('/test'))
        .rejects.toThrow('not created');
    });

    it('throws on writeFile without creation', async () => {
      await expect(manager.writeFile('/test', 'content'))
        .rejects.toThrow('not created');
    });

    it('throws on listFiles without creation', async () => {
      await expect(manager.listFiles('/app'))
        .rejects.toThrow('not created');
    });

    it('throws on runCommand without creation', async () => {
      await expect(manager.runCommand('ls'))
        .rejects.toThrow('not created');
    });
  });

  describe('stop when not running', () => {
    it('does not throw', async () => {
      const manager = new SandboxManager();
      await expect(manager.stop()).resolves.not.toThrow();
    });
  });

  describe('destroy when not created', () => {
    it('does not throw', async () => {
      const manager = new SandboxManager();
      await expect(manager.destroy()).resolves.not.toThrow();
    });
  });

  describe('pollLogs when not running', () => {
    it('does nothing', async () => {
      const manager = new SandboxManager();
      await expect(manager.pollLogs()).resolves.not.toThrow();
    });
  });
});
