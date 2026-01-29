/**
 * Chat Stream Handler
 *
 * Creates chat streams using the Claude Agent SDK and handles
 * SSE responses for real-time streaming to the dashboard.
 */

import type { ServerResponse } from 'http';
import type { ChatStreamEvent, ChatOptions } from '../types/mcp.js';

// Type for the query function
type QueryFunction = (params: { prompt: string; options: Record<string, unknown> }) => AsyncGenerator<unknown>;

// Dynamic import for Claude Agent SDK to handle cases where it's not installed
let queryFunction: QueryFunction | null = null;

async function getQueryFunction(): Promise<QueryFunction> {
  if (queryFunction) return queryFunction;
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    queryFunction = sdk.query as QueryFunction;
    return queryFunction;
  } catch {
    throw new Error('Claude Agent SDK not available. Install @anthropic-ai/claude-agent-sdk');
  }
}

/**
 * Creates an async generator that yields chat stream events
 */
export async function* createChatStream(
  message: string,
  options: ChatOptions
): AsyncGenerator<ChatStreamEvent> {
  const {
    contextSummary,
    systemPrompt,
    mcpServer,
    mcpServerName,
    sessionId = null,
    queryOptions = {}
  } = options;

  const query = await getQueryFunction();

  const enrichedPrompt = `<app_context>
${contextSummary}
</app_context>

${message}`;

  // Merge reflexive's built-in MCP server with any external MCP servers
  const mcpServers: Record<string, unknown> = {
    [mcpServerName]: mcpServer,
    ...(options.externalMcpServers || {})
  };

  const fullOptions = {
    model: 'sonnet',
    permissionMode: 'bypassPermissions',
    maxTurns: 50,
    mcpServers,
    systemPrompt,
    includePartialMessages: true,
    ...queryOptions
  };

  // Resume existing session if we have a session ID
  if (sessionId) {
    (fullOptions as Record<string, unknown>).resume = sessionId;
  }

  interface StreamMessage {
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

  for await (const msg of query({ prompt: enrichedPrompt, options: fullOptions })) {
    const streamMsg = msg as StreamMessage;
    // Capture and yield session ID from init message
    if (streamMsg.type === 'system' && streamMsg.subtype === 'init' && streamMsg.session_id) {
      yield { type: 'session', sessionId: streamMsg.session_id };
    }

    // Handle streaming text deltas for real-time output
    if (streamMsg.type === 'stream_event') {
      const event = streamMsg.event;
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield { type: 'text', content: event.delta.text || '' };
      }
    }

    // Handle complete messages for tool use notifications
    if (streamMsg.type === 'assistant' && streamMsg.message) {
      for (const block of streamMsg.message.content) {
        if (block.type === 'tool_use') {
          yield {
            type: 'tool',
            name: block.name || 'unknown',
            input: block.input || {}
          };
        }
      }
    }
  }

  yield { type: 'done' };
}

/**
 * Handle SSE response for a chat stream
 *
 * Writes Server-Sent Events format to the response
 */
export async function handleSSEResponse(
  res: ServerResponse,
  chatStream: AsyncGenerator<ChatStreamEvent>
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  try {
    for await (const chunk of chatStream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', message: error })}\n\n`);
  }

  res.end();
}

/**
 * Format a chat stream event for SSE
 */
export function formatSSEEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Create a mock chat stream for testing
 */
export async function* createMockChatStream(
  response: string = 'This is a mock response.'
): AsyncGenerator<ChatStreamEvent> {
  yield { type: 'session', sessionId: 'mock-session-123' };

  // Stream the response character by character with small delays
  for (let i = 0; i < response.length; i++) {
    yield { type: 'text', content: response[i] };
  }

  yield { type: 'done' };
}
