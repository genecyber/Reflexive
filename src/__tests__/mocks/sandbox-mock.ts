/**
 * Mock Sandbox for testing without real Vercel Sandbox
 */

export interface MockSandboxOptions {
  vcpus?: number;
  memory?: number;
  timeout?: string | number;
}

export interface MockFile {
  path: string;
  content: Buffer;
}

export interface MockCommand {
  cmd: string;
  args: string[];
}

/**
 * Mock command result that mimics the real @vercel/sandbox API
 * where stdout() and stderr() are async methods
 */
export interface MockCommandResult {
  exitCode: number;
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
}

export class MockSandbox {
  sandboxId = 'mock-sandbox-' + Math.random().toString(36).slice(2);
  files: Map<string, string> = new Map();
  commands: MockCommand[] = [];
  isRunning = false;
  options: MockSandboxOptions;

  constructor(options: MockSandboxOptions = {}) {
    this.options = options;
  }

  static async create(options: MockSandboxOptions = {}): Promise<MockSandbox> {
    return new MockSandbox(options);
  }

  async writeFiles(files: MockFile[]): Promise<void> {
    files.forEach(f => this.files.set(f.path, f.content.toString()));
  }

  async readFileToBuffer(file: { path: string; cwd?: string }): Promise<Buffer | null> {
    const content = this.files.get(file.path);
    if (!content) {
      return null;
    }
    return Buffer.from(content);
  }

  async runCommand(options: { cmd: string; args?: string[] }): Promise<MockCommandResult> {
    const args = options.args || [];
    this.commands.push({ cmd: options.cmd, args });

    // Simulate reading log file
    if (options.cmd === 'cat' && args[0] === '/tmp/reflexive-logs.jsonl') {
      const logContent = this.files.get('/tmp/reflexive-logs.jsonl') || '';
      return {
        exitCode: 0,
        stdout: async () => logContent,
        stderr: async () => '',
      };
    }

    // Simulate node execution - return a promise that never resolves
    // to simulate a long-running process
    if (options.cmd === 'node') {
      this.isRunning = true;
      // Return a promise that only resolves when shutdown is called
      return new Promise((resolve) => {
        this._nodeProcessResolve = () => {
          resolve({
            exitCode: 0,
            stdout: async () => '',
            stderr: async () => '',
          });
        };
      });
    }

    return {
      exitCode: 0,
      stdout: async () => '',
      stderr: async () => '',
    };
  }

  // Hold reference to resolve the node process promise
  private _nodeProcessResolve: (() => void) | null = null;

  async shutdown(): Promise<void> {
    this.isRunning = false;
    // Resolve any pending node process
    if (this._nodeProcessResolve) {
      this._nodeProcessResolve();
      this._nodeProcessResolve = null;
    }
  }
}

/**
 * Factory function to create mock Sandbox module
 */
export function createSandboxMock() {
  return {
    Sandbox: MockSandbox
  };
}
