/**
 * MultiSandboxManager - Manages multiple sandbox instances for hosted mode
 *
 * Provides lifecycle control for multiple sandboxes with snapshot/restore capabilities.
 */

import type {
  SandboxConfig,
  SandboxInstance,
  LogEntry,
  Snapshot,
  SandboxFile,
  CommandResult,
  HostedConfig,
  MultiSandboxManagerInterface,
} from '../types/index.js';
import { SandboxManager } from './sandbox-manager.js';
import type { StorageProvider } from '../sandbox/storage.js';
import { MemoryStorage } from '../sandbox/storage.js';
import {
  createSnapshot,
  restoreFromSnapshot,
  captureDirectory,
} from '../sandbox/snapshot.js';

/**
 * Configuration for MultiSandboxManager
 */
export interface MultiSandboxManagerConfig {
  /**
   * Maximum number of concurrent sandboxes
   */
  maxSandboxes?: number;

  /**
   * Default timeout for sandboxes
   */
  defaultTimeout?: string | number;

  /**
   * Storage provider for snapshots
   */
  storage?: StorageProvider;

  /**
   * Default sandbox configuration
   */
  defaultSandboxConfig?: Partial<SandboxConfig>;
}

/**
 * Internal sandbox entry tracking both instance metadata and manager
 */
interface SandboxEntry {
  instance: SandboxInstance;
  manager: SandboxManager;
}

/**
 * MultiSandboxManager manages multiple sandbox instances with full lifecycle control
 */
export class MultiSandboxManager implements MultiSandboxManagerInterface {
  private config: Required<Omit<MultiSandboxManagerConfig, 'storage'>> & {
    storage: StorageProvider;
  };
  private sandboxes = new Map<string, SandboxEntry>();

  constructor(config: MultiSandboxManagerConfig = {}) {
    this.config = {
      maxSandboxes: config.maxSandboxes || 10,
      defaultTimeout: config.defaultTimeout || '30m',
      storage: config.storage || new MemoryStorage(),
      defaultSandboxConfig: config.defaultSandboxConfig || {},
    };
  }

  /**
   * Create a new sandbox instance
   */
  async create(id: string, sandboxConfig?: Partial<SandboxConfig>): Promise<SandboxInstance> {
    // Check if ID already exists
    if (this.sandboxes.has(id)) {
      throw new Error(`Sandbox with id '${id}' already exists`);
    }

    // Check max sandboxes limit
    if (this.sandboxes.size >= this.config.maxSandboxes) {
      throw new Error(
        `Maximum sandbox limit (${this.config.maxSandboxes}) reached. Destroy a sandbox first.`
      );
    }

    // Merge configurations
    const fullConfig: SandboxConfig = {
      provider: 'vercel',
      vcpus: 2,
      memory: 2048,
      timeout: this.config.defaultTimeout,
      runtime: 'node22',
      ...this.config.defaultSandboxConfig,
      ...sandboxConfig,
    };

    // Create sandbox manager
    const manager = new SandboxManager({
      vcpus: fullConfig.vcpus,
      memory: fullConfig.memory,
      timeout: fullConfig.timeout,
      runtime: fullConfig.runtime,
    });

    // Create the underlying sandbox
    await manager.create();

    // Create instance metadata
    const instance: SandboxInstance = {
      id,
      status: 'created',
      config: fullConfig,
      createdAt: Date.now(),
    };

    // Store entry
    this.sandboxes.set(id, { instance, manager });

    return { ...instance };
  }

  /**
   * Start a sandbox with an entry file
   */
  async start(id: string, entryFile: string, args: string[] = []): Promise<void> {
    const entry = this.getEntry(id);

    if (entry.instance.status === 'running') {
      throw new Error(`Sandbox '${id}' is already running`);
    }

    if (entry.instance.status === 'error') {
      throw new Error(`Sandbox '${id}' is in error state. Destroy and recreate.`);
    }

    await entry.manager.start(entryFile, args);

    entry.instance.status = 'running';
    entry.instance.startedAt = Date.now();
  }

  /**
   * Stop a running sandbox
   */
  async stop(id: string): Promise<void> {
    const entry = this.getEntry(id);

    if (entry.instance.status !== 'running') {
      return; // Already stopped
    }

    await entry.manager.stop();

    entry.instance.status = 'stopped';
    entry.instance.stoppedAt = Date.now();
  }

  /**
   * Destroy a sandbox completely
   */
  async destroy(id: string): Promise<void> {
    const entry = this.sandboxes.get(id);
    if (!entry) return;

    try {
      await entry.manager.destroy();
    } catch {
      // Ignore destroy errors
    }

    this.sandboxes.delete(id);
  }

