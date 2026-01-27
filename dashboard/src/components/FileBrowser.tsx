'use client';

import { useState, useEffect, useCallback } from 'react';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

interface FileBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (path: string) => void;
  apiBase: string;
}

export function FileBrowser({ isOpen, onClose, onSelectFile, apiBase }: FileBrowserProps) {
  const [currentDir, setCurrentDir] = useState<string>('');
  const [parentDir, setParentDir] = useState<string>('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (dir?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = dir ? `${apiBase}/files?dir=${encodeURIComponent(dir)}` : `${apiBase}/files`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load directory');
        return;
      }
      setCurrentDir(data.dir);
      setParentDir(data.parent);
      setFiles(data.files);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (isOpen) {
      loadDirectory();
    }
  }, [isOpen, loadDirectory]);

  const handleClick = (file: FileEntry) => {
    if (file.isDirectory) {
      loadDirectory(file.path);
    } else if (file.isFile && (file.name.endsWith('.js') || file.name.endsWith('.ts') || file.name.endsWith('.mjs') || file.name.endsWith('.cjs'))) {
      onSelectFile(file.path);
      onClose();
    }
  };

  const handleGoUp = () => {
    if (parentDir && parentDir !== currentDir) {
      loadDirectory(parentDir);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-[600px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold">Select a file to run</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Current path */}
        <div className="px-3 py-2 bg-zinc-800 text-xs font-mono text-zinc-400 flex items-center gap-2">
          <button
            onClick={handleGoUp}
            disabled={!parentDir || parentDir === currentDir}
            className="px-2 py-1 bg-zinc-700 rounded hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ..
          </button>
          <span className="truncate">{currentDir}</span>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto min-h-[300px]">
          {loading && (
            <div className="p-4 text-center text-zinc-500">Loading...</div>
          )}
          {error && (
            <div className="p-4 text-center text-red-400">{error}</div>
          )}
          {!loading && !error && files.length === 0 && (
            <div className="p-4 text-center text-zinc-500">No files found</div>
          )}
          {!loading && !error && files.map((file) => {
            const isRunnable = file.isFile && (
              file.name.endsWith('.js') ||
              file.name.endsWith('.ts') ||
              file.name.endsWith('.mjs') ||
              file.name.endsWith('.cjs')
            );
            return (
              <div
                key={file.path}
                onClick={() => handleClick(file)}
                className={`
                  px-3 py-2 flex items-center gap-2 border-b border-zinc-800
                  ${file.isDirectory || isRunnable ? 'cursor-pointer hover:bg-zinc-800' : 'opacity-50 cursor-not-allowed'}
                `}
              >
                <span className="text-lg w-6 text-center">
                  {file.isDirectory ? '📁' : isRunnable ? '📄' : '📃'}
                </span>
                <span className={`text-sm ${isRunnable ? 'text-green-400' : ''}`}>
                  {file.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-700 text-xs text-zinc-500">
          Click a folder to navigate, or select a .js/.ts file to run
        </div>
      </div>
    </div>
  );
}
