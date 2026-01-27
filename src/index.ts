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
export { createKnowledgeTools, createKnowledgeTool } from './mcp/knowledge-tools.js';

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
import { createServer, Server, ServerResponse } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AppState } from './core/app-state.js';
import { getDashboardHTML } from './core/dashboard.js';
import { createChatStream, handleSSEResponse } from './core/chat-stream.js';
import { parseJsonBody, sendJson, parseUrl, addCorsHeaders } from './core/http-server.js';
import { createLibraryTools } from './mcp/tools.js';
import { createKnowledgeTools } from './mcp/knowledge-tools.js';
import type { CustomTool } from './types/index.js';

// Static file serving for Next.js dashboard (library mode)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DASHBOARD_DIR = join(__dirname, '..', 'dashboard', 'out');
const DASHBOARD_AVAILABLE = existsSync(DASHBOARD_DIR);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

function serveStaticFile(res: ServerResponse, filePath: string): boolean {
  try {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const data = readFileSync(filePath);
    const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function tryServeDashboard(res: ServerResponse, pathname: string): boolean {
  if (!DASHBOARD_AVAILABLE) return false;

  // Remove /reflexive prefix to get the file path
  let relativePath = pathname.replace(/^\/reflexive/, '') || '/';

  // Try exact file match first
  let filePath = join(DASHBOARD_DIR, relativePath);
  if (existsSync(filePath) && !filePath.endsWith('/')) {
    const stat = statSync(filePath);
    if (stat.isFile()) {
      return serveStaticFile(res, filePath);
    }
  }

  // Try with index.html for directories
  if (relativePath === '/' || relativePath.endsWith('/')) {
    filePath = join(DASHBOARD_DIR, relativePath, 'index.html');
    if (existsSync(filePath)) {
      return serveStaticFile(res, filePath);
    }
  }

  // Try adding .html extension
  filePath = join(DASHBOARD_DIR, relativePath + '.html');
  if (existsSync(filePath)) {
    return serveStaticFile(res, filePath);
  }

  return false;
}

// Dynamic import for createSdkMcpServer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createSdkMcpServerFn: any = null;

async function getCreateSdkMcpServer(): Promise<(config: { name: string; tools: unknown[] }) => unknown> {
  if (createSdkMcpServerFn) return createSdkMcpServerFn;
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    createSdkMcpServerFn = sdk.createSdkMcpServer;
    return createSdkMcpServerFn;
  } catch {
    throw new Error('Claude Agent SDK not available. Install @anthropic-ai/claude-agent-sdk');
  }
}

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
 * Create a client-mode Reflexive instance that connects to a parent CLI
 * This is used when the app is run via `reflexive app.js` and uses makeReflexive()
 */
function createClientReflexive(cliPort: number): ReflexiveInstance {
  const appState = new AppState();
  const cliBaseUrl = `http://localhost:${cliPort}`;

  console.log(`[reflexive] Running in CLI child mode, connecting to parent on port ${cliPort}`);

  // Chat proxies to CLI's chat endpoint
  async function chat(message: string): Promise<string> {
    try {
      const response = await fetch(`${cliBaseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });

      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.status}`);
      }

      // Handle SSE response - collect all text chunks
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let fullResponse = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE events
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text') {
                fullResponse += data.content;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      return fullResponse;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  // setState syncs to CLI
  function setState(key: string, value: unknown): void {
    appState.setState(key, value);
    // Fire and forget - sync state to CLI
    fetch(`${cliBaseUrl}/client-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value })
    }).catch(() => {
      // Silently ignore sync errors
    });
  }

  // Return client instance - no server started
  return {
    appState,
    server: null as unknown as Server, // No server in client mode
    log: (type: string, message: string) => appState.log(type, message),
    setState,
    getState: (key?: string) => appState.getState(key),
    chat
  };
}

/**
 * Create a Reflexive instance embedded in your application
 *
 * This is the library mode API. It intercepts console methods,
 * provides a dashboard server, and exposes an AI chat interface.
 *
 * When running under `reflexive app.js` (CLI mode), this automatically
 * connects to the parent CLI instead of starting its own server.
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
  // Check if running under CLI - if so, connect to parent instead of starting server
  if (process.env.REFLEXIVE_CLI_MODE === 'true' && process.env.REFLEXIVE_CLI_PORT) {
    const cliPort = parseInt(process.env.REFLEXIVE_CLI_PORT, 10);
    return createClientReflexive(cliPort);
  }

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
  const knowledgeTools = createKnowledgeTools();
  const allTools = [...libraryTools, ...knowledgeTools, ...tools];

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

  const baseSystemPrompt = `You are an AI assistant powered by Reflexive, embedded inside a running Node.js application.

CAPABILITIES:
- Introspect application state, logs, and custom data
- Help users write code that leverages Reflexive's features
- Build "hybrid" AI-native applications using reflexive.chat() for inline AI prompts

SELF-KNOWLEDGE:
You have access to \`reflexive_self_knowledge\` - use it to get detailed documentation about:
- Library API (makeReflexive, chat, setState, getState, log)
- CLI options and configuration
- Patterns for building AI-native applications
- Deployment and architecture

When users ask about Reflexive features or want to write code using Reflexive, use this tool first.

${systemPrompt}`;

  // Lazily create MCP server using Claude Agent SDK
  let mcpServer: unknown = null;
  async function getMcpServer(): Promise<unknown> {
    if (mcpServer) return mcpServer;
    const createMcpServer = await getCreateSdkMcpServer();
    mcpServer = createMcpServer({ name: 'reflexive', tools: allTools });
    return mcpServer;
  }

  const server = createServer(async (req, res) => {
    addCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const { pathname, searchParams } = parseUrl(req);

    // API endpoints (must be checked before static file serving)
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
        const server = await getMcpServer();
        const chatStream = createChatStream(message, {
          contextSummary,
          systemPrompt: baseSystemPrompt,
          mcpServer: server,
          mcpServerName: 'reflexive'
        });

        await handleSSEResponse(res, chatStream);
      } catch (error) {
        sendJson(res, { error: error instanceof Error ? error.message : 'Chat error' }, 500);
      }
      return;
    }

    // Status endpoint (legacy path)
    if (pathname === '/reflexive/status') {
      sendJson(res, appState.getStatus());
      return;
    }

    // State endpoint (Next.js dashboard uses /state)
    if (pathname === '/state') {
      // Return status with library mode flags
      sendJson(res, {
        ...appState.getStatus(),
        isRunning: true,
        showControls: false,  // Library mode doesn't have process controls
        capabilities: {
          readFiles: false,
          writeFiles: false,
          shellAccess: false,
          restart: false,
          inject: false,
          eval: false,
          debug: false
        }
      });
      return;
    }

    // Logs endpoint (both paths for compatibility)
    if (pathname === '/reflexive/logs' || pathname === '/logs') {
      const count = parseInt(searchParams.get('count') || '50', 10);
      const type = searchParams.get('type');
      sendJson(res, appState.getLogs(count, type));
      return;
    }

    // Chat endpoint (without /reflexive prefix for Next.js dashboard)
    if (pathname === '/chat' && req.method === 'POST') {
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
        const mcpSrv = await getMcpServer();
        const chatStream = createChatStream(message, {
          contextSummary,
          systemPrompt: baseSystemPrompt,
          mcpServer: mcpSrv,
          mcpServerName: 'reflexive'
        });
        await handleSSEResponse(res, chatStream);
      } catch (error) {
        sendJson(res, { error: error instanceof Error ? error.message : 'Chat error' }, 500);
      }
      return;
    }

    // Try serving Next.js dashboard static files
    if (pathname.startsWith('/reflexive') || pathname === '/') {
      // Redirect root to /reflexive
      if (pathname === '/') {
        res.writeHead(302, { Location: '/reflexive' });
        res.end();
        return;
      }
      // Try Next.js dashboard first
      if (tryServeDashboard(res, pathname)) {
        return;
      }
      // Fallback to embedded HTML for main dashboard page
      if (pathname === '/reflexive' || pathname === '/reflexive/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML({
          title,
          status: appState.getStatus(),
          showControls: false
        }));
        return;
      }
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
      const server = await getMcpServer();
      const chatStream = createChatStream(message, {
        contextSummary: `Application state: ${JSON.stringify(appState.getStatus())}`,
        systemPrompt: baseSystemPrompt,
        mcpServer: server,
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
