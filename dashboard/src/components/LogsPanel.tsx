'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { LogEntry, ProcessStatus, LogFilter, Watch } from '@/types';

interface LogsPanelProps {
  logs: LogEntry[];
  status: ProcessStatus | null;
  showControls: boolean;
  debugPanelsHeight?: number;
  watches?: Watch[];  // For visual feedback on watched logs
  onAddWatch?: (message: string) => void;
  onEditWatch?: (watch: Watch) => void;  // For editing existing watches
  onClearLogs?: () => void;
  onResize?: (height: number) => void;
}

const INJECT_COLOR_PALETTE = [
  'border-purple-500 text-purple-500 bg-purple-500/10',
  'border-pink-500 text-pink-500 bg-pink-500/10',
  'border-orange-500 text-orange-500 bg-orange-500/10',
  'border-sky-500 text-sky-500 bg-sky-500/10',
  'border-emerald-500 text-emerald-500 bg-emerald-500/10',
  'border-yellow-500 text-yellow-500 bg-yellow-500/10',
  'border-violet-500 text-violet-500 bg-violet-500/10',
  'border-cyan-500 text-cyan-500 bg-cyan-500/10',
  'border-rose-500 text-rose-500 bg-rose-500/10',
  'border-lime-500 text-lime-500 bg-lime-500/10',
];

// Map palette colors to text-only colors for log display
const INJECT_TEXT_COLORS: Record<string, string> = {
  'border-purple-500 text-purple-500 bg-purple-500/10': 'text-purple-500',
  'border-pink-500 text-pink-500 bg-pink-500/10': 'text-pink-500',
  'border-orange-500 text-orange-500 bg-orange-500/10': 'text-orange-500',
  'border-sky-500 text-sky-500 bg-sky-500/10': 'text-sky-500',
  'border-emerald-500 text-emerald-500 bg-emerald-500/10': 'text-emerald-500',
  'border-yellow-500 text-yellow-500 bg-yellow-500/10': 'text-yellow-500',
  'border-violet-500 text-violet-500 bg-violet-500/10': 'text-violet-500',
  'border-cyan-500 text-cyan-500 bg-cyan-500/10': 'text-cyan-500',
  'border-rose-500 text-rose-500 bg-rose-500/10': 'text-rose-500',
  'border-lime-500 text-lime-500 bg-lime-500/10': 'text-lime-500',
};

