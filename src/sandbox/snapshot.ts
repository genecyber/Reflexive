/**
 * Snapshot/Restore functionality for Sandbox
 *
 * Captures sandbox state (files, custom state, logs) for later restoration.
 */

import type { LogEntry, Snapshot, SnapshotFile } from '../types/index.js';
import type { SandboxManager } from '../managers/sandbox-manager.js';

/**
 * Generate a unique snapshot ID
 */
function generateSnapshotId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `snap_${timestamp}_${random}`;
}

/**
 * Options for creating a snapshot
 */
export interface CreateSnapshotOptions {
  /**
   * Files to include in the snapshot (relative paths from /app/)
   * If not specified, attempts to capture common files
   */
  files?: string[];

  /**
   * Maximum number of logs to include
   */
  maxLogs?: number;

  /**
   * Include full log history (default: true)
   */
  includeLogs?: boolean;

  /**
   * Include custom state (default: true)
   */
  includeState?: boolean;
}

/**
 * Result of restoring a snapshot
 */
export interface RestoreResult {
  filesRestored: number;
  stateRestored: boolean;
  logsRestored: number;
}

/**
 * Create a snapshot from a sandbox manager instance
 */
export async function createSnapshot(
  sandboxId: string,
  manager: SandboxManager,
  options: CreateSnapshotOptions = {}
): Promise<Snapshot> {
  const {
    files = [],
    maxLogs = 500,
    includeLogs = true,
    includeState = true,
  } = options;

  // Capture custom state
  const state = includeState
    ? (manager.getCustomState() as Record<string, unknown>) || {}
    : {};

  // Capture logs
  const logs: LogEntry[] = includeLogs ? manager.getLogs(maxLogs) : [];

  // Capture specified files
  const snapshotFiles: SnapshotFile[] = [];

  for (const filePath of files) {
    try {
      const content = await manager.readFile(filePath);
      snapshotFiles.push({
        path: filePath,
        content,
        encoding: 'utf8',
      });
    } catch {
      // Skip files that can't be read
    }
  }

  const snapshot: Snapshot = {
    id: generateSnapshotId(),
    sandboxId,
    timestamp: Date.now(),
    files: snapshotFiles,
    state,
    logs,
  };

  return snapshot;
}

/**
 * Restore a snapshot to a sandbox manager instance
 * Note: The sandbox must be created but not necessarily running
 */
export async function restoreFromSnapshot(
  manager: SandboxManager,
  snapshot: Snapshot
): Promise<RestoreResult> {
  const result: RestoreResult = {
    filesRestored: 0,
    stateRestored: false,
    logsRestored: 0,
  };

  // Restore files
  for (const file of snapshot.files) {
    try {
      const content = file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64').toString('utf-8')
        : file.content;

      await manager.writeFile(file.path, content);
      result.filesRestored++;
    } catch {
      // Skip files that can't be written
    }
  }

  // State restoration happens implicitly through the inject script
  // when the app starts - we need to inject the state somehow
  // For now, we write a state file that the inject script can read
  if (Object.keys(snapshot.state).length > 0) {
    try {
      await manager.writeFile(
        '/tmp/reflexive-state.json',
        JSON.stringify(snapshot.state)
      );
      result.stateRestored = true;
    } catch {
      // State file write failed
    }
  }

  // Logs are informational - we don't restore them to the manager
  // but we track how many would have been restored
  result.logsRestored = snapshot.logs.length;

  return result;
}

/**
 * Capture files from a sandbox by listing and reading a directory
 */
export async function captureDirectory(
  manager: SandboxManager,
  directory: string,
  options: {
    maxDepth?: number;
    includePatterns?: RegExp[];
    excludePatterns?: RegExp[];
    maxFileSize?: number;
  } = {}
): Promise<SnapshotFile[]> {
  const {
    maxDepth = 3,
    includePatterns = [/\.(js|ts|json|txt|md|html|css)$/],
    excludePatterns = [/node_modules/, /\.git/, /dist/],
    maxFileSize = 1024 * 1024, // 1MB default
  } = options;

  const files: SnapshotFile[] = [];

  async function scanDir(path: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await manager.listFiles(path);

      for (const entry of entries) {
        const fullPath = path.endsWith('/') ? `${path}${entry}` : `${path}/${entry}`;

        // Check exclude patterns
        if (excludePatterns.some(p => p.test(fullPath))) {
          continue;
        }

        // Try to list as directory
        try {
          await scanDir(fullPath, depth + 1);
        } catch {
          // Not a directory, try to read as file
          const matchesInclude = includePatterns.length === 0 ||
            includePatterns.some(p => p.test(entry));

          if (matchesInclude) {
            try {
              const content = await manager.readFile(fullPath);

              // Check file size
              if (content.length <= maxFileSize) {
                files.push({
                  path: fullPath,
                  content,
                  encoding: 'utf8',
                });
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      }
    } catch {
      // Skip unlistable directories
    }
  }

  await scanDir(directory, 0);
  return files;
}

/**
 * Calculate the size of a snapshot in bytes
 */
export function getSnapshotSize(snapshot: Snapshot): number {
  let size = 0;

  // Files
  for (const file of snapshot.files) {
    size += file.path.length;
    size += file.content.length;
  }

  // State (JSON serialized)
  size += JSON.stringify(snapshot.state).length;

  // Logs (JSON serialized)
  size += JSON.stringify(snapshot.logs).length;

  // Base overhead (id, sandboxId, timestamp)
  size += 100;

  return size;
}

/**
 * Validate a snapshot structure
 */
export function validateSnapshot(snapshot: unknown): snapshot is Snapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  const s = snapshot as Record<string, unknown>;

  // Required fields
  if (typeof s.id !== 'string' || !s.id) {
    return false;
  }
  if (typeof s.sandboxId !== 'string' || !s.sandboxId) {
    return false;
  }
  if (typeof s.timestamp !== 'number') {
    return false;
  }
  if (!Array.isArray(s.files)) {
    return false;
  }
  if (typeof s.state !== 'object' || s.state === null) {
    return false;
  }
  if (!Array.isArray(s.logs)) {
    return false;
  }

  // Validate files
  for (const file of s.files) {
    if (
      typeof file.path !== 'string' ||
      typeof file.content !== 'string' ||
      (file.encoding !== 'utf8' && file.encoding !== 'base64')
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Create an empty snapshot (for testing or initialization)
 */
export function createEmptySnapshot(sandboxId: string): Snapshot {
  return {
    id: generateSnapshotId(),
    sandboxId,
    timestamp: Date.now(),
    files: [],
    state: {},
    logs: [],
  };
}
