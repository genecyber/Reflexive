/**
 * Sandbox Mode MCP Tools
 *
 * These tools are exposed to the AI agent when running in sandbox mode,
 * providing control over the sandbox, logs, files, and commands.
 */

import { z } from 'zod';
import type { SandboxManager } from '../managers/sandbox-manager.js';
import type { Capabilities } from '../types/index.js';
import { createTool, textResult, jsonResult, errorResult, type AnyToolDefinition } from './tools.js';

export interface SandboxToolsOptions {
  sandboxManager: SandboxManager;
  capabilities: Capabilities;
}

/**
 * Create MCP tools for sandbox mode
 */
export function createSandboxTools(options: SandboxToolsOptions): AnyToolDefinition[] {
  const { sandboxManager, capabilities } = options;

  const tools: AnyToolDefinition[] = [
    // Sandbox status
    createTool(
      'get_sandbox_status',
      'Get the current status of the sandbox: created, running, entry file, uptime, custom state',
      {},
      async () => {
        const state = sandboxManager.getState();
        const uptime = state.startedAt
          ? Math.floor((Date.now() - state.startedAt) / 1000)
          : 0;

        return jsonResult({
          ...state,
          uptime,
        });
      }
    ),

    // Logs
    createTool(
      'get_logs',
      'Get logs from the sandbox application',
      {
        count: z.number().optional().describe('Number of log entries to return (default 50)'),
        type: z.string().optional().describe('Filter by log type (e.g., stdout, stderr, system, inject:info)')
      },
      async ({ count, type }) => {
        const logs = sandboxManager.getLogs(count || 50, type);
        return jsonResult(logs);
      }
    ),

    createTool(
      'search_logs',
      'Search through sandbox application logs',
      {
        query: z.string().describe('Search term'),
        count: z.number().optional().describe('Maximum results to return (default 20)')
      },
      async ({ query, count }) => {
        const results = sandboxManager.searchLogs(query);
        return jsonResult(results.slice(-(count || 20)));
      }
    ),

    // Custom state
    createTool(
      'get_custom_state',
      'Get custom state set by the application via process.reflexive.setState()',
      {
        key: z.string().optional().describe('Specific state key to retrieve')
      },
      async ({ key }) => {
        return jsonResult(sandboxManager.getCustomState(key));
      }
    ),

    // Sandbox lifecycle
    createTool(
      'restart_sandbox',
      'Restart the sandbox application',
      {},
      async () => {
        if (!capabilities.restart) {
          return textResult('Restart capability not enabled');
        }

        try {
          await sandboxManager.restart();
          return textResult('Sandbox restarted successfully');
        } catch (err) {
          return errorResult(`Failed to restart: ${(err as Error).message}`);
        }
      }
    ),

    createTool(
      'stop_sandbox',
      'Stop the sandbox application',
      {},
      async () => {
        try {
          await sandboxManager.stop();
          return textResult('Sandbox stopped');
        } catch (err) {
          return errorResult(`Failed to stop: ${(err as Error).message}`);
        }
      }
    ),
  ];

  // File operations (if enabled)
  if (capabilities.readFiles) {
    tools.push(
      createTool(
        'read_file',
        'Read a file from the sandbox filesystem',
        {
          path: z.string().describe('Absolute path to the file')
        },
        async ({ path }) => {
          try {
            const content = await sandboxManager.readFile(path);
            return textResult(content);
          } catch (err) {
            return errorResult(`Failed to read file: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'list_files',
        'List files in a directory within the sandbox',
        {
          path: z.string().describe('Directory path to list')
        },
        async ({ path }) => {
          try {
            const files = await sandboxManager.listFiles(path);
            return jsonResult(files);
          } catch (err) {
            return errorResult(`Failed to list files: ${(err as Error).message}`);
          }
        }
      )
    );
  }

  if (capabilities.writeFiles) {
    tools.push(
      createTool(
        'write_file',
        'Write content to a file in the sandbox filesystem',
        {
          path: z.string().describe('Absolute path to the file'),
          content: z.string().describe('Content to write')
        },
        async ({ path, content }) => {
          try {
            await sandboxManager.writeFile(path, content);
            return textResult(`File written: ${path}`);
          } catch (err) {
            return errorResult(`Failed to write file: ${(err as Error).message}`);
          }
        }
      )
    );
  }

  // Shell access (if enabled)
  if (capabilities.shellAccess) {
    tools.push(
      createTool(
        'run_command',
        'Run a command in the sandbox shell',
        {
          cmd: z.string().describe('Command to run'),
          args: z.array(z.string()).optional().describe('Command arguments')
        },
        async ({ cmd, args }) => {
          try {
            const result = await sandboxManager.runCommand(cmd, args || []);
            return jsonResult({
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
            });
          } catch (err) {
            return errorResult(`Failed to run command: ${(err as Error).message}`);
          }
        }
      )
    );
  }

  return tools;
}

/**
 * Get list of allowed tool names based on capabilities
 */
export function getSandboxAllowedTools(capabilities: Capabilities): string[] {
  const tools = [
    'get_sandbox_status',
    'get_logs',
    'search_logs',
    'get_custom_state',
  ];

  if (capabilities.restart) {
    tools.push('restart_sandbox', 'stop_sandbox');
  }

  if (capabilities.readFiles) {
    tools.push('read_file', 'list_files');
  }

  if (capabilities.writeFiles) {
    tools.push('write_file');
  }

  if (capabilities.shellAccess) {
    tools.push('run_command');
  }

  return tools;
}
