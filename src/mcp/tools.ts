/**
 * Shared MCP Tools
 *
 * Tool definitions that are shared across all modes (local, sandbox, hosted).
 * Uses Zod for schema validation as required by the Claude Agent SDK.
 */

import { z } from 'zod';
import type { AppState } from '../core/app-state.js';
import type { ToolResult } from '../types/mcp.js';

// Re-export zod for tool definitions
export { z };

/**
 * Tool definition - using any for flexibility with zod types
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<TInput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput) => Promise<ToolResult>;
}

/**
 * Generic tool type for arrays
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any>;

/**
 * Create a text result for tool responses
 */
export function textResult(text: string): ToolResult {
  return {
    content: [{ type: 'text', text }]
  };
}

/**
 * Create a JSON result for tool responses
 */
export function jsonResult(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

/**
 * Create an error result for tool responses
 */
export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  };
}

/**
 * Create library mode tools (for embedded agent)
 */
export function createLibraryTools(appState: AppState): AnyToolDefinition[] {
  return [
    {
      name: 'get_app_status',
      description: 'Get current application status including PID, uptime, and memory usage',
      inputSchema: z.object({}),
      handler: async () => {
        return jsonResult(appState.getStatus());
      }
    },
    {
      name: 'get_logs',
      description: 'Get recent application logs',
      inputSchema: z.object({
        count: z.number().optional().describe('Number of logs to return (default 50)'),
        type: z.string().optional().describe('Filter by log type (info, warn, error, debug)')
      }),
      handler: async ({ count = 50, type }) => {
        const logs = appState.getLogs(count, type || null);
        return jsonResult(logs);
      }
    },
    {
      name: 'search_logs',
      description: 'Search through application logs',
      inputSchema: z.object({
        query: z.string().describe('Search query')
      }),
      handler: async ({ query }) => {
        const results = appState.searchLogs(query);
        return jsonResult(results);
      }
    },
    {
      name: 'get_custom_state',
      description: 'Get application custom state',
      inputSchema: z.object({
        key: z.string().optional().describe('Specific state key to retrieve')
      }),
      handler: async ({ key }) => {
        return jsonResult(appState.getState(key));
      }
    }
  ];
}

/**
 * Common input schemas for reuse
 */
export const CommonSchemas = {
  count: z.number().optional().describe('Number of items to return'),
  query: z.string().describe('Search query'),
  path: z.string().describe('File path'),
  code: z.string().describe('JavaScript code to evaluate'),
  timeout: z.number().optional().describe('Timeout in milliseconds'),
  input: z.string().describe('Input text'),
  file: z.string().describe('Absolute path to the file'),
  line: z.number().describe('Line number (1-based)'),
  condition: z.string().optional().describe('Optional JavaScript condition expression'),
  breakpointId: z.string().describe('The breakpoint ID'),
  expression: z.string().describe('JavaScript expression to evaluate'),
  callFrameId: z.string().optional().describe('Call frame ID from debug_get_call_stack'),
  scopeType: z.enum(['local', 'closure', 'global', 'with', 'block', 'script', 'catch', 'module']).optional()
    .describe('Type of scope to inspect (default: local)')
};

/**
 * Create tool with type safety
 */
export function createTool<TInput extends z.ZodRawShape>(
  name: string,
  description: string,
  inputShape: TInput,
  handler: (input: z.infer<z.ZodObject<TInput>>) => Promise<ToolResult>
): AnyToolDefinition {
  return {
    name,
    description,
    inputSchema: z.object(inputShape),
    handler: handler as (input: unknown) => Promise<ToolResult>
  };
}

/**
 * Combine multiple tool arrays
 */
export function combineTools(...toolArrays: AnyToolDefinition[][]): AnyToolDefinition[] {
  return toolArrays.flat();
}

/**
 * Filter tools by name
 */
export function filterTools(
  tools: AnyToolDefinition[],
  include?: string[],
  exclude?: string[]
): AnyToolDefinition[] {
  return tools.filter(tool => {
    if (include && !include.includes(tool.name)) {
      return false;
    }
    if (exclude && exclude.includes(tool.name)) {
      return false;
    }
    return true;
  });
}
