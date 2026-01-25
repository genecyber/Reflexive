import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  textResult,
  jsonResult,
  errorResult,
  createTool,
  combineTools,
  filterTools,
  createLibraryTools,
  z
} from '../../mcp/tools.js';
import { AppState } from '../../core/app-state.js';

describe('mcp/tools', () => {
  describe('textResult', () => {
    it('creates text result', () => {
      const result = textResult('Hello');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Hello');
    });
  });

  describe('jsonResult', () => {
    it('creates JSON result', () => {
      const result = jsonResult({ test: true });
      expect(result.content[0].text).toBe('{\n  "test": true\n}');
    });

    it('handles arrays', () => {
      const result = jsonResult([1, 2, 3]);
      expect(result.content[0].text).toContain('[');
    });
  });

  describe('errorResult', () => {
    it('creates error result with isError flag', () => {
      const result = errorResult('Something went wrong');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Something went wrong');
    });
  });

  describe('createTool', () => {
    it('creates tool with correct structure', () => {
      const tool = createTool(
        'test_tool',
        'A test tool',
        { value: z.string() },
        async ({ value }) => textResult(value)
      );

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeInstanceOf(Function);
    });

    it('validates input with zod', async () => {
      const tool = createTool(
        'test',
        'Test',
        { count: z.number().min(1) },
        async () => textResult('ok')
      );

      const parseResult = tool.inputSchema.safeParse({ count: 0 });
      expect(parseResult.success).toBe(false);
    });

    it('handler receives parsed input', async () => {
      const handler = vi.fn(async () => textResult('ok'));
      const tool = createTool(
        'test',
        'Test',
        { value: z.string() },
        handler
      );

      await tool.handler({ value: 'test' });
      expect(handler).toHaveBeenCalledWith({ value: 'test' });
    });
  });

  describe('combineTools', () => {
    it('combines multiple tool arrays', () => {
      const tools1 = [createTool('a', 'A', {}, async () => textResult('a'))];
      const tools2 = [createTool('b', 'B', {}, async () => textResult('b'))];
      const tools3 = [createTool('c', 'C', {}, async () => textResult('c'))];

      const combined = combineTools(tools1, tools2, tools3);

      expect(combined).toHaveLength(3);
      expect(combined.map(t => t.name)).toEqual(['a', 'b', 'c']);
    });

    it('handles empty arrays', () => {
      const combined = combineTools([], [], []);
      expect(combined).toHaveLength(0);
    });
  });

  describe('filterTools', () => {
    const tools = [
      createTool('get_logs', 'Get logs', {}, async () => textResult('')),
      createTool('get_status', 'Get status', {}, async () => textResult('')),
      createTool('restart', 'Restart', {}, async () => textResult(''))
    ];

    it('filters by include list', () => {
      const filtered = filterTools(tools, ['get_logs', 'get_status']);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.name)).toEqual(['get_logs', 'get_status']);
    });

    it('filters by exclude list', () => {
      const filtered = filterTools(tools, undefined, ['restart']);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.name)).toEqual(['get_logs', 'get_status']);
    });

    it('combines include and exclude', () => {
      const filtered = filterTools(tools, ['get_logs', 'restart'], ['restart']);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('get_logs');
    });

    it('returns all tools when no filters', () => {
      const filtered = filterTools(tools);
      expect(filtered).toHaveLength(3);
    });
  });

  describe('createLibraryTools', () => {
    let appState: AppState;

    beforeEach(() => {
      appState = new AppState();
    });

    it('creates library tools', () => {
      const tools = createLibraryTools(appState);

      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('get_app_status');
      expect(toolNames).toContain('get_logs');
      expect(toolNames).toContain('search_logs');
      expect(toolNames).toContain('get_custom_state');
    });

    describe('get_app_status', () => {
      it('returns application status', async () => {
        const tools = createLibraryTools(appState);
        const tool = tools.find(t => t.name === 'get_app_status')!;

        const result = await tool.handler({});
        const data = JSON.parse(result.content[0].text!);

        expect(data.pid).toBe(process.pid);
        expect(data.uptime).toBeGreaterThanOrEqual(0);
        expect(data.memory).toBeDefined();
      });
    });

    describe('get_logs', () => {
      it('returns logs', async () => {
        appState.log('info', 'test message');

        const tools = createLibraryTools(appState);
        const tool = tools.find(t => t.name === 'get_logs')!;

        const result = await tool.handler({});
        const logs = JSON.parse(result.content[0].text!);

        expect(logs).toHaveLength(1);
        expect(logs[0].message).toBe('test message');
      });

      it('filters by type', async () => {
        appState.log('info', 'info message');
        appState.log('error', 'error message');

        const tools = createLibraryTools(appState);
        const tool = tools.find(t => t.name === 'get_logs')!;

        const result = await tool.handler({ type: 'error' });
        const logs = JSON.parse(result.content[0].text!);

        expect(logs).toHaveLength(1);
        expect(logs[0].type).toBe('error');
      });

      it('limits count', async () => {
        for (let i = 0; i < 10; i++) {
          appState.log('info', `message ${i}`);
        }

        const tools = createLibraryTools(appState);
        const tool = tools.find(t => t.name === 'get_logs')!;

        const result = await tool.handler({ count: 3 });
        const logs = JSON.parse(result.content[0].text!);

        expect(logs).toHaveLength(3);
      });
    });

    describe('search_logs', () => {
      it('searches logs', async () => {
        appState.log('info', 'hello world');
        appState.log('info', 'goodbye world');
        appState.log('info', 'hello again');

        const tools = createLibraryTools(appState);
        const tool = tools.find(t => t.name === 'search_logs')!;

        const result = await tool.handler({ query: 'hello' });
        const logs = JSON.parse(result.content[0].text!);

        expect(logs).toHaveLength(2);
      });
    });

    describe('get_custom_state', () => {
      it('returns all state', async () => {
        appState.setState('key1', 'value1');
        appState.setState('key2', 'value2');

        const tools = createLibraryTools(appState);
        const tool = tools.find(t => t.name === 'get_custom_state')!;

        const result = await tool.handler({});
        const state = JSON.parse(result.content[0].text!);

        expect(state).toEqual({ key1: 'value1', key2: 'value2' });
      });

      it('returns specific key', async () => {
        appState.setState('target', { nested: true });

        const tools = createLibraryTools(appState);
        const tool = tools.find(t => t.name === 'get_custom_state')!;

        const result = await tool.handler({ key: 'target' });
        const state = JSON.parse(result.content[0].text!);

        expect(state).toEqual({ nested: true });
      });
    });
  });
});
