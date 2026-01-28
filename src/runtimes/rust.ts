/**
 * Rust Runtime Configuration
 *
 * Uses CodeLLDB (LLDB-based debugger with DAP support) for debugging.
 * Requires CodeLLDB extension or standalone codelldb binary.
 *
 * Installation:
 * - VS Code: Install "CodeLLDB" extension
 * - Standalone: Download from https://github.com/vadimcn/codelldb/releases
 *
 * Note: Rust programs must be compiled with debug symbols (default for debug builds).
 */

import { spawn } from 'child_process';
import type { LanguageRuntime, DebugConnectionOptions } from '../types/debug.js';
import { DAPAdapter } from '../adapters/dap-adapter.js';

export const rustRuntime: LanguageRuntime = {
  name: 'rust',
  displayName: 'Rust',
  extensions: ['.rs'],
  command: 'codelldb', // or path to codelldb adapter
  defaultPort: 13000,
  protocol: 'dap',

  buildArgs(port: number, _entryFile: string, _args?: string[]): string[] {
    // codelldb runs as a DAP server on a port
    return [
      '--port', String(port),
    ];
  },

  buildEnv(_port: number): Record<string, string> {
    return {
      // Rust-specific settings
      RUST_BACKTRACE: '1',
    };
  },

  parseDebugReady(output: string, port: number): DebugConnectionOptions | null {
    // codelldb outputs something like: "Listening on port 13000"
    if (output.includes('Listening on port') ||
        output.includes(`port ${port}`) ||
        output.includes(`:${port}`)) {
      return { port, host: '127.0.0.1' };
    }

    return null;
  },

  createAdapter() {
    return new DAPAdapter();
  },

  async validateSetup(): Promise<{ valid: boolean; message?: string }> {
    return new Promise((resolve) => {
      // Try to find codelldb
      // It might be installed as part of VS Code extension or standalone
      const proc = spawn('codelldb', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });

      let output = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ valid: true });
        } else {
          resolve({
            valid: false,
            message: `codelldb not found. Install the CodeLLDB VS Code extension or download from: https://github.com/vadimcn/codelldb/releases\n${output}`,
          });
        }
      });

      proc.on('error', () => {
        resolve({
          valid: false,
          message: 'codelldb not found. Install the CodeLLDB VS Code extension or download from: https://github.com/vadimcn/codelldb/releases',
        });
      });
    });
  },
};

/**
 * Helper to create Rust-specific launch configuration
 *
 * Used when sending the DAP launch request for Rust programs.
 * Note: The binary path should point to the compiled executable.
 */
export function createRustLaunchConfig(
  binaryPath: string,
  args?: string[],
  cwd?: string
): Record<string, unknown> {
  return {
    request: 'launch',
    type: 'lldb',
    program: binaryPath,
    args: args || [],
    cwd: cwd || process.cwd(),
    env: {},
    stopOnEntry: false,
    // Enable expression evaluation
    expressions: 'native',
  };
}
