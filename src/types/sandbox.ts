/**
 * Sandbox-specific type definitions
 */

import type { LogEntry, SandboxConfig } from './index.js';

export type SandboxStatus = 'created' | 'running' | 'stopped' | 'error';

export interface SandboxInstance {
  id: string;
  status: SandboxStatus;
  config: SandboxConfig;
  createdAt: number;
  startedAt?: number;
  stoppedAt?: number;
  error?: string;
}

export interface Snapshot {
  id: string;
  sandboxId: string;
  timestamp: number;
  files: SnapshotFile[];
  state: Record<string, unknown>;
  logs: LogEntry[];
}

export interface SnapshotFile {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
}

export interface SandboxFile {
  path: string;
  content: string | Buffer;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxLogEntry {
  type: string;
  data: {
    level?: string;
    message?: string;
    [key: string]: unknown;
  };
  ts: number;
}
