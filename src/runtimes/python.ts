/**
 * Python Runtime Configuration
 *
 * Uses debugpy (Debug Adapter Protocol) for debugging support.
 * Requires debugpy to be installed: pip install debugpy
 */

import { spawn } from 'child_process';
import type { LanguageRuntime, DebugConnectionOptions } from '../types/debug.js';
import { DAPAdapter } from '../adapters/dap-adapter.js';

export const pythonRuntime: LanguageRuntime = {
  name: 'python',
  displayName: 'Python',
  extensions: ['.py', '.pyw'],
  command: 'python',
  defaultPort: 5678,
  protocol: 'dap',

  buildArgs(port: number, entryFile: string, args?: string[]): string[] {
    // Use debugpy module to start with debugging
    // --wait-for-client pauses execution until we connect
    return [
      '-m',
      'debugpy',
      '--listen',
      `127.0.0.1:${port}`,
      '--wait-for-client',
      entryFile,
      ...(args || []),
    ];
  },

  buildEnv(_port: number): Record<string, string> {
    return {
      // Disable Python's output buffering for real-time logging
      PYTHONUNBUFFERED: '1',
    };
  },

  parseDebugReady(output: string, port: number): DebugConnectionOptions | null {
    // debugpy outputs something like:
    // "0.00s - Debugger started listening on 127.0.0.1:5678"
    // or just starts listening without explicit message

    // Check for explicit ready message
    if (output.includes(`listening on`) && output.includes(String(port))) {
      return { port, host: '127.0.0.1' };
    }

    // debugpy may also just say "waiting for client"
    if (output.toLowerCase().includes('waiting for client') ||
        output.toLowerCase().includes('wait for client')) {
      return { port, host: '127.0.0.1' };
    }

    return null;
  },

  createAdapter() {
    return new DAPAdapter();
  },

  async validateSetup(): Promise<{ valid: boolean; message?: string }> {
    return new Promise((resolve) => {
      // Check if debugpy is installed
      const proc = spawn('python', ['-m', 'debugpy', '--version'], {
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
            message: `debugpy not found. Install with: pip install debugpy\n${output}`,
          });
        }
      });

      proc.on('error', () => {
        resolve({
          valid: false,
          message: 'Python not found. Ensure Python is installed and in PATH.',
        });
      });
    });
  },
};
