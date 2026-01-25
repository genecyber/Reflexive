/**
 * MCP (Model Context Protocol) tool type definitions
 */

import type { z } from 'zod';

/**
 * MCP tool result content block
 */
export interface ToolResultContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * MCP tool result
 */
export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

/**
 * MCP tool definition
 */
export interface McpTool<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput) => Promise<ToolResult>;
}

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  name: string;
  tools: McpTool[];
}

/**
 * Chat stream event types
 */
export type ChatStreamEventType = 'text' | 'tool' | 'session' | 'error' | 'done';

export interface ChatStreamTextEvent {
  type: 'text';
  content: string;
}

export interface ChatStreamToolEvent {
  type: 'tool';
  name: string;
  input: Record<string, unknown>;
}

export interface ChatStreamSessionEvent {
  type: 'session';
  sessionId: string;
}

export interface ChatStreamErrorEvent {
  type: 'error';
  message: string;
}

export interface ChatStreamDoneEvent {
  type: 'done';
}

export type ChatStreamEvent =
  | ChatStreamTextEvent
  | ChatStreamToolEvent
  | ChatStreamSessionEvent
  | ChatStreamErrorEvent
  | ChatStreamDoneEvent;

/**
 * Chat options for streaming
 */
export interface ChatOptions {
  contextSummary: string;
  systemPrompt: string;
  mcpServer: unknown;
  mcpServerName: string;
  sessionId?: string | null;
  queryOptions?: {
    cwd?: string;
    allowedTools?: string[];
    [key: string]: unknown;
  };
}
