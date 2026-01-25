/**
 * Reflexive Configuration File
 *
 * Copy this file to reflexive.config.js and customize for your project.
 * Configuration can also be provided via:
 *   - reflexive.config.mjs (ES modules)
 *   - reflexive.config.json
 *   - .reflexiverc
 *   - .reflexiverc.json
 *
 * CLI flags always take precedence over config file settings.
 */

export default {
  /**
   * Operating mode:
   *   - 'local'   - Run app as child process (default)
   *   - 'sandbox' - Run in Vercel Sandbox (isolated)
   *   - 'hosted'  - Multi-tenant hosted mode (production)
   */
  mode: 'local',

  /**
   * Dashboard server port (default: 3099)
   */
  port: 3099,

  /**
   * Capability flags control what the AI agent can do.
   * All are opt-in for safety, except readFiles and restart.
   */
  capabilities: {
    // Read project files (default: true)
    readFiles: true,

    // Write/edit files (default: false, enable with --write)
    writeFiles: false,

    // Execute shell commands (default: false, enable with --shell)
    shellAccess: false,

    // Restart the process (default: true)
    restart: true,

    // Deep console/diagnostics injection (enable with --inject)
    inject: false,

    // Runtime code evaluation (enable with --eval, DANGEROUS)
    eval: false,

    // V8 Inspector debugging (enable with --debug)
    debug: false,
  },

  /**
   * Sandbox mode configuration
   * Only used when mode: 'sandbox'
   */
  sandbox: {
    // Sandbox provider (currently only 'vercel' is supported)
    provider: 'vercel',

    // Number of virtual CPUs (1-4)
    vcpus: 2,

    // Memory in MB (128-8192)
    memory: 2048,

    // Maximum sandbox lifetime (e.g., '30m', '1h', or milliseconds)
    timeout: '30m',

    // Node.js runtime version
    runtime: 'node22',
  },

  /**
   * Hosted mode configuration
   * Only used when mode: 'hosted' (multi-tenant production deployment)
   */
  hosted: {
    // Maximum concurrent sandboxes per instance
    maxSandboxes: 10,

    // Default sandbox timeout
    defaultTimeout: '30m',

    // Snapshot storage configuration
    snapshotStorage: {
      // Storage provider: 's3', 'r2', or 'memory'
      provider: 's3',

      // S3/R2 bucket name (required for s3/r2)
      bucket: process.env.REFLEXIVE_SNAPSHOT_BUCKET || 'reflexive-snapshots',

      // Custom S3-compatible endpoint (for R2, MinIO, etc.)
      // endpoint: process.env.REFLEXIVE_S3_ENDPOINT,
    },
  },

  /**
   * Custom MCP tools to register with the AI agent.
   * Tools must follow the MCP tool schema format with Zod validation.
   *
   * @example
   * tools: [
   *   {
   *     name: 'get_user_count',
   *     description: 'Get the current number of active users',
   *     schema: { type: 'object', properties: {} },
   *     handler: async () => ({
   *       content: [{ type: 'text', text: `Active users: ${getActiveUserCount()}` }]
   *     })
   *   }
   * ]
   */
  tools: [],
};
