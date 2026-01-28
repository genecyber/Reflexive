/**
 * .NET Runtime Configuration
 *
 * Uses netcoredbg (Samsung's open-source .NET debugger) with DAP mode.
 * Requires netcoredbg to be installed.
 *
 * Installation:
 * - macOS: brew install netcoredbg
 * - Linux: Download from https://github.com/Samsung/netcoredbg/releases
 * - Windows: Download from https://github.com/Samsung/netcoredbg/releases
 */

import { spawn } from 'child_process';
import type { LanguageRuntime, DebugConnectionOptions } from '../types/debug.js';
import { DAPAdapter } from '../adapters/dap-adapter.js';

export const dotnetRuntime: LanguageRuntime = {
  name: 'dotnet',
  displayName: '.NET',
  extensions: ['.cs', '.csproj', '.fsproj', '.dll'],
  command: 'netcoredbg',
  defaultPort: 4712,
  protocol: 'dap',

  buildArgs(port: number, _entryFile: string, _args?: string[]): string[] {
    // netcoredbg runs as a DAP server
    // The actual program to debug is specified in the launch request
    return [
      '--interpreter=vscode',
      `--server=${port}`,
    ];
  },

  buildEnv(_port: number): Record<string, string> {
    return {
      // Enable .NET diagnostics
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    };
  },

  parseDebugReady(output: string, port: number): DebugConnectionOptions | null {
    // netcoredbg doesn't output much when starting as a server
    // It's ready when the server is listening

    // Some versions output: "Listening on port 4712"
    if (output.includes('Listening on port') || output.includes(`:${port}`)) {
      return { port, host: '127.0.0.1' };
    }

    // For some versions, we might need to just wait a moment and try connecting
    // The server starts quickly
    return null;
  },

  createAdapter() {
    return new DAPAdapter();
  },

  async validateSetup(): Promise<{ valid: boolean; message?: string }> {
    return new Promise((resolve) => {
      // Check if netcoredbg is installed
      const proc = spawn('netcoredbg', ['--version'], {
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
        if (code === 0 || output.includes('netcoredbg')) {
          resolve({ valid: true });
        } else {
          resolve({
            valid: false,
            message: `netcoredbg not found. Install from: https://github.com/Samsung/netcoredbg/releases\n${output}`,
          });
        }
      });

      proc.on('error', () => {
        resolve({
          valid: false,
          message: 'netcoredbg not found. Install from: https://github.com/Samsung/netcoredbg/releases',
        });
      });
    });
  },
};

/**
 * Helper to create .NET-specific launch configuration
 *
 * Used when sending the DAP launch request for .NET programs.
 */
export function createDotnetLaunchConfig(
  entryFile: string,
  args?: string[],
  cwd?: string
): Record<string, unknown> {
  // Determine if we're launching a .dll or need to build first
  const isDll = entryFile.endsWith('.dll');

  if (isDll) {
    return {
      request: 'launch',
      program: entryFile,
      args: args || [],
      cwd: cwd || process.cwd(),
      stopAtEntry: false,
    };
  }

  // For .csproj or directory, use dotnet run
  return {
    request: 'launch',
    program: 'dotnet',
    args: ['run', '--project', entryFile, '--', ...(args || [])],
    cwd: cwd || process.cwd(),
    stopAtEntry: false,
  };
}
