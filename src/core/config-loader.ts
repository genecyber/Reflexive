/**
 * Configuration loader for Reflexive
 *
 * Loads configuration from files and merges with CLI options
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { ReflexiveConfig, Capabilities, SandboxConfig, HostedConfig } from '../types/index.js';

export interface ConfigLoaderOptions {
  configPath?: string;
  cwd?: string;
}

const DEFAULT_CONFIG_NAMES = [
  'reflexive.config.js',
  'reflexive.config.mjs',
  'reflexive.config.json',
  '.reflexiverc',
  '.reflexiverc.json'
];

const DEFAULT_CAPABILITIES: Capabilities = {
  readFiles: true,
  writeFiles: false,
  shellAccess: false,
  restart: true,
  inject: false,
  eval: false,
  debug: false
};

const DEFAULT_CONFIG: ReflexiveConfig = {
  mode: 'local',
  port: 3099,
  capabilities: DEFAULT_CAPABILITIES
};

/**
 * Find a config file in the given directory
 */
export function findConfigFile(cwd: string = process.cwd()): string | null {
  for (const name of DEFAULT_CONFIG_NAMES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

/**
 * Load and parse a config file
 */
export async function loadConfigFile(path: string): Promise<Partial<ReflexiveConfig>> {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }

  const ext = path.split('.').pop()?.toLowerCase();

  if (ext === 'json' || path.endsWith('rc')) {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as Partial<ReflexiveConfig>;
  }

  if (ext === 'js' || ext === 'mjs') {
    const module = await import(path);
    return module.default || module;
  }

  throw new Error(`Unsupported config file format: ${ext}`);
}

/**
 * Merge two config objects, with overrides taking precedence
 */
export function mergeConfigs(
  base: ReflexiveConfig,
  overrides: Partial<ReflexiveConfig>
): ReflexiveConfig {
  return {
    ...base,
    ...overrides,
    capabilities: {
      ...base.capabilities,
      ...overrides.capabilities
    },
    sandbox: overrides.sandbox ? {
      ...(base.sandbox || {} as SandboxConfig),
      ...overrides.sandbox
    } : base.sandbox,
    hosted: overrides.hosted ? {
      ...(base.hosted || {} as HostedConfig),
      ...overrides.hosted
    } : base.hosted,
    tools: [
      ...(base.tools || []),
      ...(overrides.tools || [])
    ]
  };
}

/**
 * Load configuration with fallbacks
 *
 * Priority:
 * 1. Explicit config path
 * 2. Auto-discovered config file
 * 3. Default config
 */
export async function loadConfig(options: ConfigLoaderOptions = {}): Promise<ReflexiveConfig> {
  const { configPath, cwd = process.cwd() } = options;

  let fileConfig: Partial<ReflexiveConfig> = {};

  if (configPath) {
    fileConfig = await loadConfigFile(configPath);
  } else {
    const foundPath = findConfigFile(cwd);
    if (foundPath) {
      try {
        fileConfig = await loadConfigFile(foundPath);
      } catch (error) {
        console.warn(`Warning: Failed to load config from ${foundPath}:`, error);
      }
    }
  }

  return mergeConfigs(DEFAULT_CONFIG, fileConfig);
}

/**
 * Validate a config object
 */
export function validateConfig(config: ReflexiveConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!['local', 'sandbox', 'hosted'].includes(config.mode)) {
    errors.push(`Invalid mode: ${config.mode}. Must be 'local', 'sandbox', or 'hosted'`);
  }

  if (typeof config.port !== 'number' || config.port < 0 || config.port > 65535) {
    errors.push(`Invalid port: ${config.port}. Must be a number between 0 and 65535`);
  }

  if (config.mode === 'sandbox' && !config.sandbox) {
    errors.push('Sandbox mode requires sandbox configuration');
  }

  if (config.mode === 'hosted' && !config.hosted) {
    errors.push('Hosted mode requires hosted configuration');
  }

  if (config.sandbox) {
    if (config.sandbox.provider !== 'vercel') {
      errors.push(`Invalid sandbox provider: ${config.sandbox.provider}. Only 'vercel' is supported`);
    }
    if (typeof config.sandbox.vcpus !== 'number' || config.sandbox.vcpus < 1) {
      errors.push(`Invalid vcpus: ${config.sandbox.vcpus}. Must be a positive number`);
    }
    if (typeof config.sandbox.memory !== 'number' || config.sandbox.memory < 128) {
      errors.push(`Invalid memory: ${config.sandbox.memory}. Must be at least 128 MB`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get default capabilities
 */
export function getDefaultCapabilities(): Capabilities {
  return { ...DEFAULT_CAPABILITIES };
}

/**
 * Get default config
 */
export function getDefaultConfig(): ReflexiveConfig {
  return { ...DEFAULT_CONFIG, capabilities: { ...DEFAULT_CAPABILITIES } };
}
