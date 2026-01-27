/**
 * API Routes Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiRoutes, createHealthRoute } from '../../api/routes.js';
import { MultiSandboxManager } from '../../managers/multi-sandbox-manager.js';
import { MemoryStorage } from '../../sandbox/storage.js';
import { MockSandbox } from '../mocks/sandbox-mock.js';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Route } from '../../core/http-server.js';

// Mock @vercel/sandbox
vi.mock('@vercel/sandbox', () => ({
  Sandbox: MockSandbox,
}));

// Helper to create mock request
function createMockRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): IncomingMessage {
  const req = {
    method,
    url,
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
    socket: { remoteAddress: '127.0.0.1' },
    on: vi.fn((event: string, callback: (data?: unknown) => void) => {
      if (event === 'data' && body) {
        callback(Buffer.from(JSON.stringify(body)));
      }
      if (event === 'end') {
        setTimeout(callback, 0);
      }
    }),
  };
  return req as unknown as IncomingMessage;
}

// Helper to create mock response
function createMockResponse(): ServerResponse & {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
} {
  const res = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    writeHead: vi.fn(function(this: { _status: number; _headers: Record<string, string> }, status: number, headers?: Record<string, string>) {
      this._status = status;
      if (headers) {
        Object.assign(this._headers, headers);
      }
    }),
    setHeader: vi.fn(function(this: { _headers: Record<string, string> }, name: string, value: string) {
      this._headers[name] = value;
    }),
    end: vi.fn(function(this: { _body: string }, data?: string) {
      this._body = data || '';
    }),
    headersSent: false,
  };
  return res as unknown as ServerResponse & {
    _status: number;
    _headers: Record<string, string>;
    _body: string;
  };
}

// Helper to find and execute a route
async function executeRoute(
  routes: Route[],
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  const req = createMockRequest(method, path, body, headers);
  const res = createMockResponse();

  // Extract pathname without query string for route matching
  const pathname = path.split('?')[0];

  for (const route of routes) {
    if (route.method !== '*' && route.method !== method) continue;

    const matches = typeof route.path === 'string'
      ? route.path === pathname || route.path + '/' === pathname
      : route.path.test(pathname);

    if (matches) {
      await route.handler(req, res);
      return {
        status: res._status,
        headers: res._headers,
        body: res._body ? JSON.parse(res._body) : null,
      };
    }
  }

  return { status: 404, headers: {}, body: null };
}

describe('API Routes', () => {
  let manager: MultiSandboxManager;
  let routes: Route[];

  beforeEach(() => {
    const storage = new MemoryStorage();
    manager = new MultiSandboxManager({
      maxSandboxes: 5,
      storage,
    });
    routes = createApiRoutes({ manager, basePath: '/api' });
  });

  afterEach(async () => {
    await manager.destroyAll();
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const result = await executeRoute(routes, 'GET', '/api/health');

      expect(result.status).toBe(200);
      expect(result.body.status).toBe('ok');
      expect(result.body.sandboxes).toBe(0);
      expect(result.body.running).toBe(0);
    });

    it('should include sandbox counts', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js');
      await manager.create('test-2');

      const result = await executeRoute(routes, 'GET', '/api/health');

      expect(result.body.sandboxes).toBe(2);
      expect(result.body.running).toBe(1);
    });
  });

  describe('POST /api/sandboxes', () => {
    it('should create a sandbox', async () => {
      const result = await executeRoute(routes, 'POST', '/api/sandboxes', {
        id: 'test-sandbox',
      });

      expect(result.status).toBe(201);
      expect(result.body.id).toBe('test-sandbox');
      expect(result.body.status).toBe('created');
    });

    it('should create sandbox with config', async () => {
      const result = await executeRoute(routes, 'POST', '/api/sandboxes', {
        id: 'test-sandbox',
        config: { vcpus: 4, memory: 4096 },
      });

      expect(result.status).toBe(201);
      expect(result.body.config.vcpus).toBe(4);
      expect(result.body.config.memory).toBe(4096);
    });

    it('should return error for missing id', async () => {
      const result = await executeRoute(routes, 'POST', '/api/sandboxes', {});

      expect(result.status).toBe(400);
      expect(result.body.error).toContain('Missing required field: id');
    });

    it('should return error for duplicate id', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'POST', '/api/sandboxes', {
        id: 'test-1',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toContain('already exists');
    });
  });

  describe('GET /api/sandboxes', () => {
    it('should list all sandboxes', async () => {
      await manager.create('test-1');
      await manager.create('test-2');

      const result = await executeRoute(routes, 'GET', '/api/sandboxes');

      expect(result.status).toBe(200);
      expect(result.body.sandboxes).toHaveLength(2);
    });

    it('should return empty array when no sandboxes', async () => {
      const result = await executeRoute(routes, 'GET', '/api/sandboxes');

      expect(result.status).toBe(200);
      expect(result.body.sandboxes).toEqual([]);
    });
  });

  describe('GET /api/sandboxes/:id', () => {
    it('should get sandbox details', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'GET', '/api/sandboxes/test-1');

      expect(result.status).toBe(200);
      expect(result.body.id).toBe('test-1');
    });

    it('should return 404 for non-existent sandbox', async () => {
      const result = await executeRoute(routes, 'GET', '/api/sandboxes/non-existent');

      expect(result.status).toBe(404);
    });
  });

  describe('POST /api/sandboxes/:id/start', () => {
    it('should start a sandbox', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'POST', '/api/sandboxes/test-1/start', {
        entryFile: '/app/main.js',
      });

      expect(result.status).toBe(200);
      expect(result.body.status).toBe('started');
    });

    it('should return error for missing entryFile', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'POST', '/api/sandboxes/test-1/start', {});

      expect(result.status).toBe(400);
      expect(result.body.error).toContain('Missing required field: entryFile');
    });
  });

  describe('POST /api/sandboxes/:id/stop', () => {
    it('should stop a sandbox', async () => {
      await manager.create('test-1');
      await manager.start('test-1', '/app/main.js');

      const result = await executeRoute(routes, 'POST', '/api/sandboxes/test-1/stop');

      expect(result.status).toBe(200);
      expect(result.body.status).toBe('stopped');
    });
  });

  describe('DELETE /api/sandboxes/:id', () => {
    it('should destroy a sandbox', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'DELETE', '/api/sandboxes/test-1');

      expect(result.status).toBe(200);
      expect(result.body.status).toBe('destroyed');
      expect(manager.get('test-1')).toBeUndefined();
    });
  });

  describe('POST /api/sandboxes/:id/snapshot', () => {
    it('should create a snapshot', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'POST', '/api/sandboxes/test-1/snapshot');

      expect(result.status).toBe(201);
      expect(result.body.snapshotId).toMatch(/^snap_/);
    });
  });

  describe('GET /api/snapshots', () => {
    it('should list all snapshots', async () => {
      await manager.create('test-1');
      await manager.snapshot('test-1');
      await manager.snapshot('test-1');

      const result = await executeRoute(routes, 'GET', '/api/snapshots');

      expect(result.status).toBe(200);
      expect(result.body.snapshots).toHaveLength(2);
    });
  });

  describe('GET /api/snapshots/:id', () => {
    it('should get snapshot details', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await executeRoute(routes, 'GET', `/api/snapshots/${snapshotId}`);

      expect(result.status).toBe(200);
      expect(result.body.id).toBe(snapshotId);
    });

    it('should return 404 for non-existent snapshot', async () => {
      const result = await executeRoute(routes, 'GET', '/api/snapshots/non-existent');

      expect(result.status).toBe(404);
    });
  });

  describe('POST /api/snapshots/:id/resume', () => {
    it('should resume from snapshot', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await executeRoute(routes, 'POST', `/api/snapshots/${snapshotId}/resume`);

      expect(result.status).toBe(201);
      expect(result.body.id).toContain('test-1-resume');
    });

    it('should resume with custom ID', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await executeRoute(routes, 'POST', `/api/snapshots/${snapshotId}/resume`, {
        newId: 'test-2',
      });

      expect(result.status).toBe(201);
      expect(result.body.id).toBe('test-2');
    });
  });

  describe('DELETE /api/snapshots/:id', () => {
    it('should delete a snapshot', async () => {
      await manager.create('test-1');
      const { snapshotId } = await manager.snapshot('test-1');

      const result = await executeRoute(routes, 'DELETE', `/api/snapshots/${snapshotId}`);

      expect(result.status).toBe(200);
      expect(result.body.status).toBe('deleted');
    });
  });

  describe('GET /api/sandboxes/:id/logs', () => {
    it('should get logs', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'GET', '/api/sandboxes/test-1/logs');

      expect(result.status).toBe(200);
      expect(Array.isArray(result.body.logs)).toBe(true);
    });

    it('should support count parameter', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'GET', '/api/sandboxes/test-1/logs?count=10');

      expect(result.status).toBe(200);
    });
  });

  describe('GET /api/sandboxes/:id/state', () => {
    it('should get state', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'GET', '/api/sandboxes/test-1/state');

      expect(result.status).toBe(200);
      expect(result.body.state).toBeDefined();
    });
  });

  describe('File operations', () => {
    it('should write and read files', async () => {
      await manager.create('test-1');

      // Write file
      const writeResult = await executeRoute(
        routes,
        'PUT',
        '/api/sandboxes/test-1/files/app/test.js',
        { content: 'console.log("test")' }
      );

      expect(writeResult.status).toBe(200);
      expect(writeResult.body.status).toBe('written');

      // Read file
      const readResult = await executeRoute(
        routes,
        'GET',
        '/api/sandboxes/test-1/files/app/test.js'
      );

      expect(readResult.status).toBe(200);
      expect(readResult.body.content).toBe('console.log("test")');
    });

    it('should return error for missing content on write', async () => {
      await manager.create('test-1');

      const result = await executeRoute(
        routes,
        'PUT',
        '/api/sandboxes/test-1/files/app/test.js',
        {}
      );

      expect(result.status).toBe(400);
      expect(result.body.error).toContain('Missing required field: content');
    });
  });

  describe('Chat endpoint', () => {
    it('should return 501 when no chat handler', async () => {
      await manager.create('test-1');

      const result = await executeRoute(routes, 'POST', '/api/sandboxes/test-1/chat', {
        message: 'Hello',
      });

      expect(result.status).toBe(501);
      expect(result.body.error).toBe('Chat not available');
    });

    it('should call chat handler when provided', async () => {
      const chatHandler = vi.fn();
      const routesWithChat = createApiRoutes({
        manager,
        basePath: '/api',
        chatHandler,
      });

      await manager.create('test-1');

      const req = createMockRequest('POST', '/api/sandboxes/test-1/chat', {
        message: 'Hello',
      });
      const res = createMockResponse();

      // Find and execute chat route by matching the test path
      const testPath = '/api/sandboxes/test-1/chat';
      for (const route of routesWithChat) {
        if (route.method !== 'POST') continue;

        const matches = typeof route.path === 'string'
          ? route.path === testPath
          : route.path.test(testPath);

        if (matches) {
          await route.handler(req, res);
          break;
        }
      }

      expect(chatHandler).toHaveBeenCalledWith('test-1', 'Hello', res);
    });
  });
});

describe('createHealthRoute', () => {
  it('should create a health check route', async () => {
    const route = createHealthRoute('/api');

    expect(route.method).toBe('GET');
    expect(route.path).toBe('/api/health');

    const req = createMockRequest('GET', '/api/health');
    const res = createMockResponse();

    await route.handler(req, res);

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body).status).toBe('ok');
    expect(JSON.parse(res._body).timestamp).toBeGreaterThan(0);
  });
});
