/**
 * E2E Tests for REST API
 *
 * Tests the complete REST API workflow using in-memory storage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http, { Server, IncomingMessage, ServerResponse } from 'http';
import { createApiRoutes } from '../../api/routes.js';
import { createHttpServer, startServer } from '../../core/http-server.js';
import { MultiSandboxManager } from '../../managers/multi-sandbox-manager.js';
import { MemoryStorage } from '../../sandbox/storage.js';
import { MockSandbox } from '../mocks/sandbox-mock.js';
import type { Route } from '../../core/http-server.js';

// Mock @vercel/sandbox
vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: async (opts: unknown) => MockSandbox.create(opts as Record<string, unknown>)
  }
}));

// Simple HTTP client for testing
async function request(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res: IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 500,
            data: data ? JSON.parse(data) : null,
          });
        } catch {
          resolve({
            status: res.statusCode || 500,
            data: data,
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('API Routes E2E', () => {
  let server: Server;
  let port: number;
  let manager: MultiSandboxManager;

  beforeEach(async () => {
    const storage = new MemoryStorage();
    manager = new MultiSandboxManager({
      maxSandboxes: 10,
      storage,
    });

    const routes = createApiRoutes({ manager, basePath: '/api' });
    server = createHttpServer({ port: 0, routes });

    await startServer(server, { port: 0, host: '127.0.0.1' });
    // Get the actual port assigned by the OS
    const address = server.address();
    if (address && typeof address !== 'string') {
      port = address.port;
    } else {
      throw new Error('Server did not start properly');
    }
  });

  afterEach(async () => {
    await manager.destroyAll();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const { status, data } = await request(port, 'GET', '/api/health');

      expect(status).toBe(200);
      expect(data).toEqual({
        status: 'ok',
        sandboxes: 0,
        running: 0,
      });
    });
  });

  describe('Sandbox CRUD', () => {
    it('should create a sandbox via POST', async () => {
      const { status, data } = await request(port, 'POST', '/api/sandboxes', {
        id: 'test-sandbox',
      });

      expect(status).toBe(201);
      expect((data as Record<string, unknown>).id).toBe('test-sandbox');
      expect((data as Record<string, unknown>).status).toBe('created');
    });

    it('should list sandboxes via GET', async () => {
      await manager.create('sandbox-1');
      await manager.create('sandbox-2');

      const { status, data } = await request(port, 'GET', '/api/sandboxes');

      expect(status).toBe(200);
      expect((data as { sandboxes: unknown[] }).sandboxes).toHaveLength(2);
    });

    it('should get sandbox by ID via GET', async () => {
      await manager.create('test-sandbox');

      const { status, data } = await request(port, 'GET', '/api/sandboxes/test-sandbox');

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).id).toBe('test-sandbox');
    });

    it('should delete sandbox via DELETE', async () => {
      await manager.create('test-sandbox');

      const { status, data } = await request(port, 'DELETE', '/api/sandboxes/test-sandbox');

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).status).toBe('destroyed');
      expect(manager.get('test-sandbox')).toBeUndefined();
    });
  });

  describe('Sandbox Lifecycle', () => {
    it('should start a sandbox via POST', async () => {
      await manager.create('test-sandbox');

      const { status, data } = await request(port, 'POST', '/api/sandboxes/test-sandbox/start', {
        entryFile: '/app/main.js',
      });

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).status).toBe('started');
      expect(manager.get('test-sandbox')?.status).toBe('running');
    });

    it('should stop a sandbox via POST', async () => {
      await manager.create('test-sandbox');
      await manager.start('test-sandbox', '/app/main.js');

      const { status, data } = await request(port, 'POST', '/api/sandboxes/test-sandbox/stop');

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).status).toBe('stopped');
      expect(manager.get('test-sandbox')?.status).toBe('stopped');
    });
  });

  describe('Snapshot Operations', () => {
    it('should create snapshot via POST', async () => {
      await manager.create('test-sandbox');

      const { status, data } = await request(
        port,
        'POST',
        '/api/sandboxes/test-sandbox/snapshot'
      );

      expect(status).toBe(201);
      expect((data as Record<string, unknown>).snapshotId).toMatch(/^snap_/);
    });

    it('should list snapshots via GET', async () => {
      await manager.create('test-sandbox');
      await manager.snapshot('test-sandbox');
      await manager.snapshot('test-sandbox');

      const { status, data } = await request(port, 'GET', '/api/snapshots');

      expect(status).toBe(200);
      expect((data as { snapshots: unknown[] }).snapshots).toHaveLength(2);
    });

    it('should resume from snapshot via POST', async () => {
      await manager.create('original');
      const { snapshotId } = await manager.snapshot('original');

      const { status, data } = await request(
        port,
        'POST',
        `/api/snapshots/${snapshotId}/resume`,
        { newId: 'restored' }
      );

      expect(status).toBe(201);
      expect((data as Record<string, unknown>).id).toBe('restored');
      expect(manager.get('restored')).toBeDefined();
    });

    it('should delete snapshot via DELETE', async () => {
      await manager.create('test-sandbox');
      const { snapshotId } = await manager.snapshot('test-sandbox');

      const { status, data } = await request(port, 'DELETE', `/api/snapshots/${snapshotId}`);

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).status).toBe('deleted');
    });
  });

  describe('Logs and State', () => {
    it('should get logs via GET', async () => {
      await manager.create('test-sandbox');

      const { status, data } = await request(port, 'GET', '/api/sandboxes/test-sandbox/logs');

      expect(status).toBe(200);
      expect(Array.isArray((data as { logs: unknown[] }).logs)).toBe(true);
    });

    it('should get state via GET', async () => {
      await manager.create('test-sandbox');

      const { status, data } = await request(port, 'GET', '/api/sandboxes/test-sandbox/state');

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).state).toBeDefined();
    });
  });

  describe('File Operations', () => {
    it('should write file via PUT', async () => {
      await manager.create('test-sandbox');

      const { status, data } = await request(
        port,
        'PUT',
        '/api/sandboxes/test-sandbox/files/app/test.js',
        { content: 'console.log("test")' }
      );

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).status).toBe('written');
    });

    it('should read file via GET', async () => {
      await manager.create('test-sandbox');
      await manager.writeFile('test-sandbox', '/app/test.js', 'console.log("test")');

      const { status, data } = await request(
        port,
        'GET',
        '/api/sandboxes/test-sandbox/files/app/test.js'
      );

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).content).toBe('console.log("test")');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent sandbox', async () => {
      const { status, data } = await request(port, 'GET', '/api/sandboxes/non-existent');

      expect(status).toBe(404);
      expect((data as Record<string, unknown>).error).toContain('not found');
    });

    it('should return 400 for invalid request', async () => {
      const { status, data } = await request(port, 'POST', '/api/sandboxes', {});

      expect(status).toBe(400);
      expect((data as Record<string, unknown>).error).toContain('Missing required field');
    });

    it('should return 404 for non-existent route', async () => {
      const { status } = await request(port, 'GET', '/api/non-existent');

      expect(status).toBe(404);
    });
  });

  describe('Complete Workflow', () => {
    it('should complete full sandbox lifecycle', async () => {
      // Create
      let res = await request(port, 'POST', '/api/sandboxes', { id: 'workflow-test' });
      expect(res.status).toBe(201);

      // Write files
      res = await request(port, 'PUT', '/api/sandboxes/workflow-test/files/app/main.js', {
        content: 'console.log("Hello")',
      });
      expect(res.status).toBe(200);

      // Start
      res = await request(port, 'POST', '/api/sandboxes/workflow-test/start', {
        entryFile: '/app/main.js',
      });
      expect(res.status).toBe(200);

      // Snapshot
      res = await request(port, 'POST', '/api/sandboxes/workflow-test/snapshot');
      expect(res.status).toBe(201);
      const snapshotId = (res.data as Record<string, string>).snapshotId;

      // Stop
      res = await request(port, 'POST', '/api/sandboxes/workflow-test/stop');
      expect(res.status).toBe(200);

      // Destroy
      res = await request(port, 'DELETE', '/api/sandboxes/workflow-test');
      expect(res.status).toBe(200);

      // Resume from snapshot
      res = await request(port, 'POST', `/api/snapshots/${snapshotId}/resume`, {
        newId: 'workflow-restored',
      });
      expect(res.status).toBe(201);

      // Verify restored sandbox
      res = await request(port, 'GET', '/api/sandboxes/workflow-restored');
      expect(res.status).toBe(200);
      expect((res.data as Record<string, unknown>).id).toBe('workflow-restored');
    });
  });
});
