/**
 * Hosted Mode MCP Tools
 *
 * Tools for managing multiple sandboxes in hosted mode.
 */

import { z } from 'zod';
import type { MultiSandboxManager } from '../managers/multi-sandbox-manager.js';
import type { AnyToolDefinition, ToolDefinition } from './tools.js';
import { textResult, jsonResult, errorResult, createTool } from './tools.js';

/**
 * Create hosted mode tools for multi-sandbox management
 */
export function createHostedTools(manager: MultiSandboxManager): AnyToolDefinition[] {
  return [
    // List all sandboxes
    createTool(
      'list_sandboxes',
      'List all sandbox instances with their status',
      {},
      async () => {
        const sandboxes = manager.list();
        return jsonResult({
          count: sandboxes.length,
          running: manager.runningCount(),
          sandboxes,
        });
      }
    ),

    // Create sandbox
    createTool(
      'create_sandbox',
      'Create a new sandbox instance',
      {
        id: z.string().describe('Unique identifier for the sandbox'),
        vcpus: z.number().optional().describe('Number of vCPUs (default: 2)'),
        memory: z.number().optional().describe('Memory in MB (default: 2048)'),
        timeout: z.string().optional().describe('Timeout duration (e.g., "30m")'),
      },
      async ({ id, vcpus, memory, timeout }) => {
        try {
          const instance = await manager.create(id, {
            vcpus,
            memory,
            timeout,
          });
          return jsonResult({
            message: `Sandbox '${id}' created successfully`,
            sandbox: instance,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to create sandbox');
        }
      }
    ),

    // Start sandbox
    createTool(
      'start_sandbox',
      'Start a sandbox with an entry file',
      {
        id: z.string().describe('Sandbox ID'),
        entryFile: z.string().describe('Path to entry file (e.g., /app/main.js)'),
        args: z.array(z.string()).optional().describe('Command line arguments'),
      },
      async ({ id, entryFile, args }) => {
        try {
          await manager.start(id, entryFile, args);
          return textResult(`Sandbox '${id}' started with entry file: ${entryFile}`);
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to start sandbox');
        }
      }
    ),

    // Stop sandbox
    createTool(
      'stop_sandbox',
      'Stop a running sandbox',
      {
        id: z.string().describe('Sandbox ID'),
      },
      async ({ id }) => {
        try {
          await manager.stop(id);
          return textResult(`Sandbox '${id}' stopped`);
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to stop sandbox');
        }
      }
    ),

    // Destroy sandbox
    createTool(
      'destroy_sandbox',
      'Destroy a sandbox completely (cannot be undone)',
      {
        id: z.string().describe('Sandbox ID'),
      },
      async ({ id }) => {
        try {
          await manager.destroy(id);
          return textResult(`Sandbox '${id}' destroyed`);
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to destroy sandbox');
        }
      }
    ),

    // Get sandbox details
    createTool(
      'get_sandbox',
      'Get details about a specific sandbox',
      {
        id: z.string().describe('Sandbox ID'),
      },
      async ({ id }) => {
        const sandbox = manager.get(id);
        if (!sandbox) {
          return errorResult(`Sandbox '${id}' not found`);
        }
        return jsonResult(sandbox);
      }
    ),

    // Create snapshot
    createTool(
      'create_snapshot',
      'Create a snapshot of a sandbox for later restoration',
      {
        id: z.string().describe('Sandbox ID'),
        files: z.array(z.string()).optional().describe('Specific files to include (captures /app by default)'),
      },
      async ({ id, files }) => {
        try {
          const result = await manager.snapshot(id, { files });
          return jsonResult({
            message: `Snapshot created for sandbox '${id}'`,
            snapshotId: result.snapshotId,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to create snapshot');
        }
      }
    ),

    // List snapshots
    createTool(
      'list_snapshots',
      'List all available snapshots',
      {},
      async () => {
        const snapshots = await manager.listSnapshots();
        return jsonResult({
          count: snapshots.length,
          snapshots: snapshots.map(s => ({
            id: s.id,
            sandboxId: s.sandboxId,
            timestamp: s.timestamp,
            date: new Date(s.timestamp).toISOString(),
            fileCount: s.files.length,
            logCount: s.logs.length,
            stateKeys: Object.keys(s.state),
          })),
        });
      }
    ),

    // Resume from snapshot
    createTool(
      'resume_from_snapshot',
      'Create a new sandbox from a snapshot',
      {
        snapshotId: z.string().describe('Snapshot ID'),
        newId: z.string().optional().describe('ID for the new sandbox (auto-generated if not provided)'),
      },
      async ({ snapshotId, newId }) => {
        try {
          const result = await manager.resume(snapshotId, { newId });
          return jsonResult({
            message: `Sandbox resumed from snapshot '${snapshotId}'`,
            sandboxId: result.id,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to resume from snapshot');
        }
      }
    ),

    // Delete snapshot
    createTool(
      'delete_snapshot',
      'Delete a snapshot',
      {
        snapshotId: z.string().describe('Snapshot ID'),
      },
      async ({ snapshotId }) => {
        try {
          await manager.deleteSnapshot(snapshotId);
          return textResult(`Snapshot '${snapshotId}' deleted`);
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to delete snapshot');
        }
      }
    ),

    // Get sandbox logs
    createTool(
      'sandbox_get_logs',
      'Get logs from a sandbox',
      {
        id: z.string().describe('Sandbox ID'),
        count: z.number().optional().describe('Number of logs to return (default: 50)'),
        query: z.string().optional().describe('Search query to filter logs'),
      },
      async ({ id, count = 50, query }) => {
        try {
          const logs = query
            ? manager.searchLogs(id, query)
            : manager.getLogs(id, count);
          return jsonResult({
            sandboxId: id,
            count: logs.length,
            logs,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to get logs');
        }
      }
    ),

    // Get sandbox state
    createTool(
      'sandbox_get_state',
      'Get custom state from a sandbox',
      {
        id: z.string().describe('Sandbox ID'),
        key: z.string().optional().describe('Specific state key to retrieve'),
      },
      async ({ id, key }) => {
        try {
          const state = manager.getCustomState(id, key);
          return jsonResult({
            sandboxId: id,
            key: key || 'all',
            state,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to get state');
        }
      }
    ),

    // Run command in sandbox
    createTool(
      'sandbox_run_command',
      'Run a shell command in a sandbox',
      {
        id: z.string().describe('Sandbox ID'),
        cmd: z.string().describe('Command to run'),
        args: z.array(z.string()).optional().describe('Command arguments'),
      },
      async ({ id, cmd, args = [] }) => {
        try {
          const result = await manager.runCommand(id, cmd, args);
          return jsonResult({
            sandboxId: id,
            command: `${cmd} ${args.join(' ')}`.trim(),
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to run command');
        }
      }
    ),

    // Read file from sandbox
    createTool(
      'sandbox_read_file',
      'Read a file from a sandbox',
      {
        id: z.string().describe('Sandbox ID'),
        path: z.string().describe('File path to read'),
      },
      async ({ id, path }) => {
        try {
          const content = await manager.readFile(id, path);
          return jsonResult({
            sandboxId: id,
            path,
            content,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to read file');
        }
      }
    ),

    // Write file to sandbox
    createTool(
      'sandbox_write_file',
      'Write a file to a sandbox',
      {
        id: z.string().describe('Sandbox ID'),
        path: z.string().describe('File path to write'),
        content: z.string().describe('File content'),
      },
      async ({ id, path, content }) => {
        try {
          await manager.writeFile(id, path, content);
          return textResult(`File written to sandbox '${id}': ${path}`);
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to write file');
        }
      }
    ),

    // List files in sandbox
    createTool(
      'sandbox_list_files',
      'List files in a sandbox directory',
      {
        id: z.string().describe('Sandbox ID'),
        path: z.string().describe('Directory path to list'),
      },
      async ({ id, path }) => {
        try {
          const files = await manager.listFiles(id, path);
          return jsonResult({
            sandboxId: id,
            path,
            files,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to list files');
        }
      }
    ),

    // Upload files to sandbox
    createTool(
      'sandbox_upload_files',
      'Upload multiple files to a sandbox',
      {
        id: z.string().describe('Sandbox ID'),
        files: z.array(z.object({
          path: z.string().describe('Destination path'),
          content: z.string().describe('File content'),
        })).describe('Files to upload'),
      },
      async ({ id, files }) => {
        try {
          await manager.uploadFiles(id, files);
          return jsonResult({
            sandboxId: id,
            uploaded: files.length,
            paths: files.map(f => f.path),
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : 'Failed to upload files');
        }
      }
    ),
  ];
}

/**
 * Get tool names for hosted mode
 */
export function getHostedToolNames(): string[] {
  return [
    'list_sandboxes',
    'create_sandbox',
    'start_sandbox',
    'stop_sandbox',
    'destroy_sandbox',
    'get_sandbox',
    'create_snapshot',
    'list_snapshots',
    'resume_from_snapshot',
    'delete_snapshot',
    'sandbox_get_logs',
    'sandbox_get_state',
    'sandbox_run_command',
    'sandbox_read_file',
    'sandbox_write_file',
    'sandbox_list_files',
    'sandbox_upload_files',
  ];
}