  /**
   * Destroy all sandboxes
   */
  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sandboxes.keys());

    await Promise.all(
      ids.map(id => this.destroy(id).catch(() => {}))
    );
  }

  /**
   * Create a snapshot of a sandbox
   */
  async snapshot(id: string, options?: { files?: string[] }): Promise<{ snapshotId: string }> {
    const entry = this.getEntry(id);

    // Capture files from /app directory
    let files = options?.files || [];
    if (files.length === 0) {
      try {
        const capturedFiles = await captureDirectory(entry.manager, '/app', {
          maxDepth: 5,
          excludePatterns: [/node_modules/, /\.git/, /\.cache/],
        });
        files = capturedFiles.map(f => f.path);
      } catch {
        // If directory capture fails, continue with empty files
      }
    }

    const snap = await createSnapshot(id, entry.manager, {
      files,
      includeLogs: true,
      includeState: true,
    });

    await this.config.storage.save(snap);

    return { snapshotId: snap.id };
  }

  /**
   * Resume a sandbox from a snapshot
   */
  async resume(snapshotId: string, options?: { newId?: string }): Promise<{ id: string }> {
    const snap = await this.config.storage.load(snapshotId);
    if (!snap) {
      throw new Error(`Snapshot '${snapshotId}' not found`);
    }

    // Generate new ID or use provided
    const newId = options?.newId || `${snap.sandboxId}-resume-${Date.now().toString(36)}`;

    // Find original sandbox config or use defaults
    const originalEntry = this.sandboxes.get(snap.sandboxId);
    const config = originalEntry?.instance.config || {
      provider: 'vercel' as const,
      vcpus: 2,
      memory: 2048,
      timeout: this.config.defaultTimeout,
      runtime: 'node22' as const,
    };

    // Create new sandbox
    const instance = await this.create(newId, config);

    // Restore snapshot
    const entry = this.getEntry(newId);
    await restoreFromSnapshot(entry.manager, snap);

    return { id: newId };
  }

  /**
   * List all snapshots
   */
  async listSnapshots(): Promise<Snapshot[]> {
    return this.config.storage.list();
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    const deleted = await this.config.storage.delete(snapshotId);
    if (!deleted) {
      throw new Error(`Snapshot '${snapshotId}' not found`);
    }
  }

  /**
   * Get a snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    return this.config.storage.load(snapshotId);
  }

  /**
   * List all sandbox instances
   */
  list(): SandboxInstance[] {
    return Array.from(this.sandboxes.values()).map(e => ({ ...e.instance }));
  }

  /**
   * Get a sandbox instance by ID
   */
  get(id: string): SandboxInstance | undefined {
    const entry = this.sandboxes.get(id);
    return entry ? { ...entry.instance } : undefined;
  }

  /**
   * Get logs from a sandbox
   */
  getLogs(id: string, count = 50): LogEntry[] {
    const entry = this.getEntry(id);
    return entry.manager.getLogs(count);
  }

  /**
   * Search logs from a sandbox
   */
  searchLogs(id: string, query: string): LogEntry[] {
    const entry = this.getEntry(id);
    return entry.manager.searchLogs(query);
  }

  /**
   * Get custom state from a sandbox
   */
  getCustomState(id: string, key?: string): unknown {
    const entry = this.getEntry(id);
    return entry.manager.getCustomState(key);
  }

  /**
   * Upload files to a sandbox
   */
  async uploadFiles(id: string, files: SandboxFile[]): Promise<void> {
    const entry = this.getEntry(id);
    await entry.manager.uploadFiles(files);
  }

  /**
   * Read a file from a sandbox
   */
  async readFile(id: string, path: string): Promise<string> {
    const entry = this.getEntry(id);
    return entry.manager.readFile(path);
  }

  /**
   * Write a file to a sandbox
   */
  async writeFile(id: string, path: string, content: string): Promise<void> {
    const entry = this.getEntry(id);
    await entry.manager.writeFile(path, content);
  }

  /**
   * List files in a sandbox directory
   */
  async listFiles(id: string, path: string): Promise<string[]> {
    const entry = this.getEntry(id);
    return entry.manager.listFiles(path);
  }

  /**
   * Run a command in a sandbox
   */
  async runCommand(id: string, cmd: string, args: string[] = []): Promise<CommandResult> {
    const entry = this.getEntry(id);
    return entry.manager.runCommand(cmd, args);
  }

  /**
   * Get the underlying SandboxManager for a sandbox (for advanced use)
   */
  getManager(id: string): SandboxManager {
    return this.getEntry(id).manager;
  }

  /**
   * Get count of active sandboxes
   */
  count(): number {
    return this.sandboxes.size;
  }

  /**
   * Get count of running sandboxes
   */
  runningCount(): number {
    return Array.from(this.sandboxes.values()).filter(
      e => e.instance.status === 'running'
    ).length;
  }

  /**
   * Internal helper to get entry or throw
   */
  private getEntry(id: string): SandboxEntry {
    const entry = this.sandboxes.get(id);
    if (!entry) {
      throw new Error(`Sandbox '${id}' not found`);
    }
    return entry;
  }
}

/**
 * Create a MultiSandboxManager from hosted config
 */
export function createMultiSandboxManager(
  config: HostedConfig,
  storage?: StorageProvider
): MultiSandboxManager {
  return new MultiSandboxManager({
    maxSandboxes: config.maxSandboxes,
    defaultTimeout: config.defaultTimeout,
    storage,
  });
}
