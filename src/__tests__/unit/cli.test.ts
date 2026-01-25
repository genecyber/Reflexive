import { describe, it, expect } from 'vitest';
import { parseArgs, buildSystemPrompt, getAllowedTools, type CliOptions } from '../../cli.js';
import { ProcessManager } from '../../managers/process-manager.js';

describe('CLI', () => {
  describe('parseArgs', () => {
    it('parses entry file', () => {
      const options = parseArgs(['./app.js']);
      expect(options.entry).toBe('./app.js');
    });

    it('parses port option', () => {
      const options = parseArgs(['--port', '8080', './app.js']);
      expect(options.port).toBe(8080);
    });

    it('parses short port option', () => {
      const options = parseArgs(['-p', '8080', './app.js']);
      expect(options.port).toBe(8080);
    });

    it('parses host option', () => {
      const options = parseArgs(['--host', '0.0.0.0', './app.js']);
      expect(options.host).toBe('0.0.0.0');
    });

    it('parses open flag', () => {
      const options = parseArgs(['--open', './app.js']);
      expect(options.open).toBe(true);
    });

    it('parses short open flag', () => {
      const options = parseArgs(['-o', './app.js']);
      expect(options.open).toBe(true);
    });

    it('parses watch flag', () => {
      const options = parseArgs(['--watch', './app.js']);
      expect(options.watch).toBe(true);
    });

    it('parses short watch flag', () => {
      const options = parseArgs(['-w', './app.js']);
      expect(options.watch).toBe(true);
    });

    it('parses interactive flag', () => {
      const options = parseArgs(['--interactive', './app.js']);
      expect(options.interactive).toBe(true);
    });

    it('parses short interactive flag', () => {
      const options = parseArgs(['-i', './app.js']);
      expect(options.interactive).toBe(true);
    });

    it('parses inject flag', () => {
      const options = parseArgs(['--inject', './app.js']);
      expect(options.inject).toBe(true);
      expect(options.capabilities.inject).toBe(true);
    });

    it('parses eval flag (implies inject)', () => {
      const options = parseArgs(['--eval', './app.js']);
      expect(options.eval).toBe(true);
      expect(options.inject).toBe(true);
      expect(options.capabilities.eval).toBe(true);
      expect(options.capabilities.inject).toBe(true);
    });

    it('parses debug flag', () => {
      const options = parseArgs(['--debug', './app.js']);
      expect(options.debug).toBe(true);
      expect(options.capabilities.debug).toBe(true);
    });

    it('parses short debug flag', () => {
      const options = parseArgs(['-d', './app.js']);
      expect(options.debug).toBe(true);
    });

    it('parses sandbox flag', () => {
      const options = parseArgs(['--sandbox', './app.js']);
      expect(options.sandbox).toBe(true);
    });

    it('parses short sandbox flag', () => {
      const options = parseArgs(['-s', './app.js']);
      expect(options.sandbox).toBe(true);
    });

    it('parses write flag', () => {
      const options = parseArgs(['--write', './app.js']);
      expect(options.capabilities.writeFiles).toBe(true);
    });

    it('parses shell flag', () => {
      const options = parseArgs(['--shell', './app.js']);
      expect(options.capabilities.shellAccess).toBe(true);
    });

    it('parses dangerously-skip-permissions flag', () => {
      const options = parseArgs(['--dangerously-skip-permissions', './app.js']);
      expect(options.capabilities.readFiles).toBe(true);
      expect(options.capabilities.writeFiles).toBe(true);
      expect(options.capabilities.shellAccess).toBe(true);
      expect(options.capabilities.restart).toBe(true);
      expect(options.capabilities.inject).toBe(true);
      expect(options.capabilities.eval).toBe(true);
      expect(options.capabilities.debug).toBe(true);
      expect(options.inject).toBe(true);
      expect(options.eval).toBe(true);
      expect(options.debug).toBe(true);
    });

    it('parses node-args option', () => {
      const options = parseArgs(['--node-args', '--inspect --max-old-space-size=4096', './app.js']);
      expect(options.nodeArgs).toEqual(['--inspect', '--max-old-space-size=4096']);
    });

    it('parses app args after --', () => {
      const options = parseArgs(['./app.js', '--', '--port', '8080', '--verbose']);
      expect(options.entry).toBe('./app.js');
      expect(options.appArgs).toEqual(['--port', '8080', '--verbose']);
    });

    it('parses capabilities option', () => {
      const options = parseArgs(['--capabilities', 'writeFiles,shellAccess', './app.js']);
      expect(options.capabilities.writeFiles).toBe(true);
      expect(options.capabilities.shellAccess).toBe(true);
    });

    it('returns default values', () => {
      const options = parseArgs(['./app.js']);
      expect(options.port).toBe(3099);
      expect(options.host).toBe('localhost');
      expect(options.open).toBe(false);
      expect(options.watch).toBe(false);
      expect(options.interactive).toBe(false);
      expect(options.inject).toBe(false);
      expect(options.eval).toBe(false);
      expect(options.debug).toBe(false);
      expect(options.sandbox).toBe(false);
      expect(options.capabilities.readFiles).toBe(true);
      expect(options.capabilities.writeFiles).toBe(false);
      expect(options.capabilities.shellAccess).toBe(false);
      expect(options.capabilities.restart).toBe(true);
    });

    it('handles empty args', () => {
      const options = parseArgs([]);
      expect(options.entry).toBeNull();
    });

    it('handles multiple options together', () => {
      const options = parseArgs([
        '-p', '8000',
        '-o',
        '-w',
        '-i',
        '--inject',
        '--debug',
        '--write',
        './server.js',
        '--',
        '--env', 'production'
      ]);

      expect(options.port).toBe(8000);
      expect(options.open).toBe(true);
      expect(options.watch).toBe(true);
      expect(options.interactive).toBe(true);
      expect(options.inject).toBe(true);
      expect(options.debug).toBe(true);
      expect(options.capabilities.writeFiles).toBe(true);
      expect(options.entry).toBe('./server.js');
      expect(options.appArgs).toEqual(['--env', 'production']);
    });
  });

  describe('buildSystemPrompt', () => {
    it('includes basic process info', () => {
      const pm = new ProcessManager({ entry: '/app/test.js' });
      const options = {
        entry: '/app/test.js',
        port: 3099,
        host: 'localhost',
        open: false,
        watch: false,
        interactive: false,
        inject: false,
        eval: false,
        debug: false,
        sandbox: false,
        capabilities: {
          readFiles: true,
          writeFiles: false,
          shellAccess: false,
          restart: true,
          inject: false,
          eval: false,
          debug: false
        },
        nodeArgs: [],
        appArgs: []
      } as CliOptions;

      const prompt = buildSystemPrompt(pm, options);

      expect(prompt).toContain('Node.js process');
      expect(prompt).toContain('Read files:');
    });

    it('includes interactive mode instructions', () => {
      const pm = new ProcessManager({ entry: '/app/test.js' });
      const options = {
        entry: '/app/test.js',
        port: 3099,
        host: 'localhost',
        open: false,
        watch: false,
        interactive: true,
        inject: false,
        eval: false,
        debug: false,
        sandbox: false,
        capabilities: {
          readFiles: true,
          writeFiles: false,
          shellAccess: false,
          restart: true,
          inject: false,
          eval: false,
          debug: false
        },
        nodeArgs: [],
        appArgs: []
      } as CliOptions;

      const prompt = buildSystemPrompt(pm, options);

      expect(prompt).toContain('INTERACTIVE MODE');
      expect(prompt).toContain('send_input');
    });

    it('includes injection mode instructions', () => {
      const pm = new ProcessManager({ entry: '/app/test.js', inject: true });
      const options = {
        entry: '/app/test.js',
        port: 3099,
        host: 'localhost',
        open: false,
        watch: false,
        interactive: false,
        inject: true,
        eval: false,
        debug: false,
        sandbox: false,
        capabilities: {
          readFiles: true,
          writeFiles: false,
          shellAccess: false,
          restart: true,
          inject: true,
          eval: false,
          debug: false
        },
        nodeArgs: [],
        appArgs: []
      } as CliOptions;

      const prompt = buildSystemPrompt(pm, options);

      expect(prompt).toContain('INJECTION MODE');
      expect(prompt).toContain('process.reflexive');
    });

    it('includes eval mode instructions', () => {
      const pm = new ProcessManager({ entry: '/app/test.js', inject: true, eval: true });
      const options = {
        entry: '/app/test.js',
        port: 3099,
        host: 'localhost',
        open: false,
        watch: false,
        interactive: false,
        inject: true,
        eval: true,
        debug: false,
        sandbox: false,
        capabilities: {
          readFiles: true,
          writeFiles: false,
          shellAccess: false,
          restart: true,
          inject: true,
          eval: true,
          debug: false
        },
        nodeArgs: [],
        appArgs: []
      } as CliOptions;

      const prompt = buildSystemPrompt(pm, options);

      expect(prompt).toContain('EVAL MODE');
      expect(prompt).toContain('evaluate_in_app');
    });

    it('includes debug mode instructions', () => {
      const pm = new ProcessManager({ entry: '/app/test.js', debug: true });
      const options = {
        entry: '/app/test.js',
        port: 3099,
        host: 'localhost',
        open: false,
        watch: false,
        interactive: false,
        inject: false,
        eval: false,
        debug: true,
        sandbox: false,
        capabilities: {
          readFiles: true,
          writeFiles: false,
          shellAccess: false,
          restart: true,
          inject: false,
          eval: false,
          debug: true
        },
        nodeArgs: [],
        appArgs: []
      } as CliOptions;

      const prompt = buildSystemPrompt(pm, options);

      expect(prompt).toContain('DEBUG MODE');
      expect(prompt).toContain('breakpoint');
    });
  });

  describe('getAllowedTools', () => {
    it('returns base tools', () => {
      const tools = getAllowedTools({
        readFiles: true,
        writeFiles: false,
        shellAccess: false,
        restart: false,
        inject: false,
        eval: false,
        debug: false
      });

      expect(tools).toContain('get_process_state');
      expect(tools).toContain('get_output_logs');
      expect(tools).toContain('search_logs');
      expect(tools).toContain('send_input');
    });

    it('includes restart tools when enabled', () => {
      const tools = getAllowedTools({
        readFiles: true,
        writeFiles: false,
        shellAccess: false,
        restart: true,
        inject: false,
        eval: false,
        debug: false
      });

      expect(tools).toContain('restart_process');
      expect(tools).toContain('stop_process');
      expect(tools).toContain('start_process');
    });

    it('includes inject tools when enabled', () => {
      const tools = getAllowedTools({
        readFiles: true,
        writeFiles: false,
        shellAccess: false,
        restart: false,
        inject: true,
        eval: false,
        debug: false
      });

      expect(tools).toContain('get_injected_state');
      expect(tools).toContain('get_injection_logs');
    });

    it('includes eval tools when enabled', () => {
      const tools = getAllowedTools({
        readFiles: true,
        writeFiles: false,
        shellAccess: false,
        restart: false,
        inject: false,
        eval: true,
        debug: false
      });

      expect(tools).toContain('evaluate_in_app');
      expect(tools).toContain('list_app_globals');
    });

    it('includes debug tools when enabled', () => {
      const tools = getAllowedTools({
        readFiles: true,
        writeFiles: false,
        shellAccess: false,
        restart: false,
        inject: false,
        eval: false,
        debug: true
      });

      expect(tools).toContain('debug_set_breakpoint');
      expect(tools).toContain('debug_remove_breakpoint');
      expect(tools).toContain('debug_list_breakpoints');
      expect(tools).toContain('debug_resume');
      expect(tools).toContain('debug_pause');
      expect(tools).toContain('debug_step_over');
      expect(tools).toContain('debug_step_into');
      expect(tools).toContain('debug_step_out');
      expect(tools).toContain('debug_get_call_stack');
      expect(tools).toContain('debug_evaluate');
      expect(tools).toContain('debug_get_scope_variables');
      expect(tools).toContain('debug_get_state');
    });

    it('includes all tools when all capabilities enabled', () => {
      const tools = getAllowedTools({
        readFiles: true,
        writeFiles: true,
        shellAccess: true,
        restart: true,
        inject: true,
        eval: true,
        debug: true
      });

      // Base tools
      expect(tools).toContain('get_process_state');
      // Restart tools
      expect(tools).toContain('restart_process');
      // Inject tools
      expect(tools).toContain('get_injected_state');
      // Eval tools
      expect(tools).toContain('evaluate_in_app');
      // Debug tools
      expect(tools).toContain('debug_set_breakpoint');
    });
  });
});
