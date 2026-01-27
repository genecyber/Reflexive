'use client';

import { useState, useEffect } from 'react';
import type { Watch, Breakpoint } from '@/types';

interface WatchModalProps {
  isOpen: boolean;
  watch?: Watch | null;
  initialMessage?: string;
  onClose: () => void;
  onSave: (pattern: string, prompt: string) => void;
}

export function WatchModal({ isOpen, watch, initialMessage, onClose, onSave }: WatchModalProps) {
  const [pattern, setPattern] = useState('');
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (watch) {
      setPattern(watch.pattern);
      setPrompt(watch.prompt);
    } else if (initialMessage) {
      setPattern(initialMessage.slice(0, 100));
      setPrompt('');
    } else {
      setPattern('');
      setPrompt('');
    }
  }, [watch, initialMessage, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!pattern.trim()) return;
    onSave(pattern.trim(), prompt.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold">{watch ? 'Edit Watch Trigger' : 'Add Watch Trigger'}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl">&times;</button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Pattern (substring match)</label>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g., error, connected, user login"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Matched message preview</label>
            <div className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-xs font-mono text-zinc-500 break-all">
              {initialMessage?.slice(0, 200) || pattern || '-'}
              {(initialMessage?.length || 0) > 200 ? '...' : ''}
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Prompt to send to agent when triggered</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Investigate this error and suggest a fix"
              rows={4}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-white hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!pattern.trim()}
            className="px-4 py-2 text-sm bg-green-700 border border-green-600 rounded text-white hover:bg-green-600 disabled:opacity-50"
          >
            Save Watch
          </button>
        </div>
      </div>
    </div>
  );
}

interface BreakpointPromptModalProps {
  isOpen: boolean;
  breakpoint: Breakpoint | null;
  onClose: () => void;
  onSave: (prompt: string) => void;
}

export function BreakpointPromptModal({ isOpen, breakpoint, onClose, onSave }: BreakpointPromptModalProps) {
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (breakpoint) {
      setPrompt(breakpoint.prompt || '');
    } else {
      setPrompt('');
    }
  }, [breakpoint, isOpen]);

  if (!isOpen || !breakpoint) return null;

  const handleSave = () => {
    onSave(prompt.trim());
    onClose();
  };

  const filename = breakpoint.file.split('/').pop() || breakpoint.file;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold">Breakpoint Prompt</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl">&times;</button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Breakpoint Location</label>
            <div className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-xs font-mono text-zinc-400">
              {filename}:{breakpoint.line}
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Prompt to send to agent when breakpoint hits</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Analyze the current call stack and local variables, explain what's happening"
              rows={4}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 resize-y"
              autoFocus
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-white hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-green-700 border border-green-600 rounded text-white hover:bg-green-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

interface ShutdownScreenProps {
  isShutdown: boolean;
}

export function ShutdownScreen({ isShutdown }: ShutdownScreenProps) {
  if (!isShutdown) return null;

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center text-center p-5 z-50">
      <div className="text-6xl mb-5">👋</div>
      <h1 className="text-3xl font-bold text-white mb-2">Thank you for using Reflexive</h1>
      <p className="text-zinc-500 mb-8">We hope you enjoyed building apps by talking to them.</p>

      <div className="flex gap-5 flex-wrap justify-center">
        <a
          href="https://github.com/genecyber/Reflexive"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-6 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white hover:bg-zinc-700 transition-colors"
        >
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Star on GitHub
        </a>
        <a
          href="https://x.com/reflexiveai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-6 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white hover:bg-zinc-700 transition-colors"
        >
          <svg height="18" width="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          Follow on X
        </a>
        <a
          href="https://discord.gg/reflexive"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-6 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white hover:bg-zinc-700 transition-colors"
        >
          <svg height="20" width="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          Join Discord
        </a>
      </div>

      <p className="mt-10 text-zinc-600 text-sm">
        Server has been shut down. You can close this tab.
      </p>
    </div>
  );
}
