import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  findConfigFile,
  loadConfigFile,
  mergeConfigs,
  loadConfig,
  validateConfig,
  getDefaultCapabilities,
  getDefaultConfig
} from '../../core/config-loader.js';
import type { ReflexiveConfig } from '../../types/index.js';

describe('config-loader', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `reflexive-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('findConfigFile', () => {
    it('finds reflexive.config.json', () => {
      const configPath = join(testDir, 'reflexive.config.json');
      writeFileSync(configPath, '{}');

      const found = findConfigFile(testDir);
      expect(found).toBe(configPath);
    });

    it('finds .reflexiverc', () => {
      const configPath = join(testDir, '.reflexiverc');
      writeFileSync(configPath, '{}');

      const found = findConfigFile(testDir);
      expect(found).toBe(configPath);
    });

    it('returns null when no config found', () => {
      const found = findConfigFile(testDir);
      expect(found).toBeNull();
    });

    it('prioritizes earlier config names', () => {
      writeFileSync(join(testDir, '.reflexiverc'), '{}');
      writeFileSync(join(testDir, 'reflexive.config.json'), '{}');

      const found = findConfigFile(testDir);
      expect(found).toContain('reflexive.config.json');
    });
  });

  describe('loadConfigFile', () => {
    it('loads JSON config', async () => {
      const configPath = join(testDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({ port: 4000 }));

      const config = await loadConfigFile(configPath);
      expect(config.port).toBe(4000);
    });

    it('throws for missing file', async () => {
      await expect(loadConfigFile('/nonexistent/path')).rejects.toThrow('Config file not found');
    });

    it('throws for unsupported format', async () => {
      const configPath = join(testDir, 'config.yaml');
      writeFileSync(configPath, 'port: 4000');

      await expect(loadConfigFile(configPath)).rejects.toThrow('Unsupported config file format');
    });
  });

  describe('mergeConfigs', () => {
    it('merges basic properties', () => {
      const base = getDefaultConfig();
      const overrides = { port: 5000 };

      const merged = mergeConfigs(base, overrides);
      expect(merged.port).toBe(5000);
      expect(merged.mode).toBe('local');
    });

    it('merges capabilities deeply', () => {
      const base = getDefaultConfig();
      const overrides = {
        capabilities: { writeFiles: true }
      };

      const merged = mergeConfigs(base, overrides);
      expect(merged.capabilities.writeFiles).toBe(true);
      expect(merged.capabilities.readFiles).toBe(true); // Preserved from base
    });

    it('preserves base when no override', () => {
      const base = getDefaultConfig();
      const merged = mergeConfigs(base, {});

      // Merge always adds some properties (tools array, sandbox/hosted undefined)
      expect(merged.mode).toEqual(base.mode);
      expect(merged.port).toEqual(base.port);
      expect(merged.capabilities).toEqual(base.capabilities);
    });

    it('merges sandbox config', () => {
      const base = getDefaultConfig();
      base.sandbox = {
        provider: 'vercel',
        vcpus: 1,
        memory: 1024,
        timeout: '10m',
        runtime: 'node20'
      };

      const overrides = {
        sandbox: { vcpus: 4 }
      };

      const merged = mergeConfigs(base, overrides as Partial<ReflexiveConfig>);
      expect(merged.sandbox?.vcpus).toBe(4);
      expect(merged.sandbox?.memory).toBe(1024);
    });

    it('concatenates tools arrays', () => {
      const base = getDefaultConfig();
      base.tools = [{ name: 'tool1', description: '', schema: {}, handler: async () => ({ content: [] }) }];

      const overrides = {
        tools: [{ name: 'tool2', description: '', schema: {}, handler: async () => ({ content: [] }) }]
      };

      const merged = mergeConfigs(base, overrides);
      expect(merged.tools).toHaveLength(2);
    });
  });

  describe('loadConfig', () => {
    it('returns default config when no file found', async () => {
      const config = await loadConfig({ cwd: testDir });
      expect(config.port).toBe(3099);
      expect(config.mode).toBe('local');
    });

    it('loads config from explicit path', async () => {
      const configPath = join(testDir, 'custom.json');
      writeFileSync(configPath, JSON.stringify({ port: 6000 }));

      const config = await loadConfig({ configPath });
      expect(config.port).toBe(6000);
    });

    it('auto-discovers config file', async () => {
      writeFileSync(join(testDir, 'reflexive.config.json'), JSON.stringify({ port: 7000 }));

      const config = await loadConfig({ cwd: testDir });
      expect(config.port).toBe(7000);
    });
  });

  describe('validateConfig', () => {
    it('validates correct config', () => {
      const config = getDefaultConfig();
      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('catches invalid mode', () => {
      const config = { ...getDefaultConfig(), mode: 'invalid' as 'local' };
      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid mode');
    });

    it('catches invalid port', () => {
      const config = { ...getDefaultConfig(), port: -1 };
      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid port');
    });

    it('catches missing sandbox config for sandbox mode', () => {
      const config = { ...getDefaultConfig(), mode: 'sandbox' as const };
      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Sandbox mode requires sandbox configuration');
    });

    it('catches missing hosted config for hosted mode', () => {
      const config = { ...getDefaultConfig(), mode: 'hosted' as const };
      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Hosted mode requires hosted configuration');
    });

    it('validates sandbox configuration', () => {
      const config: ReflexiveConfig = {
        ...getDefaultConfig(),
        mode: 'sandbox',
        sandbox: {
          provider: 'invalid' as 'vercel',
          vcpus: 2,
          memory: 2048,
          timeout: '30m',
          runtime: 'node22'
        }
      };
      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid sandbox provider'))).toBe(true);
    });
  });

  describe('getDefaultCapabilities', () => {
    it('returns a copy of default capabilities', () => {
      const caps1 = getDefaultCapabilities();
      const caps2 = getDefaultCapabilities();

      expect(caps1).toEqual(caps2);
      expect(caps1).not.toBe(caps2); // Different objects
    });

    it('has correct defaults', () => {
      const caps = getDefaultCapabilities();

      expect(caps.readFiles).toBe(true);
      expect(caps.writeFiles).toBe(false);
      expect(caps.shellAccess).toBe(false);
      expect(caps.restart).toBe(true);
      expect(caps.inject).toBe(false);
      expect(caps.eval).toBe(false);
      expect(caps.debug).toBe(false);
    });
  });

  describe('getDefaultConfig', () => {
    it('returns a copy of default config', () => {
      const config1 = getDefaultConfig();
      const config2 = getDefaultConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
      expect(config1.capabilities).not.toBe(config2.capabilities);
    });

    it('has correct defaults', () => {
      const config = getDefaultConfig();

      expect(config.mode).toBe('local');
      expect(config.port).toBe(3099);
      expect(config.sandbox).toBeUndefined();
      expect(config.hosted).toBeUndefined();
    });
  });
});
