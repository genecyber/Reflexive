/**
 * Language Runtime Registry
 *
 * Central registry for all supported language runtimes.
 * Use this to get the appropriate runtime for a file extension
 * or to register custom runtimes.
 */

import { extname } from 'path';
import type { LanguageRuntime, RuntimeRegistry } from '../types/debug.js';
import { nodeRuntime } from './node.js';
import { pythonRuntime } from './python.js';
import { goRuntime } from './go.js';
import { dotnetRuntime } from './dotnet.js';
import { rustRuntime } from './rust.js';

/**
 * Default runtime registry implementation
 */
class DefaultRuntimeRegistry implements RuntimeRegistry {
  private runtimes = new Map<string, LanguageRuntime>();
  private extensionMap = new Map<string, LanguageRuntime>();

  constructor() {
    // Register built-in runtimes
    this.register(nodeRuntime);
    this.register(pythonRuntime);
    this.register(goRuntime);
    this.register(dotnetRuntime);
    this.register(rustRuntime);
  }

  /**
   * Get a runtime by name
   */
  get(name: string): LanguageRuntime | undefined {
    return this.runtimes.get(name);
  }

  /**
   * Get a runtime by file extension
   */
  getByExtension(ext: string): LanguageRuntime | undefined {
    // Normalize extension (ensure it starts with .)
    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
    return this.extensionMap.get(normalizedExt);
  }

  /**
   * Get a runtime for a file path
   */
  getByFile(filePath: string): LanguageRuntime | undefined {
    const ext = extname(filePath);
    return this.getByExtension(ext);
  }

  /**
   * List all registered runtimes
   */
  list(): LanguageRuntime[] {
    return Array.from(this.runtimes.values());
  }

  /**
   * Register a new runtime
   */
  register(runtime: LanguageRuntime): void {
    this.runtimes.set(runtime.name, runtime);

    // Map extensions to this runtime
    for (const ext of runtime.extensions) {
      this.extensionMap.set(ext, runtime);
    }
  }

  /**
   * Unregister a runtime
   */
  unregister(name: string): boolean {
    const runtime = this.runtimes.get(name);
    if (!runtime) return false;

    this.runtimes.delete(name);

    // Remove extension mappings
    for (const ext of runtime.extensions) {
      if (this.extensionMap.get(ext) === runtime) {
        this.extensionMap.delete(ext);
      }
    }

    return true;
  }

  /**
   * Check if a file extension is supported
   */
  isSupported(fileOrExt: string): boolean {
    const ext = fileOrExt.includes('.') && !fileOrExt.startsWith('.')
      ? extname(fileOrExt)
      : fileOrExt.startsWith('.') ? fileOrExt : `.${fileOrExt}`;
    return this.extensionMap.has(ext);
  }

  /**
   * Get list of supported extensions
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }
}

/**
 * Global runtime registry instance
 */
export const runtimeRegistry = new DefaultRuntimeRegistry();

/**
 * Convenience function to get runtime by file
 */
export function getRuntimeForFile(filePath: string): LanguageRuntime | undefined {
  return runtimeRegistry.getByFile(filePath);
}

/**
 * Convenience function to check if a file is debuggable
 */
export function isDebuggable(filePath: string): boolean {
  return runtimeRegistry.isSupported(filePath);
}

/**
 * Validate that a runtime's dependencies are available
 */
export async function validateRuntime(runtime: LanguageRuntime): Promise<{ valid: boolean; message?: string }> {
  if (runtime.validateSetup) {
    return runtime.validateSetup();
  }
  return { valid: true };
}

/**
 * Find an available port starting from a given port
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import('net');

  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(startPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : startPort;
      server.close(() => resolve(port));
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use, try next one
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

// Re-export individual runtimes for direct access
export { nodeRuntime } from './node.js';
export { pythonRuntime } from './python.js';
export { goRuntime } from './go.js';
export { dotnetRuntime } from './dotnet.js';
export { rustRuntime } from './rust.js';
