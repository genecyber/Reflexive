/**
 * REST API Routes for Hosted Mode
 *
 * Provides REST endpoints for managing multiple sandboxes.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Route } from '../core/http-server.js';
import { parseJsonBody, sendJson, sendError, parseUrl } from '../core/http-server.js';
import type { MultiSandboxManager } from '../managers/multi-sandbox-manager.js';
import type { SandboxConfig } from '../types/index.js';
import type { AuthConfig, RateLimitConfig } from './auth.js';
import { createAuthMiddleware, createRateLimiter } from './auth.js';

/**
 * API route configuration
 */
export interface ApiRoutesConfig {
  /**
   * Multi-sandbox manager instance
   */
  manager: MultiSandboxManager;

  /**
   * Base path for API routes (default: /api)
   */
  basePath?: string;

  /**
   * Authentication configuration
   */
  auth?: AuthConfig;

  /**
   * Rate limiting configuration
   */
  rateLimit?: RateLimitConfig;

  /**
   * Chat handler function for SSE streaming
   */
  chatHandler?: (
    sandboxId: string,
    message: string,
    res: ServerResponse
  ) => Promise<void>;
}

/**
 * Request body types
 */
interface CreateSandboxBody {
  id: string;
  config?: Partial<SandboxConfig>;
}

interface StartSandboxBody {
  entryFile: string;
  args?: string[];
}

interface SnapshotBody {
  files?: string[];
}

interface ResumeBody {
  newId?: string;
}

interface WriteFileBody {
  content: string;
}

interface ChatBody {
  message: string;
}

/**
 * Extract sandbox ID from URL path
 */
function extractSandboxId(pathname: string, basePath: string): string | null {
  const prefix = `${basePath}/sandboxes/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const rest = pathname.slice(prefix.length);
  const slashIndex = rest.indexOf('/');
  return slashIndex === -1 ? rest : rest.slice(0, slashIndex);
}

/**
 * Extract snapshot ID from URL path
 */
function extractSnapshotId(pathname: string, basePath: string): string | null {
  const prefix = `${basePath}/snapshots/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const rest = pathname.slice(prefix.length);
  const slashIndex = rest.indexOf('/');
  return slashIndex === -1 ? rest : rest.slice(0, slashIndex);
}

/**
 * Extract file path from URL
 */
