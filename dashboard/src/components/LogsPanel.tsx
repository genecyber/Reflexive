'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { LogEntry, ProcessStatus, LogFilter } from '@/types';

interface LogsPanelProps {
  logs: LogEntry[];
  status: ProcessStatus | null;
  showControls: boolean;
  onAddWatch?: (message: string) => void;
}

const LOG_TYPE_COLORS: Record<string, string> = {
  stdout: 'text-green-500',
  info: 'text-green-500',
  stderr: 'text-red-500',
  error: 'text-red-500',
  system: 'text-blue-500',
  debug: 'text-blue-500',
  warn: 'text-yellow-500',
  'breakpoint-prompt': 'text-pink-400',
};

const FILTER_BUTTONS: { key: LogFilter; label: string; color: string }[] = [
  { key: 'stdout', label: 'stdout', color: 'border-green-500 text-green-500 bg-green-500/10' },
  { key: 'stderr', label: 'stderr', color: 'border-red-500 text-red-500 bg-red-500/10' },
  { key: 'system', label: 'system', color: 'border-blue-500 text-blue-500 bg-blue-500/10' },
  { key: 'inject', label: 'inject', color: 'border-purple-500 text-purple-500 bg-purple-500/10' },
];

export function LogsPanel({ logs, status, showControls, onAddWatch }: LogsPanelProps) {
  const [filterText, setFilterText] = useState('');
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set(['stdout', 'stderr', 'system', 'inject', 'info', 'error', 'debug', 'warn']));
  const [isPaused, setIsPaused] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Type filter
      const typeMatch = typeFilters.has(log.type) ||
        (typeFilters.has('stdout') && log.type === 'info') ||
        (typeFilters.has('stderr') && log.type === 'error');

      // Text filter
      const textMatch = !filterText ||
        log.message.toLowerCase().includes(filterText.toLowerCase());

      return typeMatch && textMatch;
    });
  }, [logs, typeFilters, filterText]);

  // Auto-scroll
  useEffect(() => {
    if (!isPaused) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, isPaused]);

  const toggleFilter = (filter: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
        // Also remove related types
        if (filter === 'stdout') next.delete('info');
        if (filter === 'stderr') next.delete('error');
      } else {
        next.add(filter);
        if (filter === 'stdout') next.add('info');
        if (filter === 'stderr') next.add('error');
      }
      return next;
    });
  };

  const clearLogs = () => {
    // This would need to call an API to clear logs
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Collapsible header */}
      <div
        className="flex items-center gap-1.5 px-3.5 py-2.5 bg-zinc-800/80 cursor-pointer select-none border-b border-zinc-800 hover:bg-zinc-800"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <span className={`text-xs transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▼</span>
        <span className="text-sm font-medium">{showControls ? 'Process Output' : 'Application Logs'}</span>
        <div className="ml-auto flex gap-1.5">
          {!isCollapsed && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); clearLogs(); }}
                className="px-2 py-0.5 text-xs text-zinc-400 border border-zinc-700 rounded hover:bg-zinc-700 hover:text-white"
                title="Clear logs"
              >
                ⌫
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsPaused(!isPaused); }}
                className={`px-2 py-0.5 text-xs border rounded ${
                  isPaused
                    ? 'text-amber-400 border-amber-500 bg-amber-500/10'
                    : 'text-zinc-400 border-zinc-700 hover:bg-zinc-700 hover:text-white'
                }`}
                title={isPaused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
              >
                {isPaused ? '▶' : '⏸'}
              </button>
            </>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950 border-b border-zinc-800">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter logs..."
              className="w-36 px-2 py-1 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-1.5 flex-wrap">
              {FILTER_BUTTONS.map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() => toggleFilter(key)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded-full border transition-opacity ${color} ${
                    typeFilters.has(key) ? 'opacity-100' : 'opacity-30 bg-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Logs list */}
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px]">
            {filteredLogs.map((log, idx) => (
              <div
                key={idx}
                className={`flex gap-2 py-0.5 px-1.5 border-b border-zinc-900 hover:bg-zinc-800/50 group ${
                  log.type === 'breakpoint-prompt' ? 'bg-pink-950/20' : ''
                }`}
              >
                <span className={`w-20 flex-shrink-0 text-right pr-2 text-[10px] ${LOG_TYPE_COLORS[log.type] || 'text-zinc-500'}`}>
                  {log.type}
                </span>
                <span className="text-zinc-400 whitespace-pre-wrap break-all flex-1">
                  {log.message}
                </span>
                {onAddWatch && (
                  <button
                    onClick={() => onAddWatch(log.message)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-blue-400 px-1"
                    title="Add watch"
                  >
                    👁
                  </button>
                )}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>

          {/* Metrics footer */}
          <div className="flex gap-4 px-3 py-2.5 bg-zinc-950 border-t border-zinc-800 text-xs">
            <div className="flex gap-1">
              <span className="text-zinc-500">PID:</span>
              <span className="text-white">{status?.pid || '--'}</span>
            </div>
            <div className="flex gap-1">
              <span className="text-zinc-500">Uptime:</span>
              <span className="text-white">{status?.uptime || 0}s</span>
            </div>
            {showControls && (
              <div className="flex gap-1">
                <span className="text-zinc-500">Restarts:</span>
                <span className="text-white">{status?.restartCount || 0}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
