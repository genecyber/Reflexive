import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, Server } from 'http';
import {
  parseJsonBody,
  sendJson,
  sendHtml,
  sendError,
  parseUrl,
  addCorsHeaders,
  createHttpServer,
  startServer
} from '../../core/http-server.js';
import type { IncomingMessage, ServerResponse } from 'http';

describe('http-server', () => {
  describe('parseJsonBody', () => {
    it('parses valid JSON', async () => {
      const mockReq = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('{"test": "value"}'));
          }
          if (event === 'end') {
            callback();
          }
          return mockReq;
        })
      } as unknown as IncomingMessage;

      const result = await parseJsonBody(mockReq);
      expect(result).toEqual({ test: 'value' });
    });

    it('returns empty object for empty body', async () => {
      const mockReq = {
        on: vi.fn((event, callback) => {
          if (event === 'end') {
            callback();
          }
          return mockReq;
        })
      } as unknown as IncomingMessage;

      const result = await parseJsonBody(mockReq);
      expect(result).toEqual({});
    });

    it('rejects invalid JSON', async () => {
      const mockReq = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('not valid json'));
          }
          if (event === 'end') {
            callback();
          }
          return mockReq;
        })
      } as unknown as IncomingMessage;

      await expect(parseJsonBody(mockReq)).rejects.toThrow('Invalid JSON body');
    });
  });

  describe('sendJson', () => {
    it('sends JSON with correct headers', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;

      sendJson(mockRes, { data: 'test' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith('{"data":"test"}');
    });

    it('allows custom status code', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;

      sendJson(mockRes, { error: 'not found' }, 404);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
    });
  });

  describe('sendHtml', () => {
    it('sends HTML with correct headers', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;

      sendHtml(mockRes, '<html></html>');

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
      expect(mockRes.end).toHaveBeenCalledWith('<html></html>');
    });
  });

  describe('sendError', () => {
    it('sends error with default 500 status', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;

      sendError(mockRes, 'Something went wrong');

      expect(mockRes.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith('{"error":"Something went wrong"}');
    });

    it('uses custom status code', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;

      sendError(mockRes, 'Not found', 404);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('parseUrl', () => {
    it('extracts pathname', () => {
      const mockReq = {
        url: '/api/test?param=value',
        headers: { host: 'localhost:3000' }
      } as IncomingMessage;

      const { pathname, searchParams } = parseUrl(mockReq);

      expect(pathname).toBe('/api/test');
      expect(searchParams.get('param')).toBe('value');
    });

    it('handles missing url', () => {
      const mockReq = {
        url: undefined,
        headers: { host: 'localhost' }
      } as unknown as IncomingMessage;

      const { pathname } = parseUrl(mockReq);

      expect(pathname).toBe('/');
    });
  });

  describe('addCorsHeaders', () => {
    it('sets CORS headers', () => {
      const mockRes = {
        setHeader: vi.fn()
      } as unknown as ServerResponse;

      addCorsHeaders(mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        expect.stringContaining('GET')
      );
    });
  });

  describe('createHttpServer', () => {
    it('creates a server', () => {
      const server = createHttpServer({
        port: 3000,
        routes: []
      });

      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(Server);
    });

    it('handles OPTIONS requests with CORS enabled', async () => {
      const server = createHttpServer({
        port: 0,
        routes: [],
        cors: true
      });

      await new Promise<void>((resolve) => {
        server.listen(49170, async () => {
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : 49170;

          const http = await import('http');
          const req = http.request({
            hostname: 'localhost',
            port,
            method: 'OPTIONS',
            path: '/'
          }, (res) => {
            expect(res.statusCode).toBe(204);
            server.close(() => resolve());
          });

          req.end();
        });
      });
    });
  });

  describe('startServer', () => {
    let server: Server | null = null;

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
        server = null;
      }
    });

    it('starts server on available port', async () => {
      server = createServer();
      // Use a high port that's likely available
      const result = await startServer(server, { port: 49152 });

      expect(result.port).toBeGreaterThanOrEqual(49152);
    });

    it('retries on port conflict', async () => {
      // First server blocks a port
      const blocker = createServer();
      const blockerResult = await startServer(blocker, { port: 49160 });

      // Second server should find another port
      server = createServer();
      const result = await startServer(server, { port: blockerResult.port });

      expect(result.port).toBeGreaterThan(blockerResult.port);

      await new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      });
    });
  });
});
