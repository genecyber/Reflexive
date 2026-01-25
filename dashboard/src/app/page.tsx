'use client';

import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { ChatPanel } from '@/components/ChatPanel';
import { LogsPanel } from '@/components/LogsPanel';
import { DebugPanels } from '@/components/DebugPanels';
import { WatchModal, BreakpointPromptModal, ShutdownScreen } from '@/components/Modals';
import { useReflexive, useChat } from '@/hooks/useReflexive';
import type { Watch, Breakpoint, Capabilities } from '@/types';

// Configuration - in production, this would come from the server
const CONFIG = {
  showControls: true,
  interactive: false,
  inject: true,
  debug: true,
  capabilities: {
    readFiles: true,
    writeFiles: false,
    shellAccess: false,
    restart: true,
    networkAccess: true,
    inject: true,
    eval: false,
    debug: true,
  } as Capabilities,
};

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

  // Modal state
  const [watchModalOpen, setWatchModalOpen] = useState(false);
  const [editingWatch, setEditingWatch] = useState<Watch | null>(null);
  const [watchMessage, setWatchMessage] = useState<string>('');
  const [bpModalOpen, setBpModalOpen] = useState(false);
  const [editingBreakpoint, setEditingBreakpoint] = useState<Breakpoint | null>(null);
  const [isShutdown, setIsShutdown] = useState(false);

  // Panel width state for resizing
  const [rightPanelWidth, setRightPanelWidth] = useState(380);

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
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <ShutdownScreen isShutdown={isShutdown} />

      <div className="max-w-7xl mx-auto px-3 py-2">
        <Header
          status={status}
          showControls={CONFIG.showControls}
          onStart={startProcess}
          onStop={stopProcess}
          onRestart={restartProcess}
          onShutdown={handleShutdown}
        />

        <div className="flex gap-0 h-[calc(100vh-100px)]">
          {/* Chat Panel */}
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            isRunning={status?.isRunning ?? false}
            showControls={CONFIG.showControls}
            interactive={CONFIG.interactive}
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
                const newWidth = Math.max(250, Math.min(600, startWidth + diff));
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
          <div
            className="flex flex-col bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden"
            style={{ width: rightPanelWidth, flexShrink: 0 }}
          >
            <LogsPanel
              logs={logs}
              status={status}
              showControls={CONFIG.showControls}
              onAddWatch={handleAddWatch}
            />

            {CONFIG.showControls && (
              <DebugPanels
                capabilities={CONFIG.capabilities}
                watches={watches}
                breakpoints={breakpoints}
                debuggerStatus={debuggerStatus}
                showDebug={CONFIG.debug}
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
              />
            )}
          </div>
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
