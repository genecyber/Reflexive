/**
 * API Authentication Middleware
 *
 * Provides API key authentication for hosted mode endpoints.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { sendError } from '../core/http-server.js';

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /**
   * API key for authentication (header: X-API-Key or Authorization: Bearer)
   */
  apiKey?: string;

  /**
   * Additional valid API keys (for key rotation)
   */
  additionalKeys?: string[];

  /**
   * Paths that don't require authentication
   */
  publicPaths?: string[];

  /**
   * Whether to allow anonymous access when no key is configured
   */
  allowAnonymous?: boolean;
}

/**
 * Authentication result
 */
export interface AuthResult {
  authenticated: boolean;
  keyId?: string;
  error?: string;
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(req: IncomingMessage): string | null {
  // Check X-API-Key header
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string') {
    return xApiKey;
  }

  // Check Authorization: Bearer header
  const auth = req.headers.authorization;
  if (auth && typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(\S+)$/i);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Validate an API key against configuration
 */
export function validateApiKey(key: string | null, config: AuthConfig): AuthResult {
  // No key configured - check if anonymous access is allowed
  if (!config.apiKey) {
    if (config.allowAnonymous) {
      return { authenticated: true, keyId: 'anonymous' };
    }
    return { authenticated: false, error: 'No API key configured' };
  }

  // No key provided
  if (!key) {
    return { authenticated: false, error: 'API key required' };
  }

  // Check primary key
  if (key === config.apiKey) {
    return { authenticated: true, keyId: 'primary' };
  }

  // Check additional keys
  if (config.additionalKeys) {
    const index = config.additionalKeys.indexOf(key);
    if (index !== -1) {
      return { authenticated: true, keyId: `additional-${index}` };
    }
  }

  return { authenticated: false, error: 'Invalid API key' };
}

/**
 * Check if a path is public (doesn't require authentication)
 */
export function isPublicPath(pathname: string, config: AuthConfig): boolean {
  if (!config.publicPaths) {
    return false;
  }

  for (const publicPath of config.publicPaths) {
    // Exact match
    if (pathname === publicPath) {
      return true;
    }

    // Prefix match (paths ending with /*)
    if (publicPath.endsWith('/*')) {
      const prefix = publicPath.slice(0, -1);
      if (pathname.startsWith(prefix)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(config: AuthConfig) {
  return async function authenticate(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string
  ): Promise<boolean> {
    // Check if path is public
    if (isPublicPath(pathname, config)) {
      return true;
    }

    // Extract and validate key
    const key = extractApiKey(req);
    const result = validateApiKey(key, config);

    if (!result.authenticated) {
      sendError(res, result.error || 'Unauthorized', 401);
      return false;
    }

    // Attach auth info to request for later use
    (req as AuthenticatedRequest).auth = result;

    return true;
  };
}

/**
 * Extended request type with auth info
 */
export interface AuthenticatedRequest extends IncomingMessage {
  auth?: AuthResult;
}

/**
 * Create auth config from environment variables
 */
export function createAuthConfigFromEnv(): AuthConfig {
  const apiKey = process.env.REFLEXIVE_API_KEY || process.env.API_KEY;
  const additionalKeysStr = process.env.REFLEXIVE_ADDITIONAL_KEYS;

  const additionalKeys = additionalKeysStr
    ? additionalKeysStr.split(',').map(k => k.trim()).filter(k => k)
    : undefined;

  const publicPathsStr = process.env.REFLEXIVE_PUBLIC_PATHS;
  const publicPaths = publicPathsStr
    ? publicPathsStr.split(',').map(p => p.trim()).filter(p => p)
    : ['/health', '/api/health'];

  return {
    apiKey,
    additionalKeys,
    publicPaths,
    allowAnonymous: !apiKey,
  };
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /**
   * Maximum requests per window
   */
  maxRequests: number;

  /**
   * Window size in milliseconds
   */
  windowMs: number;

  /**
   * Use API key as identifier (otherwise uses IP)
   */
  useApiKey?: boolean;
}

/**
 * Rate limit entry
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Create a simple rate limiter
 */
export function createRateLimiter(config: RateLimitConfig) {
  const entries = new Map<string, RateLimitEntry>();

  // Clean up old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) {
        entries.delete(key);
      }
    }
  }, config.windowMs);

  return function checkRateLimit(
    req: IncomingMessage,
    res: ServerResponse
  ): boolean {
    // Get identifier
    let identifier: string;
    if (config.useApiKey && (req as AuthenticatedRequest).auth?.keyId) {
      identifier = (req as AuthenticatedRequest).auth!.keyId!;
    } else {
      // Use IP address
      identifier =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        'unknown';
    }

    const now = Date.now();
    let entry = entries.get(identifier);

    // Create or reset entry if expired
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + config.windowMs,
      };
      entries.set(identifier, entry);
    }

    // Increment count
    entry.count++;

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - entry.count).toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString());

    // Check if over limit
    if (entry.count > config.maxRequests) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000).toString());
      sendError(res, 'Too many requests', 429);
      return false;
    }

    return true;
  };
}

/**
 * Create default rate limit config
 */
export function createDefaultRateLimitConfig(): RateLimitConfig {
  return {
    maxRequests: parseInt(process.env.REFLEXIVE_RATE_LIMIT || '100', 10),
    windowMs: parseInt(process.env.REFLEXIVE_RATE_WINDOW_MS || '60000', 10),
    useApiKey: true,
  };
}
