/**
 * HTTP Server Setup
 *
 * Creates and configures the HTTP server for the Reflexive dashboard.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RequestHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void> | void;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | '*';
  path: string | RegExp;
  handler: RequestHandler;
}

export interface ServerConfig {
  port: number;
  host?: string;
  routes: Route[];
  cors?: boolean;
}

/**
 * Parse JSON body from request
 */
export async function parseJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {} as T);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send HTML response
 */
export function sendHtml(res: ServerResponse, html: string, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * Send error response
 */
export function sendError(res: ServerResponse, message: string, status = 500): void {
  sendJson(res, { error: message }, status);
}

/**
 * Get URL pathname and search params from request
 */
export function parseUrl(req: IncomingMessage): { pathname: string; searchParams: URLSearchParams } {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return {
    pathname: url.pathname,
    searchParams: url.searchParams
  };
}

/**
 * Add CORS headers to response
 */
export function addCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Serve a static file
 */
export function serveFile(
  res: ServerResponse,
  filePath: string,
  contentType: string,
  cacheMaxAge = 0
): boolean {
  try {
    if (!existsSync(filePath)) {
      return false;
    }
    const data = readFileSync(filePath);
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (cacheMaxAge > 0) {
      headers['Cache-Control'] = `public, max-age=${cacheMaxAge}`;
    }
    res.writeHead(200, headers);
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create HTTP server with routes
 */
export function createHttpServer(config: ServerConfig): Server {
  const { routes, cors = true } = config;

  const server = createServer(async (req, res) => {
    // Add CORS headers if enabled
    if (cors) {
      addCorsHeaders(res);
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const { pathname } = parseUrl(req);
    const method = req.method || 'GET';

    // Find matching route
    for (const route of routes) {
      // Check method
      if (route.method !== '*' && route.method !== method) {
        continue;
      }

      // Check path
      if (typeof route.path === 'string') {
        if (route.path !== pathname && route.path + '/' !== pathname) {
          continue;
        }
      } else {
        if (!route.path.test(pathname)) {
          continue;
        }
      }

      // Execute handler
      try {
        await route.handler(req, res);
        return;
      } catch (error) {
        console.error('Route handler error:', error);
        sendError(res, error instanceof Error ? error.message : 'Internal Server Error');
        return;
      }
    }

    // No route matched
    sendError(res, 'Not Found', 404);
  });

  return server;
}

/**
 * Start server with retry on port conflict
 */
export function startServer(
  server: Server,
  config: { port: number; host?: string }
): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    let { port } = config;
    const { host = 'localhost' } = config;
    const maxRetries = 10;
    let retries = 0;

    const tryListen = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && retries < maxRetries) {
          retries++;
          port++;
          tryListen();
        } else {
          reject(err);
        }
      });

      server.once('listening', () => {
        resolve({ port });
      });

      server.listen(port, host);
    };

    tryListen();
  });
}

/**
 * Create a logo route handler
 */
export function createLogoHandler(): RequestHandler {
  return (req, res) => {
    const logoPath = join(__dirname, '..', '..', 'logo-carbon.png');
    if (!serveFile(res, logoPath, 'image/png', 86400)) {
      sendError(res, 'Logo not found', 404);
    }
  };
}
