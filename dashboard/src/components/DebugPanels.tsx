'use client';

import { useState } from 'react';
import type { Capabilities, Watch, Breakpoint, DebuggerStatus } from '@/types';

interface DebugPanelsProps {
  capabilities: Capabilities;
  watches: Watch[];
  breakpoints: Breakpoint[];
  debuggerStatus: DebuggerStatus | null;
  showDebug: boolean;
  onEditWatch: (watch: Watch) => void;
  onDeleteWatch: (id: number) => void;
  onToggleWatch: (id: number, enabled: boolean) => void;
  onEditBreakpointPrompt: (breakpoint: Breakpoint) => void;
  onDeleteBreakpoint: (id: string) => void;
  onToggleBreakpoint: (id: string, enabled: boolean) => void;
  onDebuggerResume: () => void;
  onDebuggerStepOver: () => void;
  onDebuggerStepInto: () => void;
  onDebuggerStepOut: () => void;
}

export function DebugPanels({
  capabilities,
  watches,
  breakpoints,
  debuggerStatus,
  showDebug,
  onEditWatch,
  onDeleteWatch,
  onToggleWatch,
  onEditBreakpointPrompt,
  onDeleteBreakpoint,
  onToggleBreakpoint,
  onDebuggerResume,
  onDebuggerStepOver,
  onDebuggerStepInto,
  onDebuggerStepOut,
}: DebugPanelsProps) {
  const [permissionsCollapsed, setPermissionsCollapsed] = useState(false);
  const [watchCollapsed, setWatchCollapsed] = useState(false);
  const [debuggerCollapsed, setDebuggerCollapsed] = useState(false);

  const isPaused = debuggerStatus?.connected && debuggerStatus?.paused;

  return (
    <div className="flex flex-col border-t border-zinc-800">
      {/* Permissions Section */}
      <DebugSection
        title="Permissions"
        collapsed={permissionsCollapsed}
        onToggle={() => setPermissionsCollapsed(!permissionsCollapsed)}
      >
        <div className="grid grid-cols-2 gap-1 p-2">
          <PermissionItem label="Read Files" enabled={capabilities.readFiles} />
          <PermissionItem label="Write Files" enabled={capabilities.writeFiles} />
          <PermissionItem label="Shell Access" enabled={capabilities.shellAccess} />
          <PermissionItem label="Restart Process" enabled={capabilities.restart} />
          <PermissionItem label="Network Access" enabled={capabilities.networkAccess} />
          <PermissionItem label="Injection" enabled={capabilities.inject} />
          <PermissionItem label="Eval" enabled={capabilities.eval} />
          <PermissionItem label="V8 Debugging" enabled={capabilities.debug} />
        </div>
      </DebugSection>

      {/* Watch Section */}
      <DebugSection
        title="Watch"
        count={watches.filter(w => w.enabled).length}
        collapsed={watchCollapsed}
        onToggle={() => setWatchCollapsed(!watchCollapsed)}
      >
        {watches.length === 0 ? (
          <div className="p-3 text-center text-xs text-zinc-600">
            No watches. Click 👁 on a log entry to add one.
          </div>
        ) : (
          <div className="max-h-28 overflow-y-auto">
            {watches.map((watch) => (
              <div
                key={watch.id}
                className={`flex items-center gap-2 px-3 py-1 text-xs border-b border-zinc-900 hover:bg-zinc-800/50 ${
                  watch.enabled ? '' : 'opacity-40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={watch.enabled}
                  onChange={(e) => onToggleWatch(watch.id, e.target.checked)}
                  className="w-3 h-3 accent-blue-500"
                />
                <span className={`flex-1 font-mono truncate ${!watch.enabled ? 'line-through' : ''}`} title={watch.pattern}>
                  {watch.pattern.slice(0, 40)}{watch.pattern.length > 40 ? '...' : ''}
                </span>
                <span className="text-zinc-600 text-[10px]">{watch.hitCount} hits</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onEditWatch(watch)}
                    className="text-zinc-500 hover:text-white"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onDeleteWatch(watch.id)}
                    className="text-zinc-500 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DebugSection>

      {/* V8 Debugger Section */}
      {showDebug && (
        <DebugSection
          title="V8 Debugger"
          badge={
            <DebuggerBadge
              enabled={debuggerStatus?.enabled ?? false}
              connected={debuggerStatus?.connected ?? false}
              paused={debuggerStatus?.paused ?? false}
            />
          }
          controls={
            <div className="flex gap-1">
              <button
                onClick={onDebuggerStepOver}
                disabled={!isPaused}
                className="px-2 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Step
              </button>
              <button
                onClick={onDebuggerStepInto}
                disabled={!isPaused}
                className="px-2 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Into
              </button>
              <button
                onClick={onDebuggerStepOut}
                disabled={!isPaused}
                className="px-2 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Out
              </button>
              <button
                onClick={onDebuggerResume}
                disabled={!isPaused}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  isPaused
                    ? 'bg-red-900/50 border border-red-700 text-red-400 animate-pulse'
                    : 'bg-green-900/30 border border-green-800 text-green-500'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                ▶
              </button>
            </div>
          }
          collapsed={debuggerCollapsed}
          onToggle={() => setDebuggerCollapsed(!debuggerCollapsed)}
        >
          {!debuggerStatus?.connected ? (
            <div className="p-3 text-center text-xs text-zinc-600">
              Waiting for debugger connection...
            </div>
          ) : breakpoints.length === 0 ? (
            <div className="p-3 text-center text-xs text-zinc-600">
              Connected. Set breakpoints via chat.
            </div>
          ) : (
            <div className="max-h-28 overflow-y-auto">
              {breakpoints.map((bp) => (
                <div
                  key={bp.id}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs border-b border-zinc-900 hover:bg-zinc-800/50 group"
                >
                  <input
                    type="checkbox"
                    checked={bp.enabled}
                    onChange={(e) => onToggleBreakpoint(bp.id, e.target.checked)}
                    className="w-3 h-3 accent-blue-500"
                  />
                  <span className="flex-1 font-mono text-[11px]">
                    {bp.file.split('/').pop()}:{bp.line}
                  </span>
                  {bp.hitCount > 0 && (
                    <span className="text-zinc-600 text-[10px]">{bp.hitCount}</span>
                  )}
                  <button
                    onClick={() => onEditBreakpointPrompt(bp)}
                    className={`text-xs ${bp.prompt ? 'text-blue-400' : 'opacity-50 group-hover:opacity-100 text-zinc-500'}`}
                    title={bp.prompt ? 'Edit prompt' : 'Add prompt'}
                  >
                    💬
                  </button>
                  {bp.prompt && (
                    <input
                      type="checkbox"
                      checked={bp.promptEnabled}
                      onChange={(e) => onToggleBreakpoint(bp.id, bp.enabled)} // Should update promptEnabled
                      className="w-3 h-3 accent-blue-500"
                      title="Enable prompt on hit"
                    />
                  )}
                  <button
                    onClick={() => onDeleteBreakpoint(bp.id)}
                    className="opacity-50 group-hover:opacity-100 text-zinc-500 hover:text-red-500"
                  >
                    ×
                  </button>
                </div>
              ))}

              {/* Call Stack when paused */}
              {debuggerStatus?.paused && debuggerStatus.callStack && debuggerStatus.callStack.length > 0 && (
                <div className="border-t border-zinc-800 mt-1 pt-1">
                  <div className="px-3 py-1 text-[10px] text-zinc-500">Call Stack:</div>
                  {debuggerStatus.callStack.slice(0, 5).map((frame, i) => (
                    <div key={i} className="flex gap-1 px-3 py-0.5 text-[10px] font-mono">
                      <span className="text-zinc-600">#{i}</span>
                      <span className="text-zinc-400">
                        {frame.functionName || '(anonymous)'} at {frame.url.split('/').pop()}:{frame.lineNumber}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DebugSection>
      )}
    </div>
  );
}

interface DebugSectionProps {
  title: string;
  count?: number;
  badge?: React.ReactNode;
  controls?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function DebugSection({ title, count, badge, controls, collapsed, onToggle, children }: DebugSectionProps) {
  return (
    <div className="border-b border-zinc-900">
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950 cursor-pointer select-none hover:text-white text-zinc-400"
        onClick={onToggle}
      >
        <span className={`text-[10px] transition-transform ${collapsed ? '-rotate-90' : ''}`}>▼</span>
        <span className="text-xs">{title}</span>
        {count !== undefined && (
          <span className="ml-auto px-1.5 py-0.5 text-[10px] bg-zinc-800 rounded-full">{count}</span>
        )}
        {badge}
        {controls && <div className="ml-auto" onClick={(e) => e.stopPropagation()}>{controls}</div>}
      </div>
      {!collapsed && <div className="bg-zinc-900">{children}</div>}
    </div>
  );
}

interface PermissionItemProps {
  label: string;
  enabled: boolean;
}

function PermissionItem({ label, enabled }: PermissionItemProps) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] bg-zinc-900 ${enabled ? 'text-green-400' : 'text-zinc-600 opacity-70'}`}>
      <span className={enabled ? 'text-green-400' : 'text-red-500'}>{enabled ? '✓' : '✗'}</span>
      <span>{label}</span>
    </div>
  );
}

interface DebuggerBadgeProps {
  enabled: boolean;
  connected: boolean;
  paused: boolean;
}

function DebuggerBadge({ enabled, connected, paused }: DebuggerBadgeProps) {
  if (!enabled) {
    return <span className="ml-auto px-1.5 py-0.5 text-[10px] bg-zinc-700 rounded">disabled</span>;
  }
  if (!connected) {
    return <span className="ml-auto px-1.5 py-0.5 text-[10px] bg-amber-900 rounded">waiting</span>;
  }
  if (paused) {
    return <span className="ml-auto px-1.5 py-0.5 text-[10px] bg-red-600 rounded animate-pulse">PAUSED</span>;
  }
  return <span className="ml-auto px-1.5 py-0.5 text-[10px] bg-green-900 rounded">running</span>;
}