// Format uptime for display (handles hours, minutes, seconds)
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h${mins > 0 ? mins : ''}`;
}

// Get color based on memory usage percentage
function getMemoryColor(ratio: number): string {
  if (ratio < 0.5) return '#22c55e'; // green
  if (ratio < 0.75) return '#eab308'; // yellow
  if (ratio < 0.9) return '#f97316'; // orange
  return '#ef4444'; // red
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

const LOG_TYPE_DESCRIPTIONS: Record<string, string> = {
  stdout: 'Standard output from your application',
  info: 'Standard output from your application',
  stderr: 'Standard error output from your application',
  error: 'Standard error output from your application',
  system: 'Reflexive system messages (start, stop, errors)',
  debug: 'Reflexive system messages (start, stop, errors)',
  warn: 'Warning messages from your application',
  inject: 'Instrumentation logs from injected code',
  'breakpoint-prompt': 'Interactive breakpoint prompt',
};

// Convert ANSI escape codes to HTML spans with inline HTML escaping
// Matches the original JS implementation exactly - processes ANSI codes and escapes HTML inline
function ansiToHtml(text: string): string {
  const ansiColors: Record<string, string> = {
    '30': '#000', '31': '#ef4444', '32': '#22c55e', '33': '#eab308',
    '34': '#3b82f6', '35': '#a855f7', '36': '#06b6d4', '37': '#e5e5e5',
    '90': '#737373', '91': '#fca5a5', '92': '#86efac', '93': '#fde047',
    '94': '#93c5fd', '95': '#d8b4fe', '96': '#67e8f9', '97': '#fff'
  };

  const ESC = String.fromCharCode(27);
  let result = '';
  let openSpans = 0;
  let i = 0;

  while (i < text.length) {
    // Check for ANSI escape sequence: ESC[...m
    if (text[i] === ESC && text[i + 1] === '[') {
      // Find the end of the sequence (the 'm' character)
      let j = i + 2;
      while (j < text.length && /[0-9;]/.test(text[j])) {
        j++;
      }

      if (text[j] === 'm') {
        const codes = text.slice(i + 2, j);

        if (!codes || codes === '0' || codes === '22' || codes === '39') {
          // Reset - close open span
          if (openSpans > 0) {
            result += '</span>';
            openSpans--;
          }
        } else {
          const parts = codes.split(';');
          let style = '';

          for (const code of parts) {
            if (code === '1') style += 'font-weight:bold;';
            else if (code === '3') style += 'font-style:italic;';
            else if (code === '4') style += 'text-decoration:underline;';
            else if (ansiColors[code]) style += 'color:' + ansiColors[code] + ';';
          }

          if (style) {
            result += '<span style="' + style + '">';
            openSpans++;
          }
        }

        i = j + 1;
        continue;
      }
    }

    // Escape HTML chars inline (exactly like original)
    const c = text[i];
    if (c === '<') result += '&lt;';
    else if (c === '>') result += '&gt;';
    else if (c === '&') result += '&amp;';
    else result += c;
    i++;
  }

  // Close any remaining open spans
  while (openSpans > 0) {
    result += '</span>';
    openSpans--;
  }

  // Convert URLs to clickable links (like original)
  result = result.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-blue-400 underline hover:text-blue-300">$1</a>');

  return result;
}

// Process log message using the combined ANSI/HTML/URL processor
function processLogMessage(message: string): string {
  return ansiToHtml(message);
}

const FILTER_BUTTONS: { key: LogFilter; label: string; color: string; description: string }[] = [
  { key: 'stdout', label: 'stdout', color: 'border-green-500 text-green-500 bg-green-500/10', description: 'Standard output from your application' },
  { key: 'stderr', label: 'stderr', color: 'border-red-500 text-red-500 bg-red-500/10', description: 'Standard error output from your application' },
  { key: 'system', label: 'system', color: 'border-blue-500 text-blue-500 bg-blue-500/10', description: 'Reflexive system messages (start, stop, errors)' },
  { key: 'inject', label: 'inject', color: 'border-purple-500 text-purple-500 bg-purple-500/10', description: 'Instrumentation logs from injected code' },
];

export function LogsPanel({ logs, status, showControls, debugPanelsHeight, watches, onAddWatch, onEditWatch, onClearLogs, onResize }: LogsPanelProps) {
  // Get watch for a message (matches original logic)
  const getWatchForMessage = useCallback((message: string): Watch | null => {
    if (!watches) return null;
    const lowerMessage = message.toLowerCase();
    for (const watch of watches) {
      if (lowerMessage.includes(watch.pattern.toLowerCase())) {
        return watch;
      }
    }
    return null;
  }, [watches]);
  const [filterText, setFilterText] = useState('');
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set(['stdout', 'stderr', 'system', 'inject', 'info', 'error', 'debug', 'warn']));
  const [isPaused, setIsPaused] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [clearedAt, setClearedAt] = useState<number>(0);
  const [injectNamespaces, setInjectNamespaces] = useState<Map<string, string>>(new Map());
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Filter logs (also filter by clearedAt timestamp)
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Skip logs before clear time
      if (clearedAt > 0 && log.timestamp && new Date(log.timestamp).getTime() < clearedAt) {
        return false;
      }

      // Type filter
      const typeMatch = typeFilters.has(log.type) ||
        (typeFilters.has('stdout') && log.type === 'info') ||
        (typeFilters.has('stderr') && log.type === 'error');

      // Text filter
      const textMatch = !filterText ||
        log.message.toLowerCase().includes(filterText.toLowerCase());

      return typeMatch && textMatch;
    });
  }, [logs, typeFilters, filterText, clearedAt]);

  // Scan logs for inject:* namespaces and build color map
  useEffect(() => {
    const namespaces = new Map<string, string>();
    let colorIndex = 0;

    for (const log of logs) {
      if (log.type.startsWith('inject:')) {
        const ns = log.type; // e.g., "inject:info", "inject:http"
        if (!namespaces.has(ns)) {
          namespaces.set(ns, INJECT_COLOR_PALETTE[colorIndex % INJECT_COLOR_PALETTE.length]);
          colorIndex++;
        }
      }
    }

    // Only update if namespaces changed
    if (namespaces.size !== injectNamespaces.size ||
        ![...namespaces.keys()].every(k => injectNamespaces.has(k))) {
      setInjectNamespaces(namespaces);
      // Add discovered namespaces to typeFilters
      setTypeFilters(prev => {
        const next = new Set(prev);
        for (const ns of namespaces.keys()) {
          next.add(ns);
        }
        return next;
      });
    }
  }, [logs]);

  // Auto-scroll when not paused
  useEffect(() => {
    if (!isPaused) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, isPaused]);

  // Handle scroll events to auto-toggle pause
  const handleScroll = () => {
    const container = logsContainerRef.current;
    if (!container) return;

    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 20;

    if (isAtBottom && isPaused) {
      // User scrolled to bottom - auto-resume
      setIsPaused(false);
    } else if (!isAtBottom && !isPaused) {
      // User scrolled up - auto-pause
      setIsPaused(true);
    }
  };

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
    // Set clearedAt to now to filter out all existing logs
    setClearedAt(Date.now());
    // Also call the parent callback if provided
    onClearLogs?.();
  };

  // Get color for log type (uses dynamic inject namespace colors)
  const getLogTypeColor = (type: string): string => {
    if (type.startsWith('inject:') && injectNamespaces.has(type)) {
      const paletteColor = injectNamespaces.get(type)!;
      return INJECT_TEXT_COLORS[paletteColor] || 'text-purple-500';
    }
    return LOG_TYPE_COLORS[type] || 'text-zinc-500';
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
              className="w-36 px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
              style={{ fontFamily: "'SF Mono', Monaco, monospace" }}
            />
            <div className="flex gap-1.5 flex-wrap">
              {FILTER_BUTTONS.map(({ key, label, color, description }) => (
                <button
                  key={key}
                  onClick={() => toggleFilter(key)}
                  title={description}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded-full border transition-opacity ${color} ${
                    typeFilters.has(key) ? 'opacity-100' : 'opacity-30 bg-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
              {/* Dynamic inject namespace buttons */}
              {[...injectNamespaces.entries()].map(([ns, color]) => (
                <button
                  key={ns}
                  onClick={() => toggleFilter(ns)}
                  title={`Injected logs: ${ns.replace('inject:', '')}`}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded-full border transition-opacity ${color} ${
                    typeFilters.has(ns) ? 'opacity-100' : 'opacity-30 bg-transparent'
                  }`}
                >
                  {ns.replace('inject:', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Logs list */}
          <div
            ref={logsContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-2 text-[11px]"
            style={{ fontFamily: "'SF Mono', Monaco, monospace" }}
          >
            {filteredLogs.map((log, idx) => (
              <div
                key={idx}
                className={`flex gap-2 py-0.5 px-1.5 border-b border-zinc-900 hover:bg-zinc-800/50 group ${
                  log.type === 'breakpoint-prompt' ? 'bg-pink-950/20' : ''
                }`}
              >
                <span
                  className={`w-20 flex-shrink-0 text-right pr-2 text-[10px] ${getLogTypeColor(log.type)}`}
                  title={LOG_TYPE_DESCRIPTIONS[log.type] || (log.type.startsWith('inject:') ? `Injected logs: ${log.type.replace('inject:', '')}` : log.type)}
                >
                  {log.type}
                </span>
                <span
                  className="text-zinc-400 whitespace-pre-wrap break-all flex-1"
                  dangerouslySetInnerHTML={{ __html: processLogMessage(log.message) }}
                />
                {(onAddWatch || onEditWatch) && (() => {
                  const existingWatch = getWatchForMessage(log.message);
                  const isWatched = !!existingWatch;
                  return (
                    <button
                      onClick={() => {
                        if (existingWatch && onEditWatch) {
                          onEditWatch(existingWatch);
                        } else if (onAddWatch) {
                          onAddWatch(log.message);
                        }
                      }}
                      className={`px-1 ${
                        isWatched
                          ? 'text-blue-400 opacity-100'
                          : 'opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-blue-400'
                      }`}
                      title={isWatched ? `Edit watch: ${existingWatch.pattern.slice(0, 30)}` : 'Add watch'}
                    >
                      👁
                    </button>
                  );
                })()}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>

          {/* Metrics footer with visual gauges */}
          <div className="flex items-center gap-4 px-3 py-3 bg-zinc-950 border-t border-zinc-800">
            {/* PID Badge */}
            <div className="flex flex-col items-center">
              <span className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">PID</span>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded-md border border-emerald-900">
                {status?.pid || '--'}
              </span>
            </div>

            {/* Uptime Ring Gauge */}
            <div className="flex flex-col items-center">
              <span className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Uptime</span>
              <div className="relative">
                <svg width="44" height="44" viewBox="0 0 44 44" className="transform -rotate-90">
                  {/* Background ring */}
                  <circle
                    cx="22"
                    cy="22"
                    r="18"
                    fill="none"
                    stroke="#27272a"
                    strokeWidth="4"
                  />
                  {/* Progress ring - cycles every 60 seconds */}
                  <circle
                    cx="22"
                    cy="22"
                    r="18"
                    fill="none"
                    stroke="url(#uptimeGradient)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${((status?.uptime || 0) % 60) / 60 * 113} 113`}
                    className="transition-all duration-1000"
                  />
                  <defs>
                    <linearGradient id="uptimeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#06b6d4" />
                    </linearGradient>
                  </defs>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white">
                  {formatUptime(status?.uptime || 0)}
                </span>
              </div>
            </div>

            {/* Memory Gauge (if available) */}
            {status?.memoryUsage && (
              <div className="flex flex-col items-center">
                <span className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Memory</span>
                <div className="relative">
                  <svg width="44" height="44" viewBox="0 0 44 44" className="transform -rotate-90">
                    {/* Background ring */}
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="#27272a"
                      strokeWidth="4"
                    />
                    {/* Usage ring */}
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke={getMemoryColor(status.memoryUsage.heapUsed / status.memoryUsage.heapTotal)}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${(status.memoryUsage.heapUsed / status.memoryUsage.heapTotal) * 113} 113`}
                      className="transition-all duration-500"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white">
                    {Math.round(status.memoryUsage.heapUsed / 1024 / 1024)}M
                  </span>
                </div>
              </div>
            )}

            {/* Restarts Counter */}
            {showControls && (
              <div className="flex flex-col items-center">
                <span className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Restarts</span>
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-mono ${
                  (status?.restartCount || 0) === 0
                    ? 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    : 'bg-amber-950/50 text-amber-400 border border-amber-800'
                }`}>
                  {status?.restartCount || 0}
                </div>
              </div>
            )}

            {/* Mini sparkline area for visual interest */}
            <div className="flex-1 flex justify-end">
              <svg width="60" height="24" viewBox="0 0 60 24" className="opacity-30">
                <path
                  d="M0,20 Q5,18 10,16 T20,12 T30,14 T40,8 T50,10 T60,6"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="1.5"
                  className="animate-pulse"
                />
                <path
                  d="M0,20 Q5,18 10,16 T20,12 T30,14 T40,8 T50,10 T60,6 L60,24 L0,24 Z"
                  fill="url(#sparklineGradient)"
                  opacity="0.3"
                />
                <defs>
                  <linearGradient id="sparklineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="transparent" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
        </>
      )}

      {/* Horizontal Resize Handle */}
      {onResize && (
        <div
          className="h-3 flex-shrink-0 relative group"
          style={{ cursor: 'row-resize' }}
          onMouseDown={(e) => {
            const startY = e.clientY;
            const startHeight = debugPanelsHeight || 180;

            const handleMouseMove = (e: MouseEvent) => {
              const diff = startY - e.clientY;
              onResize(startHeight + diff);
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        >
          {/* Visible grip handle - 3 dots horizontal */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-row gap-1">
            <div className="w-1 h-1 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
            <div className="w-1 h-1 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
            <div className="w-1 h-1 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
          </div>
          {/* Hover highlight bar */}
          <div className="absolute inset-0 bg-zinc-700 opacity-0 group-hover:opacity-30 transition-opacity" />
        </div>
      )}
    </div>
  );
}
