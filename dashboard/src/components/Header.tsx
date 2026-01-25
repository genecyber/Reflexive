'use client';

import { ProcessStatus, Capabilities } from '@/types';

interface HeaderProps {
  status: ProcessStatus | null;
  showControls: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onShutdown: () => void;
}

export function Header({ status, showControls, onStart, onStop, onRestart, onShutdown }: HeaderProps) {
  const isRunning = status?.isRunning ?? false;

  return (
    <header className="flex justify-between items-center py-1 px-0 border-b border-zinc-800 mb-2">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-0">
          <span className="text-2xl font-bold tracking-wider bg-gradient-to-r from-green-400 via-green-500 to-green-600 bg-clip-text text-transparent">
            REFLEXIVE
          </span>
        </h1>
        {status?.entry && (
          <div className="text-xs text-zinc-500 font-mono">{status.entry}</div>
        )}
      </div>

      {showControls ? (
        <div className="flex gap-2">
          <button
            onClick={onStart}
            disabled={isRunning}
            className="px-3 py-1.5 text-xs bg-zinc-800 border border-green-500 rounded text-white hover:bg-green-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start
          </button>
          <button
            onClick={onRestart}
            className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-600 rounded text-white hover:bg-zinc-700"
          >
            Restart
          </button>
          <button
            onClick={onStop}
            disabled={!isRunning}
            className="px-3 py-1.5 text-xs bg-zinc-800 border border-red-500 rounded text-white hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Stop
          </button>
          <button
            onClick={() => {
              if (confirm('Shutdown Reflexive completely?')) {
                onShutdown();
              }
            }}
            className="px-2.5 py-1.5 text-base bg-zinc-800 border border-amber-500 rounded text-amber-500 hover:bg-amber-900"
            title="Shutdown Reflexive"
          >
            ⏻
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-900/50 rounded-full text-xs">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span>Running</span>
        </div>
      )}
    </header>
  );
}

interface StatusBadgeProps {
  isRunning: boolean;
}

export function StatusBadge({ isRunning }: StatusBadgeProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500' : 'bg-red-500'}`} />
      <span>{isRunning ? 'Running' : 'Stopped'}</span>
    </div>
  );
}
