/**
 * Local Mode MCP Tools
 *
 * Tools specific to local process management (CLI mode).
 * Provides control over the child process, debugging, and injection.
 */

import { z } from 'zod';
import type { ProcessManagerInterface } from '../types/manager.js';
import type { Capabilities } from '../types/index.js';
import { textResult, jsonResult, errorResult, createTool, type AnyToolDefinition } from './tools.js';

export interface LocalToolsOptions {
  processManager: ProcessManagerInterface;
  capabilities: Capabilities;
  inject?: boolean;
  eval?: boolean;
  debug?: boolean;
}

/**
 * Create local mode tools for process management
 */
export function createLocalTools(options: LocalToolsOptions): AnyToolDefinition[] {
  const { processManager, capabilities, inject, eval: evalEnabled, debug } = options;

  const tools: AnyToolDefinition[] = [
    // Core process tools
    createTool(
      'get_process_state',
      'Get the state of the running process: pid, uptime, restart count, exit code',
      {},
      async () => jsonResult(processManager.getStatus())
    ),

    createTool(
      'get_output_logs',
      'Get stdout/stderr output from the running process',
      {
        count: z.number().optional().describe('Number of log entries to return (default 50)'),
        type: z.enum(['stdout', 'stderr', 'system', 'error', 'all']).optional()
          .describe('Filter by log type')
      },
      async ({ count, type }) => {
        let logs = processManager.getLogs(count || 50);
        if (type && type !== 'all') {
          logs = logs.filter(l => l.type === type);
        }
        return jsonResult(logs);
      }
    ),

    createTool(
      'search_logs',
      'Search through process output logs',
      {
        query: z.string().describe('Search term'),
        type: z.enum(['stdout', 'stderr', 'all']).optional()
      },
      async ({ query, type }) => {
        let logs = processManager.getLogs(500);
        if (type && type !== 'all') {
          logs = logs.filter(l => l.type === type);
        }
        const matches = logs.filter(l =>
          l.message.toLowerCase().includes(query.toLowerCase())
        );
        return jsonResult(matches.slice(-20));
      }
    ),

    createTool(
      'send_input',
      'Send input to the process stdin',
      {
        input: z.string().describe('Text to send to stdin')
      },
      async ({ input }) => {
        processManager.send(input);
        return textResult(`Sent to stdin: ${input}`);
      }
    ),

    createTool(
      'stop_process',
      'Stop the running process',
      {},
      async () => {
        await processManager.stop();
        return textResult('Process stopped');
      }
    ),

    createTool(
      'start_process',
      'Start the process if it is stopped',
      {},
      async () => {
        if (processManager.isRunning()) {
          return textResult('Process is already running');
        }
        await processManager.restart();
        return textResult('Process started');
      }
    )
  ];

  // Restart tool (capability gated)
  if (capabilities.restart) {
    tools.push(
      createTool(
        'restart_process',
        'Restart the running process',
        {},
        async () => {
          await processManager.restart();
          return textResult('Process restarted successfully');
        }
      )
    );
  } else {
    tools.push(
      createTool(
        'restart_process',
        'Restart the running process',
        {},
        async () => errorResult('Restart capability not enabled. Run with --capabilities restart')
      )
    );
  }

  // Injection tools
  if (inject) {
    tools.push(
      createTool(
        'get_injected_state',
        'Get state from the injected process (only available with --inject flag). Returns custom state set via process.reflexive.setState()',
        {},
        async () => {
          const state = processManager.getInjectedState();
          return jsonResult({
            injectionReady: true,
            state
          });
        }
      ),

      createTool(
        'get_injection_logs',
        'Get logs specifically from the injection module (console intercepts, errors, performance, diagnostics)',
        {
          count: z.number().optional().describe('Number of log entries (default 50)'),
          category: z.enum(['all', 'log', 'error', 'state', 'span', 'perf', 'diagnostic', 'event']).optional()
            .describe('Filter by injection log category')
        },
        async ({ count, category }) => {
          let logs = processManager.getLogs(count || 50);
          logs = logs.filter(l => l.type.startsWith('inject:'));
          if (category && category !== 'all') {
            logs = logs.filter(l => l.type === `inject:${category}`);
          }
          return jsonResult(logs);
        }
      )
    );
  }

  // Eval tools
  if (evalEnabled) {
    tools.push(
      createTool(
        'evaluate_in_app',
        'Execute JavaScript code inside the running application. DANGEROUS: Only available with --eval flag. Can inspect variables, call functions, or modify behavior at runtime.',
        {
          code: z.string().describe('JavaScript code to evaluate in the app context'),
          timeout: z.number().optional().describe('Timeout in milliseconds (default 10000)')
        },
        async ({ code, timeout }) => {
          try {
            const result = await processManager.evaluate(code, timeout || 10000);
            return jsonResult(result);
          } catch (err) {
            return errorResult(`Eval error: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'list_app_globals',
        'List global variables available in the app context. Useful for discovering what can be inspected.',
        {},
        async () => {
          try {
            const result = await processManager.evaluate(`
              const globals = {};
              ['app', 'server', 'db', 'config', 'router', 'express', 'http', 'https', 'fs', 'path'].forEach(name => {
                if (typeof global[name] !== 'undefined') globals[name] = typeof global[name];
              });
              Object.keys(global).forEach(k => {
                if (!k.startsWith('_') && !['global', 'process', 'console', 'Buffer', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'performance', 'fetch'].includes(k)) {
                  globals[k] = typeof global[k];
                }
              });
              globals;
            `);
            return jsonResult(result);
          } catch (err) {
            return errorResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      )
    );
  }

  // Debug tools (V8 Inspector for Node.js, DAP for Python/Go/etc.)
  if (debug) {
    tools.push(
      createTool(
        'debug_set_breakpoint',
        'Set a debugger breakpoint at a specific file and line number. Works for JavaScript/Node.js and Python. The process will pause when this line is executed.',
        {
          file: z.string().describe('Absolute path to the file'),
          line: z.number().describe('Line number (1-based)'),
          condition: z.string().optional().describe('Optional JavaScript condition expression')
        },
        async ({ file, line, condition }) => {
          if (!processManager.isDebuggerConnected()) {
            return errorResult('Debugger not connected. The process may still be starting.');
          }
          try {
            const result = await processManager.debugSetBreakpoint(file, line, condition);
            return textResult(
              `Breakpoint set:\n  ID: ${result.breakpointId}\n  File: ${file}\n  Line: ${line}` +
              (condition ? `\n  Condition: ${condition}` : '') +
              `\n\nExecution will pause when this line is reached.`
            );
          } catch (err) {
            return errorResult(`Failed to set breakpoint: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_remove_breakpoint',
        'Remove a debugger breakpoint by its ID.',
        {
          breakpointId: z.string().describe('The breakpoint ID to remove')
        },
        async ({ breakpointId }) => {
          try {
            await processManager.debugRemoveBreakpoint(breakpointId);
            return textResult(`Breakpoint ${breakpointId} removed.`);
          } catch (err) {
            return errorResult(`Failed to remove breakpoint: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_list_breakpoints',
        'List all debugger breakpoints that have been set.',
        {},
        async () => {
          const breakpoints = processManager.debugListBreakpoints();
          if (breakpoints.length === 0) {
            return textResult('No debugger breakpoints set. Use debug_set_breakpoint to add one.');
          }
          const list = breakpoints.map(bp =>
            `  ${bp.id}\n    File: ${bp.file}\n    Line: ${bp.line}` +
            (bp.condition ? `\n    Condition: ${bp.condition}` : '')
          ).join('\n\n');
          return textResult(`Debugger Breakpoints:\n\n${list}`);
        }
      ),

      createTool(
        'debug_resume',
        'Resume execution after the debugger has paused at a breakpoint.',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused.');
          }
          try {
            await processManager.debugResume();
            return textResult('Execution resumed.');
          } catch (err) {
            return errorResult(`Failed to resume: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_pause',
        'Pause execution immediately. The debugger will stop at the next JavaScript statement.',
        {},
        async () => {
          try {
            await processManager.debugPause();
            return textResult('Pause requested. Execution will stop at the next JavaScript statement.');
          } catch (err) {
            return errorResult(`Failed to pause: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_step_over',
        'Step over the current line of code.',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. Cannot step.');
          }
          try {
            await processManager.debugStepOver();
            return textResult('Stepped over. Use debug_get_call_stack to see current position.');
          } catch (err) {
            return errorResult(`Failed to step over: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_step_into',
        'Step into a function call.',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. Cannot step.');
          }
          try {
            await processManager.debugStepInto();
            return textResult('Stepped into. Use debug_get_call_stack to see current position.');
          } catch (err) {
            return errorResult(`Failed to step into: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_step_out',
        'Step out of the current function.',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. Cannot step.');
          }
          try {
            await processManager.debugStepOut();
            return textResult('Stepping out. Execution will pause after the current function returns.');
          } catch (err) {
            return errorResult(`Failed to step out: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_evaluate',
        'Evaluate a JavaScript expression in the current debug context. When paused, can access local variables.',
        {
          expression: z.string().describe('JavaScript expression to evaluate'),
          callFrameId: z.string().optional().describe('Call frame ID to evaluate in')
        },
        async ({ expression, callFrameId }) => {
          try {
            const result = await processManager.debugEvaluate(expression, callFrameId);
            return jsonResult(result);
          } catch (err) {
            return errorResult(`Evaluation error: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_get_call_stack',
        'Get the current call stack when the debugger is paused.',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. No call stack available.');
          }
          const callStack = processManager.debugGetCallStack();
          if (!callStack) {
            return textResult('No call stack available.');
          }
          return jsonResult(callStack);
        }
      ),

      createTool(
        'debug_get_scope_variables',
        'Get variables from a specific scope when the debugger is paused.',
        {
          callFrameId: z.string().describe('Call frame ID from debug_get_call_stack'),
          scopeType: z.enum(['local', 'closure', 'global', 'with', 'block', 'script', 'catch', 'module']).optional()
            .describe('Type of scope to inspect (default: local)')
        },
        async ({ callFrameId, scopeType = 'local' }) => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. No scope available.');
          }
          try {
            const variables = await processManager.debugGetScopeVariables(callFrameId, scopeType);
            return jsonResult(variables);
          } catch (err) {
            return errorResult(`Failed to get scope variables: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      ),

      createTool(
        'debug_get_state',
        'Get the current debugger state including connection status, pause status, and breakpoints.',
        {},
        async () => jsonResult(processManager.getDebuggerState())
      )
    );
  }

  return tools;
}
