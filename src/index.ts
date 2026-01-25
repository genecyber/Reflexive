/**
 * Reflexive - AI-powered introspection for Node.js applications
 *
 * This module provides the library mode API for embedding Reflexive
 * into your application. For CLI usage, see cli.ts.
 */

// Core exports
export { AppState } from './core/app-state.js';
export type { AppStateOptions } from './core/app-state.js';

export { loadConfig, findConfigFile, validateConfig, getDefaultConfig, getDefaultCapabilities } from './core/config-loader.js';

export { getDashboardHTML, getErrorHTML } from './core/dashboard.js';
export type { DashboardOptions } from './core/dashboard.js';

export { createChatStream, handleSSEResponse, createMockChatStream, formatSSEEvent } from './core/chat-stream.js';

export {
  createHttpServer,
  startServer,
  parseJsonBody,
  sendJson,
  sendHtml,
  sendError,
  parseUrl,
  addCorsHeaders
} from './core/http-server.js';
export type { RequestHandler, Route, ServerConfig } from './core/http-server.js';

// MCP Tools exports
export { createLibraryTools, textResult, jsonResult, errorResult, createTool, combineTools, filterTools, z } from './mcp/tools.js';
export { createLocalTools } from './mcp/local-tools.js';
export type { LocalToolsOptions } from './mcp/local-tools.js';
export { createCliTools, createAllCliTools } from './mcp/cli-tools.js';
export type { CliToolsOptions } from './mcp/cli-tools.js';
export { createHostedTools, getHostedToolNames } from './mcp/hosted-tools.js';

// Manager exports
export { ProcessManager } from './managers/process-manager.js';
export type {
  ProcessManagerOptions,
  PersistedBreakpoint,
  TriggeredBreakpointPrompt,
  EvalCallback,
  InjectedMessage
} from './managers/process-manager.js';

export { RemoteDebugger } from './managers/remote-debugger.js';
export type {
  BreakpointInfo,
  CallFrame,
  ScopeInfo,
  ScriptInfo,
  PausedEventData,
  ScopeVariable
} from './managers/remote-debugger.js';

export { SandboxManager } from './managers/sandbox-manager.js';
export type { SandboxManagerOptions, SandboxState } from './managers/sandbox-manager.js';

export { MultiSandboxManager, createMultiSandboxManager } from './managers/multi-sandbox-manager.js';
export type { MultiSandboxManagerConfig } from './managers/multi-sandbox-manager.js';

// Sandbox utilities
export { MemoryStorage, S3Storage, createStorageProvider } from './sandbox/storage.js';
export type { StorageProvider, S3StorageConfig } from './sandbox/storage.js';

export {
  createSnapshot,
  restoreFromSnapshot,
  captureDirectory,
  getSnapshotSize,
  validateSnapshot,
  createEmptySnapshot
} from './sandbox/snapshot.js';
export type { CreateSnapshotOptions, RestoreResult } from './sandbox/snapshot.js';

// API exports
export { createApiRoutes, createHealthRoute } from './api/routes.js';
export type { ApiRoutesConfig } from './api/routes.js';

export {
  extractApiKey,
  validateApiKey,
  isPublicPath,
  createAuthMiddleware,
  createAuthConfigFromEnv,
  createRateLimiter,
  createDefaultRateLimitConfig
} from './api/auth.js';
export type { AuthConfig, AuthResult, AuthenticatedRequest, RateLimitConfig } from './api/auth.js';

// Type exports
export type {
  LogEntry,
  LogType,
  AppStatus,
  ProcessState,
  Capabilities,
  ReflexiveConfig,
  SandboxConfig,
  HostedConfig,
  StorageConfig,
  CustomTool
} from './types/index.js';

export type {
  SandboxStatus,
  SandboxInstance,
  Snapshot,
  SnapshotFile,
  SandboxFile,
  CommandResult,
  SandboxLogEntry
} from './types/sandbox.js';

export type {
  BaseManager,
  SandboxManagerInterface,
  MultiSandboxManagerInterface,
  ProcessManagerInterface,
  EventHandler
} from './types/manager.js';

export type {
  ToolResult,
  ToolResultContent,
  McpTool,
  McpServerConfig,
  ChatStreamEvent,
  ChatOptions
} from './types/mcp.js';

// Library mode entry point
import { createServer, Server } from 'http';
import { AppState } from './core/app-state.js';
import { getDashboardHTML } from './core/dashboard.js';
import { createChatStream, handleSSEResponse } from './core/chat-stream.js';
import { parseJsonBody, sendJson, parseUrl, addCorsHeaders } from './core/http-server.js';
import { createLibraryTools } from './mcp/tools.js';
import type { CustomTool } from './types/index.js';

