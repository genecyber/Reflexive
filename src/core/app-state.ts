/**
 * AppState - Tracks logs and custom state for Reflexive
 *
 * This class maintains a circular buffer of logs and custom key-value state.
 * It emits events when state changes, allowing other components to react.
 */

import type { LogEntry, LogType, AppStatus, EventHandler } from '../types/index.js';

export interface AppStateOptions {
  maxLogs?: number;
}

export class AppState {
  private logs: LogEntry[] = [];
  private maxLogs: number;
  private startTime: number;
  private customState: Record<string, unknown> = {};
  private eventHandlers: Map<string, EventHandler[]> = new Map();

  constructor(options: AppStateOptions = {}) {
    this.maxLogs = options.maxLogs ?? 500;
    this.startTime = Date.now();
  }

  /**
   * Add a log entry to the circular buffer
   */
  log(type: LogType | string, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      type,
      message: String(message),
      timestamp: new Date().toISOString(),
      meta
    };

    this.logs.push(entry);

    // Maintain circular buffer
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.emit('log', entry);
  }

  /**
   * Get recent logs, optionally filtered by type
   */
  getLogs(count = 50, filter: string | null = null): LogEntry[] {
    let filtered = this.logs;

    if (filter) {
      filtered = this.logs.filter(l => l.type === filter);
    }

    return filtered.slice(-count);
  }

  /**
   * Search logs by message content (case-insensitive)
   */
  searchLogs(query: string): LogEntry[] {
    const lower = query.toLowerCase();
    return this.logs.filter(l => l.message.toLowerCase().includes(lower));
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
    this.emit('logsCleared', {});
  }

  /**
   * Set a custom state value
   */
  setState(key: string, value: unknown): void {
    const oldValue = this.customState[key];
    this.customState[key] = value;
    this.emit('stateChange', { key, value, oldValue });
  }

  /**
   * Get a custom state value or all state
   */
  getState(key?: string): unknown {
    if (key) {
      return this.customState[key];
    }
    return { ...this.customState };
  }

  /**
   * Delete a custom state key
   */
  deleteState(key: string): boolean {
    if (key in this.customState) {
      const oldValue = this.customState[key];
      delete this.customState[key];
      this.emit('stateDelete', { key, oldValue });
      return true;
    }
    return false;
  }

  /**
   * Clear all custom state
   */
  clearState(): void {
    this.customState = {};
    this.emit('stateCleared', {});
  }

  /**
   * Get application status including runtime stats
   */
  getStatus(): AppStatus {
    return {
      pid: process.pid,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memory: process.memoryUsage(),
      customState: { ...this.customState },
      startTime: this.startTime
    };
  }

  /**
   * Get the number of logs currently stored
   */
  getLogCount(): number {
    return this.logs.length;
  }

  /**
   * Get the maximum number of logs that can be stored
   */
  getMaxLogs(): number {
    return this.maxLogs;
  }

  /**
   * Subscribe to an event
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * Unsubscribe from an event
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to all subscribers
   */
  emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(h => {
      try {
        h(data);
      } catch (error) {
        // Don't let handler errors break the emit loop
        console.error(`Error in event handler for "${event}":`, error);
      }
    });
  }

  /**
   * Reset start time (useful for restart scenarios)
   */
  resetStartTime(): void {
    this.startTime = Date.now();
  }
}
