'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Header } from '@/components/Header';
import { ChatPanel } from '@/components/ChatPanel';
import { LogsPanel } from '@/components/LogsPanel';
import { DebugPanels } from '@/components/DebugPanels';
import { WatchModal, BreakpointPromptModal, ShutdownScreen } from '@/components/Modals';
import { useReflexive, useChat } from '@/hooks/useReflexive';
import type { Watch, Breakpoint, Capabilities } from '@/types';

// Default configuration - overridden by server-provided values in status
const DEFAULT_CAPABILITIES: Capabilities = {
  readFiles: true,
  writeFiles: false,
  shellAccess: false,
  restart: true,
  networkAccess: true,
  inject: false,
  eval: false,
  debug: false,
};

function CollapsedSectionLabel({ label, count, onClick }: { label: string; count?: number; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="py-3 px-2 text-xs text-zinc-500 cursor-pointer border-b border-zinc-800 hover:text-white hover:bg-zinc-800 flex items-center gap-1"
      style={{ writingMode: 'vertical-rl' }}
    >
      <span className="text-[10px]">&#9654;</span>
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="bg-zinc-700 px-1 rounded text-[9px]">{count}</span>
      )}
    </div>
  );
}

export default function Dashboard() {
  const {
    status,
    logs,
    debuggerStatus,
    breakpoints,
    startProcess,
    stopProcess,
    restartProcess,
    shutdown,
    debuggerResume,
    debuggerStepOver,
    debuggerStepInto,
    debuggerStepOut,
    updateBreakpoint,
    deleteBreakpoint,
    sendCliInput,
    togglePermission,
  } = useReflexive();

  const {
    messages,
    isLoading,
    sendMessage,
    stopResponse,
    clearMessages,
  } = useChat();

  // Watch state (client-side only for now)
  const [watches, setWatches] = useState<Watch[]>([]);
  const [watchIdCounter, setWatchIdCounter] = useState(0);

  // Track which logs have been checked to avoid duplicate triggers
  const lastCheckedLogIndexRef = useRef(0);
  // Rate limiter: prevent triggering more than once per 2 seconds
  const lastWatchTriggerTimeRef = useRef(0);

  // Modal state
  const [watchModalOpen, setWatchModalOpen] = useState(false);
  const [editingWatch, setEditingWatch] = useState<Watch | null>(null);
  const [watchMessage, setWatchMessage] = useState<string>('');
  const [bpModalOpen, setBpModalOpen] = useState(false);
  const [editingBreakpoint, setEditingBreakpoint] = useState<Breakpoint | null>(null);
  const [isShutdown, setIsShutdown] = useState(false);

  // Panel width state for resizing
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [debugPanelsHeight, setDebugPanelsHeight] = useState(180);

  // Right panel collapsed state
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  // Watch auto-prompting: monitor logs for watch triggers
  // Matches original logic: always count hits, only trigger prompt if exists and not loading
  useEffect(() => {
    if (logs.length === 0 || watches.length === 0) return;

    // Only check logs from lastCheckedLogIndex onwards
    const startIndex = lastCheckedLogIndexRef.current;
    if (startIndex >= logs.length) return;

    // Check new logs for watch pattern matches
    for (let i = startIndex; i < logs.length; i++) {
      const log = logs[i];

      for (const watch of watches) {
        // Only skip if disabled (original behavior - don't skip if no prompt)
        if (!watch.enabled) continue;

        if (log.message.toLowerCase().includes(watch.pattern.toLowerCase())) {
          // Always increment hit count (even without prompt)
          setWatches(prev => prev.map(w =>
            w.id === watch.id ? { ...w, hitCount: w.hitCount + 1 } : w
          ));

          // Only trigger the prompt if there IS one AND not currently loading AND rate limit passed
          const now = Date.now();
          const timeSinceLastTrigger = now - lastWatchTriggerTimeRef.current;
          if (watch.prompt && !isLoading && timeSinceLastTrigger > 2000) {
            lastWatchTriggerTimeRef.current = now;
            const contextMsg = `WATCH TRIGGER: A log message matched pattern "${watch.pattern}"\n\nMatched message: ${log.message}\n\nUser prompt: ${watch.prompt}`;
            sendMessage(contextMsg, { isWatchTrigger: true, watchPattern: watch.pattern });
          }

          // Update lastCheckedLogIndex - found a match for this log, move on
          // (original returns after first match per log)
          break;
        }
      }
    }

    // Update lastCheckedLogIndex
    lastCheckedLogIndexRef.current = logs.length;
  }, [logs.length, watches, isLoading, sendMessage]);

  // Watch handlers
  const handleAddWatch = useCallback((message: string) => {
    setWatchMessage(message);
    setEditingWatch(null);
    setWatchModalOpen(true);
  }, []);

  const handleEditWatch = useCallback((watch: Watch) => {
    setEditingWatch(watch);
    setWatchMessage('');
    setWatchModalOpen(true);
  }, []);

  const handleSaveWatch = useCallback((pattern: string, prompt: string) => {
    if (editingWatch) {
      setWatches(prev => prev.map(w =>
        w.id === editingWatch.id ? { ...w, pattern, prompt } : w
      ));
    } else {
      const newWatch: Watch = {
        id: watchIdCounter + 1,
        pattern,
        prompt,
        enabled: true,
        hitCount: 0,
      };
      setWatches(prev => [...prev, newWatch]);
      setWatchIdCounter(prev => prev + 1);
    }
    setWatchModalOpen(false);
    setEditingWatch(null);
  }, [editingWatch, watchIdCounter]);

  const handleDeleteWatch = useCallback((id: number) => {
    setWatches(prev => prev.filter(w => w.id !== id));
  }, []);

  const handleToggleWatch = useCallback((id: number, enabled: boolean) => {
    setWatches(prev => prev.map(w =>
      w.id === id ? { ...w, enabled } : w
    ));
  }, []);

  // Breakpoint handlers
  const handleEditBreakpointPrompt = useCallback((breakpoint: Breakpoint) => {
    setEditingBreakpoint(breakpoint);
    setBpModalOpen(true);
  }, []);

  const handleSaveBreakpointPrompt = useCallback((prompt: string) => {
    if (editingBreakpoint) {
      updateBreakpoint(editingBreakpoint.id, {
        prompt,
        promptEnabled: prompt.length > 0
      });
    }
    setBpModalOpen(false);
    setEditingBreakpoint(null);
  }, [editingBreakpoint, updateBreakpoint]);

  const handleToggleBreakpoint = useCallback((id: string, enabled: boolean) => {
    updateBreakpoint(id, { enabled });
  }, [updateBreakpoint]);

  // Shutdown handler
  const handleShutdown = useCallback(async () => {
    setIsShutdown(true);
    await shutdown();
  }, [shutdown]);

  return (
    <div className="h-screen overflow-hidden bg-zinc-950 text-zinc-200 flex flex-col">
      <ShutdownScreen isShutdown={isShutdown} />

      <div className="max-w-7xl mx-auto px-3 py-1 w-full flex flex-col h-full">
        <Header
          status={status}
          showControls={status?.showControls ?? true}
          onStart={startProcess}
          onStop={stopProcess}
          onRestart={restartProcess}
          onShutdown={handleShutdown}
        />

        <div className="flex gap-0 flex-1 min-h-0">
          {/* Chat Panel */}
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            isRunning={status?.isRunning ?? false}
            showControls={status?.showControls ?? true}
            interactive={status?.interactive ?? false}
            onSendMessage={sendMessage}
            onStopResponse={stopResponse}
            onClearMessages={clearMessages}
            onSendCliInput={sendCliInput}
          />

          {/* Resize Handle */}
          <div
            className="w-2 cursor-col-resize flex-shrink-0 hover:bg-zinc-700 transition-colors relative group"
            onMouseDown={(e) => {
              const startX = e.clientX;
              const startWidth = rightPanelWidth;

              const handleMouseMove = (e: MouseEvent) => {
                const diff = startX - e.clientX;
                const newWidth = Math.max(200, Math.min(800, startWidth + diff));
                setRightPanelWidth(newWidth);
              };

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };

              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-10 bg-zinc-700 rounded opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Right Panel - Logs + Debug */}
          {isRightPanelCollapsed ? (
            <div className="w-[42px] bg-zinc-900 border border-zinc-800 rounded-md flex flex-col flex-shrink-0">
              <CollapsedSectionLabel label="Logs" onClick={() => setIsRightPanelCollapsed(false)} />
              <CollapsedSectionLabel label="Permissions" onClick={() => setIsRightPanelCollapsed(false)} />
              <CollapsedSectionLabel label="Watch" count={watches.length} onClick={() => setIsRightPanelCollapsed(false)} />
              <CollapsedSectionLabel label="Debugger" onClick={() => setIsRightPanelCollapsed(false)} />
            </div>
          ) : (
            <div
              className="flex flex-col bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden"
              style={{ width: rightPanelWidth, flexShrink: 0 }}
            >
              {/* Collapse button */}
              <div className="flex justify-end px-1 pt-1">
                <button
                  onClick={() => setIsRightPanelCollapsed(true)}
                  className="text-zinc-500 hover:text-white hover:bg-zinc-800 rounded p-0.5 text-[10px]"
                  title="Collapse panel"
                >
                  &#9654;&#9654;
                </button>
              </div>
              <LogsPanel
                logs={logs}
                status={status}
                showControls={status?.showControls ?? true}
                debugPanelsHeight={debugPanelsHeight}
                onAddWatch={handleAddWatch}
                onResize={(height) => setDebugPanelsHeight(Math.max(60, Math.min(400, height)))}
              />

              {(status?.showControls ?? true) && (
                <DebugPanels
                  capabilities={status?.capabilities ?? DEFAULT_CAPABILITIES}
                  watches={watches}
                  breakpoints={breakpoints}
                  debuggerStatus={debuggerStatus}
                  showDebug={status?.debug ?? false}
                  height={debugPanelsHeight}
                  onEditWatch={handleEditWatch}
                  onDeleteWatch={handleDeleteWatch}
                  onToggleWatch={handleToggleWatch}
                  onEditBreakpointPrompt={handleEditBreakpointPrompt}
                  onDeleteBreakpoint={deleteBreakpoint}
                  onToggleBreakpoint={handleToggleBreakpoint}
                  onDebuggerResume={debuggerResume}
                  onDebuggerStepOver={debuggerStepOver}
                  onDebuggerStepInto={debuggerStepInto}
                  onDebuggerStepOut={debuggerStepOut}
                  onTogglePermission={togglePermission}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <WatchModal
        isOpen={watchModalOpen}
        watch={editingWatch}
        initialMessage={watchMessage}
        onClose={() => {
          setWatchModalOpen(false);
          setEditingWatch(null);
        }}
        onSave={handleSaveWatch}
      />

      <BreakpointPromptModal
        isOpen={bpModalOpen}
        breakpoint={editingBreakpoint}
        onClose={() => {
          setBpModalOpen(false);
          setEditingBreakpoint(null);
        }}
        onSave={handleSaveBreakpointPrompt}
      />
    </div>
  );
}
