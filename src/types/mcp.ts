/**
 * MCP (Model Context Protocol) tool type definitions
 */

import type { z } from 'zod';
// Import CallToolResult directly from MCP SDK for type compatibility
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP tool result - re-exported from @modelcontextprotocol/sdk for compatibility
 */
export type ToolResult = CallToolResult;

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
 * External MCP server configuration (for connecting to external tools)
 * Supports stdio (command-based) and HTTP/SSE transports
 */
export interface ExternalMcpServer {
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // HTTP/SSE transport
  url?: string;
  transport?: 'sse' | 'http';
}

/**
 * Chat options for streaming
 */
export interface ChatOptions {
  contextSummary: string;
  systemPrompt: string;
  mcpServer: unknown;
  mcpServerName: string;
  sessionId?: string | null;
  // External MCP servers to include (keyed by server name)
  externalMcpServers?: Record<string, ExternalMcpServer>;
  queryOptions?: {
    cwd?: string;
    allowedTools?: string[];
    [key: string]: unknown;
  };
}
