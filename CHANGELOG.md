# Changelog

## [1.1.0] - 2026-02-08

### Added
- **Port exposure for sandboxes**: `SandboxConfig`, `SandboxManagerOptions`, and `create_sandbox` tool now accept a `ports` parameter (e.g., `[3000]`) to expose ports on sandbox VMs for live preview URLs.
- **`getDomain()` on SandboxManager**: Returns the public URL for an exposed port (e.g., `manager.getDomain(3000)` → `"https://abc123.vercel.app"`).
- **`getSandboxId()` on SandboxManager**: Returns the underlying Vercel Sandbox ID.
- **`getDomain(id, port)` on MultiSandboxManager**: Get preview URL for a specific sandbox by ID and port.
- **`sandbox_get_domain` MCP tool**: New hosted-mode tool that lets the AI agent query the public URL for a sandbox port.
- **`GET /api/sandboxes/:id/domain/:port` REST endpoint**: Returns the public domain/URL for an exposed port on a sandbox.

## [1.0.17] - 2025-12-XX

### Fixed
- Various stability improvements

## [1.0.13] - 2025-11-XX

### Added
- Multi-language debugging (Python, Go, .NET, Rust via DAP)
- Breakpoint prompts with AI analysis
- External MCP server discovery and dynamic enabling
- MCP server mode for Claude Code / Claude Desktop integration
- `run_app` tool for dynamic app switching
- Watch triggers for log pattern matching