function extractFilePath(pathname: string, basePath: string, sandboxId: string): string | null {
  const prefix = `${basePath}/sandboxes/${sandboxId}/files/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  return '/' + pathname.slice(prefix.length);
}

/**
 * Create API routes for hosted mode
 */
export function createApiRoutes(config: ApiRoutesConfig): Route[] {
  const {
    manager,
    basePath = '/api',
    auth,
    rateLimit,
    chatHandler,
  } = config;

  // Create middleware functions
  const authenticate = auth ? createAuthMiddleware(auth) : null;
  const checkRateLimit = rateLimit ? createRateLimiter(rateLimit) : null;

  /**
   * Wrap handler with auth and rate limiting
   */
  function wrapHandler(
    handler: (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<void>
  ) {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const { pathname } = parseUrl(req);

      // Rate limiting
      if (checkRateLimit && !checkRateLimit(req, res)) {
        return;
      }

      // Authentication
      if (authenticate && !(await authenticate(req, res, pathname))) {
        return;
      }

      await handler(req, res, pathname);
    };
  }

  const routes: Route[] = [
    // Health check (always public)
    {
      method: 'GET',
      path: `${basePath}/health`,
      handler: (req, res) => {
        sendJson(res, {
          status: 'ok',
          sandboxes: manager.count(),
          running: manager.runningCount(),
        });
      },
    },

    // Create sandbox
    {
      method: 'POST',
      path: `${basePath}/sandboxes`,
      handler: wrapHandler(async (req, res) => {
        const body = await parseJsonBody<CreateSandboxBody>(req);

        if (!body.id) {
          sendError(res, 'Missing required field: id', 400);
          return;
        }

        try {
          const instance = await manager.create(body.id, body.config);
          sendJson(res, instance, 201);
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to create sandbox', 400);
        }
      }),
    },

    // List sandboxes
    {
      method: 'GET',
      path: `${basePath}/sandboxes`,
      handler: wrapHandler(async (req, res) => {
        const sandboxes = manager.list();
        sendJson(res, { sandboxes });
      }),
    },

    // Get sandbox details
    {
      method: 'GET',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        const sandbox = manager.get(id);
        if (!sandbox) {
          sendError(res, `Sandbox '${id}' not found`, 404);
          return;
        }

        sendJson(res, sandbox);
      }),
    },

    // Start sandbox
    {
      method: 'POST',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+/start$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        const body = await parseJsonBody<StartSandboxBody>(req);

        if (!body.entryFile) {
          sendError(res, 'Missing required field: entryFile', 400);
          return;
        }

        try {
          await manager.start(id, body.entryFile, body.args);
          sendJson(res, { status: 'started' });
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to start sandbox', 400);
        }
      }),
    },

    // Stop sandbox
    {
      method: 'POST',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+/stop$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        try {
          await manager.stop(id);
          sendJson(res, { status: 'stopped' });
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to stop sandbox', 400);
        }
      }),
    },

    // Destroy sandbox
    {
      method: 'DELETE',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        try {
          await manager.destroy(id);
          sendJson(res, { status: 'destroyed' });
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to destroy sandbox', 400);
        }
      }),
    },

    // Create snapshot
    {
      method: 'POST',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+/snapshot$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        const body = await parseJsonBody<SnapshotBody>(req);

        try {
          const result = await manager.snapshot(id, { files: body.files });
          sendJson(res, result, 201);
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to create snapshot', 400);
        }
      }),
    },

    // List snapshots
    {
      method: 'GET',
      path: `${basePath}/snapshots`,
      handler: wrapHandler(async (req, res) => {
        const snapshots = await manager.listSnapshots();
        sendJson(res, { snapshots });
      }),
    },

    // Get snapshot details
    {
      method: 'GET',
      path: new RegExp(`^${basePath}/snapshots/[^/]+$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const snapshotId = extractSnapshotId(pathname, basePath);
        if (!snapshotId) {
          sendError(res, 'Invalid snapshot ID', 400);
          return;
        }

        const snapshot = await manager.getSnapshot(snapshotId);
        if (!snapshot) {
          sendError(res, `Snapshot '${snapshotId}' not found`, 404);
          return;
        }

        sendJson(res, snapshot);
      }),
    },

    // Resume from snapshot
    {
      method: 'POST',
      path: new RegExp(`^${basePath}/snapshots/[^/]+/resume$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const snapshotId = extractSnapshotId(pathname, basePath);
        if (!snapshotId) {
          sendError(res, 'Invalid snapshot ID', 400);
          return;
        }

        const body = await parseJsonBody<ResumeBody>(req);

        try {
          const result = await manager.resume(snapshotId, { newId: body.newId });
          sendJson(res, result, 201);
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to resume from snapshot', 400);
        }
      }),
    },

    // Delete snapshot
    {
      method: 'DELETE',
      path: new RegExp(`^${basePath}/snapshots/[^/]+$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const snapshotId = extractSnapshotId(pathname, basePath);
        if (!snapshotId) {
          sendError(res, 'Invalid snapshot ID', 400);
          return;
        }

        try {
          await manager.deleteSnapshot(snapshotId);
          sendJson(res, { status: 'deleted' });
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to delete snapshot', 400);
        }
      }),
    },

    // Get sandbox logs
    {
      method: 'GET',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+/logs$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        const { searchParams } = parseUrl(req);
        const count = parseInt(searchParams.get('count') || '50', 10);
        const query = searchParams.get('query');

        try {
          const logs = query
            ? manager.searchLogs(id, query)
            : manager.getLogs(id, count);
          sendJson(res, { logs });
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to get logs', 400);
        }
      }),
    },

    // Get sandbox state
    {
      method: 'GET',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+/state$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        const { searchParams } = parseUrl(req);
        const key = searchParams.get('key') || undefined;

        try {
          const state = manager.getCustomState(id, key);
          sendJson(res, { state });
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to get state', 400);
        }
      }),
    },

    // Read file from sandbox
    {
      method: 'GET',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+/files/.+$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        const filePath = extractFilePath(pathname, basePath, id);
        if (!filePath) {
          sendError(res, 'Invalid file path', 400);
          return;
        }

        try {
          const content = await manager.readFile(id, filePath);
          sendJson(res, { path: filePath, content });
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to read file', 400);
        }
      }),
    },

    // Write file to sandbox
    {
      method: 'PUT',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+/files/.+$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        const filePath = extractFilePath(pathname, basePath, id);
        if (!filePath) {
          sendError(res, 'Invalid file path', 400);
          return;
        }

        const body = await parseJsonBody<WriteFileBody>(req);
        if (typeof body.content !== 'string') {
          sendError(res, 'Missing required field: content', 400);
          return;
        }

        try {
          await manager.writeFile(id, filePath, body.content);
          sendJson(res, { status: 'written', path: filePath });
        } catch (error) {
          sendError(res, error instanceof Error ? error.message : 'Failed to write file', 400);
        }
      }),
    },

    // Chat with sandbox (SSE)
    {
      method: 'POST',
      path: new RegExp(`^${basePath}/sandboxes/[^/]+/chat$`),
      handler: wrapHandler(async (req, res, pathname) => {
        const id = extractSandboxId(pathname, basePath);
        if (!id) {
          sendError(res, 'Invalid sandbox ID', 400);
          return;
        }

        if (!chatHandler) {
          sendError(res, 'Chat not available', 501);
          return;
        }

        const body = await parseJsonBody<ChatBody>(req);
        if (!body.message) {
          sendError(res, 'Missing required field: message', 400);
          return;
        }

        // Verify sandbox exists
        if (!manager.get(id)) {
          sendError(res, `Sandbox '${id}' not found`, 404);
          return;
        }

        try {
          await chatHandler(id, body.message, res);
        } catch (error) {
          // Only send error if response not already started
          if (!res.headersSent) {
            sendError(res, error instanceof Error ? error.message : 'Chat failed', 500);
          }
        }
      }),
    },
  ];

  return routes;
}

/**
 * Create a simple health check route
 */
export function createHealthRoute(basePath = '/api'): Route {
  return {
    method: 'GET',
    path: `${basePath}/health`,
    handler: (req, res) => {
      sendJson(res, { status: 'ok', timestamp: Date.now() });
    },
  };
}