export interface MakeReflexiveOptions {
  port?: number;
  title?: string;
  systemPrompt?: string;
  tools?: CustomTool[];
  onReady?: (info: { port: number; appState: AppState; server: Server }) => void;
}

export interface ReflexiveInstance {
  appState: AppState;
  server: Server;
  log: (type: string, message: string) => void;
  setState: (key: string, value: unknown) => void;
  getState: (key?: string) => unknown;
  chat: (message: string) => Promise<string>;
}

/**
 * Create a Reflexive instance embedded in your application
 *
 * This is the library mode API. It intercepts console methods,
 * provides a dashboard server, and exposes an AI chat interface.
 *
 * @example
 * ```ts
 * import { makeReflexive } from 'reflexive';
 *
 * const r = makeReflexive({ port: 3099, title: 'My App' });
 * r.setState('users', 42);
 * console.log('App started'); // This will be captured
 * ```
 */
export function makeReflexive(options: MakeReflexiveOptions = {}): ReflexiveInstance {
  const {
    port = 3099,
    title = 'Reflexive',
    systemPrompt = '',
    tools = [],
    onReady = () => {}
  } = options;

  const appState = new AppState();

  // Create MCP server with tools
  // Note: Full MCP server integration happens via claude-agent-sdk
  const libraryTools = createLibraryTools(appState);
  const allTools = [...libraryTools, ...tools];

  // Intercept console methods
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  console.log = (...args: unknown[]) => {
    appState.log('info', args.map(String).join(' '));
    originalConsole.log(...args);
  };
  console.info = (...args: unknown[]) => {
    appState.log('info', args.map(String).join(' '));
    originalConsole.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    appState.log('warn', args.map(String).join(' '));
    originalConsole.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    appState.log('error', args.map(String).join(' '));
    originalConsole.error(...args);
  };
  console.debug = (...args: unknown[]) => {
    appState.log('debug', args.map(String).join(' '));
    originalConsole.debug(...args);
  };

  const baseSystemPrompt = `You are an AI assistant embedded inside a running Node.js application.
You can introspect the application's state, logs, and custom data using the available tools.
Help the user understand what's happening in their application, debug issues, and answer questions.
${systemPrompt}`;

  // Create MCP server for tools (simplified, full impl needs claude-agent-sdk)
  const mcpServer = {
    name: 'reflexive',
    tools: allTools
  };

  const server = createServer(async (req, res) => {
    addCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const { pathname, searchParams } = parseUrl(req);

    // Dashboard
    if (pathname === '/reflexive' || pathname === '/reflexive/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHTML({
        title,
        status: appState.getStatus(),
        showControls: false
      }));
      return;
    }

    // Chat endpoint
    if (pathname === '/reflexive/chat' && req.method === 'POST') {
      const { message } = await parseJsonBody<{ message?: string }>(req);

      if (!message) {
        sendJson(res, { error: 'message required' }, 400);
        return;
      }

      const status = appState.getStatus();
      const recentLogs = appState.getLogs(10);
      const contextSummary = `Application PID: ${status.pid}, uptime: ${status.uptime}s
Recent logs: ${recentLogs.slice(-3).map(l => l.message).join('; ')}`;

      try {
        const chatStream = createChatStream(message, {
          contextSummary,
          systemPrompt: baseSystemPrompt,
          mcpServer,
          mcpServerName: 'reflexive'
        });

        await handleSSEResponse(res, chatStream);
      } catch (error) {
        sendJson(res, { error: error instanceof Error ? error.message : 'Chat error' }, 500);
      }
      return;
    }

    // Status endpoint
    if (pathname === '/reflexive/status') {
      sendJson(res, appState.getStatus());
      return;
    }

    // Logs endpoint
    if (pathname === '/reflexive/logs') {
      const count = parseInt(searchParams.get('count') || '50', 10);
      const type = searchParams.get('type');
      sendJson(res, appState.getLogs(count, type));
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    originalConsole.log(`Reflexive dashboard: http://localhost:${port}/reflexive`);
    onReady({ port, appState, server });
  });

  // Programmatic chat function
  async function chat(message: string): Promise<string> {
    let fullResponse = '';

    try {
      const chatStream = createChatStream(message, {
        contextSummary: `Application state: ${JSON.stringify(appState.getStatus())}`,
        systemPrompt: baseSystemPrompt,
        mcpServer,
        mcpServerName: 'reflexive-introspection'
      });

      for await (const chunk of chatStream) {
        if (chunk.type === 'text') {
          fullResponse += chunk.content;
        }
      }
    } catch (error) {
      fullResponse = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }

    return fullResponse;
  }

  return {
    appState,
    server,
    log: (type: string, message: string) => appState.log(type, message),
    setState: (key: string, value: unknown) => appState.setState(key, value),
    getState: (key?: string) => appState.getState(key),
    chat
  };
}
