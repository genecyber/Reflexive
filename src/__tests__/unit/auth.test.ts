/**
 * Auth Middleware Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  extractApiKey,
  validateApiKey,
  isPublicPath,
  createAuthMiddleware,
  createAuthConfigFromEnv,
  createRateLimiter,
  createDefaultRateLimitConfig,
  type AuthConfig,
} from '../../api/auth.js';

// Mock request/response helpers
function createMockRequest(headers: Record<string, string> = {}): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function createMockResponse(): ServerResponse & { body: unknown; statusCode: number; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    body: null,
    headers,
    writeHead: vi.fn((status: number, h?: Record<string, string>) => {
      // @ts-expect-error mock property
      headers.statusCode = status;
      if (h) Object.assign(headers, h);
    }),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    end: vi.fn((data: string) => {
      // @ts-expect-error mock property
      headers.body = data;
    }),
  } as unknown as ServerResponse & { body: unknown; statusCode: number; headers: Record<string, string> };
}

describe('extractApiKey', () => {
  it('should extract key from X-API-Key header', () => {
    const req = createMockRequest({ 'x-api-key': 'test-key-123' });
    expect(extractApiKey(req)).toBe('test-key-123');
  });

  it('should extract key from Authorization: Bearer header', () => {
    const req = createMockRequest({ authorization: 'Bearer test-key-456' });
    expect(extractApiKey(req)).toBe('test-key-456');
  });

  it('should prefer X-API-Key over Authorization', () => {
    const req = createMockRequest({
      'x-api-key': 'key-1',
      authorization: 'Bearer key-2',
    });
    expect(extractApiKey(req)).toBe('key-1');
  });

  it('should return null when no key present', () => {
    const req = createMockRequest({});
    expect(extractApiKey(req)).toBeNull();
  });

  it('should return null for invalid Authorization format', () => {
    const req = createMockRequest({ authorization: 'Basic abc123' });
    expect(extractApiKey(req)).toBeNull();
  });
});

describe('validateApiKey', () => {
  it('should authenticate with matching primary key', () => {
    const config: AuthConfig = { apiKey: 'secret-key' };
    const result = validateApiKey('secret-key', config);

    expect(result.authenticated).toBe(true);
    expect(result.keyId).toBe('primary');
  });

  it('should authenticate with matching additional key', () => {
    const config: AuthConfig = {
      apiKey: 'primary-key',
      additionalKeys: ['extra-1', 'extra-2'],
    };
    const result = validateApiKey('extra-2', config);

    expect(result.authenticated).toBe(true);
    expect(result.keyId).toBe('additional-1');
  });

  it('should reject invalid key', () => {
    const config: AuthConfig = { apiKey: 'secret-key' };
    const result = validateApiKey('wrong-key', config);

    expect(result.authenticated).toBe(false);
    expect(result.error).toBe('Invalid API key');
  });

  it('should reject missing key when key is required', () => {
    const config: AuthConfig = { apiKey: 'secret-key' };
    const result = validateApiKey(null, config);

    expect(result.authenticated).toBe(false);
    expect(result.error).toBe('API key required');
  });

  it('should allow anonymous when no key configured and allowAnonymous', () => {
    const config: AuthConfig = { allowAnonymous: true };
    const result = validateApiKey(null, config);

    expect(result.authenticated).toBe(true);
    expect(result.keyId).toBe('anonymous');
  });

  it('should reject when no key configured and not allowAnonymous', () => {
    const config: AuthConfig = {};
    const result = validateApiKey(null, config);

    expect(result.authenticated).toBe(false);
    expect(result.error).toBe('No API key configured');
  });
});

describe('isPublicPath', () => {
  const config: AuthConfig = {
    publicPaths: ['/health', '/api/health', '/public/*'],
  };

  it('should return true for exact match', () => {
    expect(isPublicPath('/health', config)).toBe(true);
    expect(isPublicPath('/api/health', config)).toBe(true);
  });

  it('should return true for wildcard match', () => {
    expect(isPublicPath('/public/image.png', config)).toBe(true);
    expect(isPublicPath('/public/css/style.css', config)).toBe(true);
  });

  it('should return false for non-matching path', () => {
    expect(isPublicPath('/api/sandboxes', config)).toBe(false);
  });

  it('should return false when no public paths', () => {
    expect(isPublicPath('/health', {})).toBe(false);
  });
});

describe('createAuthMiddleware', () => {
  it('should allow request with valid key', async () => {
    const config: AuthConfig = { apiKey: 'test-key' };
    const middleware = createAuthMiddleware(config);

    const req = createMockRequest({ 'x-api-key': 'test-key' });
    const res = createMockResponse();

    const result = await middleware(req, res, '/api/sandboxes');

    expect(result).toBe(true);
  });

  it('should reject request with invalid key', async () => {
    const config: AuthConfig = { apiKey: 'test-key' };
    const middleware = createAuthMiddleware(config);

    const req = createMockRequest({ 'x-api-key': 'wrong-key' });
    const res = createMockResponse();

    const result = await middleware(req, res, '/api/sandboxes');

    expect(result).toBe(false);
    expect(res.writeHead).toHaveBeenCalled();
  });

  it('should allow public paths without authentication', async () => {
    const config: AuthConfig = {
      apiKey: 'test-key',
      publicPaths: ['/health'],
    };
    const middleware = createAuthMiddleware(config);

    const req = createMockRequest({});
    const res = createMockResponse();

    const result = await middleware(req, res, '/health');

    expect(result).toBe(true);
  });

  it('should attach auth info to request', async () => {
    const config: AuthConfig = { apiKey: 'test-key' };
    const middleware = createAuthMiddleware(config);

    const req = createMockRequest({ 'x-api-key': 'test-key' });
    const res = createMockResponse();

    await middleware(req, res, '/api/sandboxes');

    expect((req as unknown as { auth: { keyId: string } }).auth.keyId).toBe('primary');
  });
});

describe('createAuthConfigFromEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.REFLEXIVE_API_KEY;
    delete process.env.API_KEY;
    delete process.env.REFLEXIVE_ADDITIONAL_KEYS;
    delete process.env.REFLEXIVE_PUBLIC_PATHS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use REFLEXIVE_API_KEY', () => {
    process.env.REFLEXIVE_API_KEY = 'env-key';

    const config = createAuthConfigFromEnv();

    expect(config.apiKey).toBe('env-key');
    expect(config.allowAnonymous).toBe(false);
  });

  it('should fall back to API_KEY', () => {
    process.env.API_KEY = 'fallback-key';

    const config = createAuthConfigFromEnv();

    expect(config.apiKey).toBe('fallback-key');
  });

  it('should parse additional keys', () => {
    process.env.REFLEXIVE_API_KEY = 'primary';
    process.env.REFLEXIVE_ADDITIONAL_KEYS = 'key1, key2, key3';

    const config = createAuthConfigFromEnv();

    expect(config.additionalKeys).toEqual(['key1', 'key2', 'key3']);
  });

  it('should include default public paths', () => {
    const config = createAuthConfigFromEnv();

    expect(config.publicPaths).toContain('/health');
    expect(config.publicPaths).toContain('/api/health');
  });

  it('should allow anonymous when no key configured', () => {
    const config = createAuthConfigFromEnv();

    expect(config.allowAnonymous).toBe(true);
  });
});

describe('createRateLimiter', () => {
  it('should allow requests under limit', () => {
    const limiter = createRateLimiter({
      maxRequests: 10,
      windowMs: 60000,
    });

    const req = createMockRequest({});
    const res = createMockResponse();

    const result = limiter(req, res);

    expect(result).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '9');
  });

  it('should block requests over limit', () => {
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60000,
    });

    const req = createMockRequest({});
    const res = createMockResponse();

    limiter(req, res);
    limiter(req, res);
    const result = limiter(req, res);

    expect(result).toBe(false);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('should use API key as identifier when configured', () => {
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60000,
      useApiKey: true,
    });

    const req1 = createMockRequest({});
    (req1 as unknown as { auth: { keyId: string } }).auth = { keyId: 'user-1' };

    const req2 = createMockRequest({});
    (req2 as unknown as { auth: { keyId: string } }).auth = { keyId: 'user-2' };

    const res1 = createMockResponse();
    const res2 = createMockResponse();

    // User 1 makes 2 requests
    limiter(req1, res1);
    limiter(req1, res1);

    // User 2 should still be allowed
    const result = limiter(req2, res2);
    expect(result).toBe(true);
  });

  it('should use X-Forwarded-For for IP', () => {
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60000,
    });

    const req = createMockRequest({
      'x-forwarded-for': '1.2.3.4, 5.6.7.8',
    });
    const res = createMockResponse();

    limiter(req, res);

    // The limiter should use the first IP from X-Forwarded-For
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '1');
  });
});

describe('createDefaultRateLimitConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.REFLEXIVE_RATE_LIMIT;
    delete process.env.REFLEXIVE_RATE_WINDOW_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use default values', () => {
    const config = createDefaultRateLimitConfig();

    expect(config.maxRequests).toBe(100);
    expect(config.windowMs).toBe(60000);
    expect(config.useApiKey).toBe(true);
  });

  it('should use environment variables', () => {
    process.env.REFLEXIVE_RATE_LIMIT = '50';
    process.env.REFLEXIVE_RATE_WINDOW_MS = '30000';

    const config = createDefaultRateLimitConfig();

    expect(config.maxRequests).toBe(50);
    expect(config.windowMs).toBe(30000);
  });
});
