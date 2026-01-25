/**
 * Mock Anthropic Claude Agent SDK for testing without API calls
 */

import { vi } from 'vitest';

export interface MockQueryOptions {
  prompt: string;
  options?: {
    model?: string;
    systemPrompt?: string;
    mcpServers?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface MockStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  event?: {
    type: string;
    delta?: {
      type: string;
      text?: string;
    };
  };
  message?: {
    content: Array<{
      type: string;
      name?: string;
      input?: Record<string, unknown>;
      text?: string;
    }>;
  };
}

/**
 * Creates a mock query generator that yields test responses
 */
export function createMockQuery(responses?: MockStreamEvent[]) {
  const defaultResponses: MockStreamEvent[] = [
    { type: 'system', subtype: 'init', session_id: 'test-session-123' },
    {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Mock response' }
      }
    },
    { type: 'done' as 'done' }
  ];

  const responsesToUse = responses || defaultResponses;

  return async function* mockQuery(_options: MockQueryOptions): AsyncGenerator<MockStreamEvent> {
    for (const response of responsesToUse) {
      yield response;
    }
  };
}

/**
 * Creates a mock tool function
 */
export function createMockTool(
  name: string,
  description: string,
  schema: Record<string, unknown>,
  handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
) {
  return {
    name,
    description,
    schema,
    handler
  };
}

/**
 * Creates a mock MCP server
 */
export function createMockMcpServer(name: string, tools: Array<ReturnType<typeof createMockTool>>) {
  return {
    name,
    tools,
    connect: vi.fn(),
    disconnect: vi.fn()
  };
}

/**
 * Mock the entire claude-agent-sdk module
 */
export function mockClaudeAgentSdk() {
  return {
    query: createMockQuery(),
    tool: createMockTool,
    createSdkMcpServer: createMockMcpServer
  };
}
