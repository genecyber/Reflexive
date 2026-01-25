/**
 * Test configuration fixtures
 */

import type { ReflexiveConfig, Capabilities, SandboxConfig, HostedConfig, StorageConfig } from '../../types/index.js';

export const defaultCapabilities: Capabilities = {
  readFiles: true,
  writeFiles: false,
  shellAccess: false,
  restart: true,
  inject: false,
  eval: false,
  debug: false
};

export const fullCapabilities: Capabilities = {
  readFiles: true,
  writeFiles: true,
  shellAccess: true,
  restart: true,
  inject: true,
  eval: true,
  debug: true
};

export const defaultSandboxConfig: SandboxConfig = {
  provider: 'vercel',
  vcpus: 2,
  memory: 2048,
  timeout: '30m',
  runtime: 'node22'
};

export const defaultStorageConfig: StorageConfig = {
  provider: 'memory'
};

export const defaultHostedConfig: HostedConfig = {
  maxSandboxes: 10,
  defaultTimeout: '1h',
  snapshotStorage: defaultStorageConfig
};

export const defaultLocalConfig: ReflexiveConfig = {
  mode: 'local',
  port: 3099,
  capabilities: defaultCapabilities
};

export const defaultSandboxModeConfig: ReflexiveConfig = {
  mode: 'sandbox',
  port: 3099,
  sandbox: defaultSandboxConfig,
  capabilities: defaultCapabilities
};

export const defaultHostedModeConfig: ReflexiveConfig = {
  mode: 'hosted',
  port: 3099,
  sandbox: defaultSandboxConfig,
  hosted: defaultHostedConfig,
  capabilities: defaultCapabilities
};

/**
 * Creates a test config with custom overrides
 */
export function createTestConfig(overrides: Partial<ReflexiveConfig> = {}): ReflexiveConfig {
  return {
    ...defaultLocalConfig,
    ...overrides,
    capabilities: {
      ...defaultCapabilities,
      ...overrides.capabilities
    }
  };
}
