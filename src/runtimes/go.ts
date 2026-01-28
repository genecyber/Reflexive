/**
 * Go Runtime Configuration
 *
 * Uses Delve (dlv) with DAP mode for debugging support.
 * Requires Delve to be installed: go install github.com/go-delve/delve/cmd/dlv@latest
 */

import { spawn } from 'child_process';
import type { LanguageRuntime, DebugConnectionOptions } from '../types/debug.js';
import { DAPAdapter } from '../adapters/dap-adapter.js';

export const goRuntime: LanguageRuntime = {
  name: 'go',
  displayName: 'Go',
  extensions: ['.go'],
  command: 'dlv',
  defaultPort: 4711,
  protocol: 'dap',

  buildArgs(port: number, entryFile: string, args?: string[]): string[] {
    // Use Delve in DAP mode
    // For Go, we typically debug the directory containing main.go
    // The entryFile might be a specific .go file or a directory

    // Note: dlv dap mode launches a DAP server that expects launch/attach requests
    // We use 'dlv dap' which is the cleanest approach
    const dlvArgs = [
      'dap',
      '--listen', `127.0.0.1:${port}`,
      '--log',
    ];

    // If args are provided, they'll be passed via the DAP launch request
    // Store them for later use in the launch config
    return dlvArgs;
  },

  buildEnv(_port: number): Record<string, string> {
    return {};
  },

  parseDebugReady(output: string, port: number): DebugConnectionOptions | null {
    // Delve outputs: "DAP server listening at: 127.0.0.1:4711"
    if (output.includes('DAP server listening') ||
        output.includes(`listening at: 127.0.0.1:${port}`) ||
        output.includes(`listening at: :${port}`)) {
      return { port, host: '127.0.0.1' };
    }

    // Alternative format
    if (output.includes('API server listening') && output.includes(String(port))) {
      return { port, host: '127.0.0.1' };
    }

    return null;
  },

  createAdapter() {
    return new DAPAdapter();
  },

  async validateSetup(): Promise<{ valid: boolean; message?: string }> {
    return new Promise((resolve) => {
      // Check if dlv is installed
      const proc = spawn('dlv', ['version'], {
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
        if (code === 0 && output.includes('Delve')) {
          resolve({ valid: true });
        } else {
          resolve({
            valid: false,
            message: `Delve not found. Install with: go install github.com/go-delve/delve/cmd/dlv@latest\n${output}`,
          });
        }
      });

      proc.on('error', () => {
        resolve({
          valid: false,
          message: 'Delve (dlv) not found. Install with: go install github.com/go-delve/delve/cmd/dlv@latest',
        });
      });
    });
  },
};

/**
 * Helper to create Go-specific launch configuration
 *
 * Used when sending the DAP launch request for Go programs.
 */
export function createGoLaunchConfig(
  entryFile: string,
  args?: string[],
  cwd?: string
): Record<string, unknown> {
  return {
    request: 'launch',
    mode: 'debug',
    program: entryFile,
    args: args || [],
    cwd: cwd || process.cwd(),
    env: {},
    showLog: true,
  };
}
