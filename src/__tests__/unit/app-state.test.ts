import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppState } from '../../core/app-state.js';

describe('AppState', () => {
  let state: AppState;

  beforeEach(() => {
    state = new AppState();
  });

  describe('constructor', () => {
    it('creates with default options', () => {
      expect(state.getMaxLogs()).toBe(500);
      expect(state.getLogCount()).toBe(0);
    });

    it('accepts custom maxLogs option', () => {
      const customState = new AppState({ maxLogs: 100 });
      expect(customState.getMaxLogs()).toBe(100);
    });
  });

  describe('logs', () => {
    it('adds log entries with timestamp', () => {
      state.log('info', 'test message');
      const logs = state.getLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0].type).toBe('info');
      expect(logs[0].message).toBe('test message');
      expect(logs[0].timestamp).toBeDefined();
      expect(new Date(logs[0].timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('adds log entries with metadata', () => {
      state.log('error', 'error occurred', { code: 500, source: 'api' });
      const logs = state.getLogs();

      expect(logs[0].meta).toEqual({ code: 500, source: 'api' });
    });

    it('maintains circular buffer at maxLogs', () => {
      const smallState = new AppState({ maxLogs: 5 });

      for (let i = 0; i < 10; i++) {
        smallState.log('info', `message ${i}`);
      }

      const logs = smallState.getLogs();
      expect(logs).toHaveLength(5);
      expect(logs[0].message).toBe('message 5');
      expect(logs[4].message).toBe('message 9');
    });

    it('filters logs by type', () => {
      state.log('info', 'info message');
      state.log('error', 'error message');
      state.log('info', 'another info');

      const errors = state.getLogs(100, 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].type).toBe('error');
    });

    it('limits logs by count', () => {
      for (let i = 0; i < 10; i++) {
        state.log('info', `message ${i}`);
      }

      const logs = state.getLogs(3);
      expect(logs).toHaveLength(3);
      expect(logs[0].message).toBe('message 7');
    });

    it('searches logs case-insensitively', () => {
      state.log('info', 'Hello World');
      state.log('error', 'HELLO AGAIN');
      state.log('info', 'goodbye');

      const results = state.searchLogs('hello');
      expect(results).toHaveLength(2);
    });

    it('clears all logs', () => {
      state.log('info', 'message 1');
      state.log('info', 'message 2');

      state.clearLogs();

      expect(state.getLogCount()).toBe(0);
    });

    it('emits log event when adding entry', () => {
      const handler = vi.fn();
      state.on('log', handler);

      state.log('info', 'test');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'info',
        message: 'test'
      }));
    });
  });

  describe('state management', () => {
    it('stores and retrieves custom state', () => {
      state.setState('users', 42);
      expect(state.getState('users')).toBe(42);
    });

    it('returns all state when no key provided', () => {
      state.setState('a', 1);
      state.setState('b', 2);

      const allState = state.getState() as Record<string, unknown>;
      expect(allState).toEqual({ a: 1, b: 2 });
    });

    it('returns undefined for non-existent keys', () => {
      expect(state.getState('nonexistent')).toBeUndefined();
    });

    it('overwrites existing state', () => {
      state.setState('count', 1);
      state.setState('count', 2);
      expect(state.getState('count')).toBe(2);
    });

    it('handles complex values', () => {
      const complex = {
        nested: { array: [1, 2, 3] },
        date: new Date().toISOString()
      };
      state.setState('complex', complex);
      expect(state.getState('complex')).toEqual(complex);
    });

    it('deletes state keys', () => {
      state.setState('toDelete', 'value');
      expect(state.deleteState('toDelete')).toBe(true);
      expect(state.getState('toDelete')).toBeUndefined();
    });

    it('returns false when deleting non-existent key', () => {
      expect(state.deleteState('nonexistent')).toBe(false);
    });

    it('clears all state', () => {
      state.setState('a', 1);
      state.setState('b', 2);
      state.clearState();
      expect(state.getState()).toEqual({});
    });

    it('emits event on state change', () => {
      const events: unknown[] = [];
      state.on('stateChange', (e) => events.push(e));

      state.setState('count', 1);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        key: 'count',
        value: 1,
        oldValue: undefined
      });
    });

    it('includes old value in state change event', () => {
      state.setState('count', 1);

      const events: unknown[] = [];
      state.on('stateChange', (e) => events.push(e));

      state.setState('count', 2);

      expect(events[0]).toEqual({
        key: 'count',
        value: 2,
        oldValue: 1
      });
    });
  });

  describe('status', () => {
    it('returns current status with pid', () => {
      const status = state.getStatus();
      expect(status.pid).toBe(process.pid);
    });

    it('returns uptime in seconds', () => {
      const status = state.getStatus();
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });

    it('returns memory usage', () => {
      const status = state.getStatus();
      expect(status.memory).toBeDefined();
      expect(status.memory.heapUsed).toBeGreaterThan(0);
    });

    it('includes custom state in status', () => {
      state.setState('test', 'value');
      const status = state.getStatus();
      expect(status.customState).toEqual({ test: 'value' });
    });

    it('includes start time', () => {
      const status = state.getStatus();
      expect(status.startTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('events', () => {
    it('allows multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      state.on('log', handler1);
      state.on('log', handler2);

      state.log('info', 'test');

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('removes handlers with off()', () => {
      const handler = vi.fn();
      state.on('log', handler);
      state.off('log', handler);

      state.log('info', 'test');

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles errors in event handlers gracefully', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();

      state.on('log', errorHandler);
      state.on('log', goodHandler);

      // Should not throw
      expect(() => state.log('info', 'test')).not.toThrow();

      // Both handlers should have been called
      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });

    it('emits logsCleared event', () => {
      const handler = vi.fn();
      state.on('logsCleared', handler);

      state.clearLogs();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits stateDelete event', () => {
      state.setState('key', 'value');
      const handler = vi.fn();
      state.on('stateDelete', handler);

      state.deleteState('key');

      expect(handler).toHaveBeenCalledWith({
        key: 'key',
        oldValue: 'value'
      });
    });

    it('emits stateCleared event', () => {
      const handler = vi.fn();
      state.on('stateCleared', handler);

      state.clearState();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetStartTime', () => {
    it('resets the start time', async () => {
      const originalStatus = state.getStatus();

      // Wait a tiny bit
      await new Promise(r => setTimeout(r, 10));

      state.resetStartTime();
      const newStatus = state.getStatus();

      expect(newStatus.startTime).toBeGreaterThan(originalStatus.startTime);
      expect(newStatus.uptime).toBeLessThanOrEqual(originalStatus.uptime);
    });
  });
});
