import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// ── vscode mock ────────────────────────────────────────────────
const mockStatusBarItem = {
  text: '',
  tooltip: '',
  command: '',
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

const mockWatcherDisposables: Array<{ dispose: Mock }> = [];

function createMockWatcher() {
  const changeListeners: Array<() => void> = [];
  const createListeners: Array<() => void> = [];
  const deleteListeners: Array<() => void> = [];
  const watcher = {
    onDidChange: (cb: () => void) => {
      changeListeners.push(cb);
      const d = { dispose: vi.fn() };
      mockWatcherDisposables.push(d);
      return d;
    },
    onDidCreate: (cb: () => void) => {
      createListeners.push(cb);
      const d = { dispose: vi.fn() };
      mockWatcherDisposables.push(d);
      return d;
    },
    onDidDelete: (cb: () => void) => {
      deleteListeners.push(cb);
      const d = { dispose: vi.fn() };
      mockWatcherDisposables.push(d);
      return d;
    },
    dispose: vi.fn(),
    _fireChange: () => changeListeners.forEach((cb) => cb()),
    _fireCreate: () => createListeners.forEach((cb) => cb()),
    _fireDelete: () => deleteListeners.forEach((cb) => cb()),
  };
  return watcher;
}

const mockWatchers: ReturnType<typeof createMockWatcher>[] = [];

vi.mock('vscode', () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: {
    createStatusBarItem: vi.fn(() => mockStatusBarItem),
  },
  workspace: {
    createFileSystemWatcher: vi.fn(() => {
      const w = createMockWatcher();
      mockWatchers.push(w);
      return w;
    }),
  },
}));

// ── shared mock ────────────────────────────────────────────────
vi.mock('@llmwiki/shared', () => ({
  readIndex: vi.fn(),
  listPages: vi.fn(),
  readLog: vi.fn(),
  directoryExists: vi.fn(),
}));

// ── node:fs/promises mock ──────────────────────────────────────
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

import { createStatusBar, StatusBarManager } from '../../packages/vscode/src/statusBar';
import { readIndex, listPages, readLog, directoryExists } from '@llmwiki/shared';
import { readdir } from 'node:fs/promises';
import * as vscode from 'vscode';
import { join } from 'node:path';

const mockReadIndex = readIndex as Mock;
const mockListPages = listPages as Mock;
const mockReadLog = readLog as Mock;
const mockDirectoryExists = directoryExists as Mock;
const mockReaddir = readdir as Mock;
const mockCreateStatusBarItem = vscode.window.createStatusBarItem as Mock;
const mockCreateFileSystemWatcher = vscode.workspace.createFileSystemWatcher as Mock;

const WORKSPACE = '/test/workspace';
const WIKI_DIR = join(WORKSPACE, 'wiki');

// ── helpers ────────────────────────────────────────────────────

function setupWikiExists(): void {
  mockDirectoryExists.mockResolvedValue(true);
}

function setupWikiNotExists(): void {
  mockDirectoryExists.mockResolvedValue(false);
}

function setupDefaultStats(overrides?: {
  pages?: string[];
  sourceCount?: number;
  logEntries?: Array<{ date: string; verb: string; subject: string; details: string }>;
  indexEntries?: Array<{ path: string; title: string; summary: string; category: string; tags: string[] }>;
}): void {
  const wikiDir = join(WORKSPACE, 'wiki');
  const pages = overrides?.pages ?? [
    join(wikiDir, 'entities/alan-turing.md'),
    join(wikiDir, 'concepts/neural-networks.md'),
    join(wikiDir, 'index.md'),
    join(wikiDir, 'log.md'),
  ];
  mockListPages.mockResolvedValue(pages);

  if ((overrides?.sourceCount ?? 2) > 0) {
    const files = Array.from({ length: overrides?.sourceCount ?? 2 }, (_, i) => ({
      isFile: () => true,
      name: `file${i}.txt`,
    }));
    mockReaddir.mockResolvedValue(files);
  } else {
    mockReaddir.mockRejectedValue(new Error('ENOENT'));
  }

  mockReadLog.mockResolvedValue(
    overrides?.logEntries ?? [
      { date: '2024-01-15', verb: 'ingested', subject: 'file.txt', details: 'test' },
    ],
  );

  mockReadIndex.mockResolvedValue(
    overrides?.indexEntries ?? [
      { path: 'entities/alan-turing.md', title: 'Turing', summary: 's', category: 'Entities', tags: [] },
      { path: 'concepts/neural-networks.md', title: 'NN', summary: 's', category: 'Concepts', tags: [] },
    ],
  );
}

const mockContext = {
  subscriptions: [] as Array<{ dispose: () => void }>,
} as unknown as vscode.ExtensionContext;

describe('StatusBarManager', () => {
  let manager: StatusBarManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWatchers.length = 0;
    mockWatcherDisposables.length = 0;
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = '';
    mockStatusBarItem.command = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('creation and initialization', () => {
    it('should create a status bar item aligned to the left with priority 100', () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);

      expect(mockCreateStatusBarItem).toHaveBeenCalledWith(
        vscode.StatusBarAlignment.Left,
        100,
      );
    });

    it('should set the command to llmwiki.status', () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);

      expect(mockStatusBarItem.command).toBe('llmwiki.status');
    });

    it('should call show() on the status bar item', () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);

      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });

    it('should create two file system watchers', () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);

      expect(mockCreateFileSystemWatcher).toHaveBeenCalledTimes(2);
      expect(mockCreateFileSystemWatcher).toHaveBeenCalledWith('**/wiki/**/*.md');
      expect(mockCreateFileSystemWatcher).toHaveBeenCalledWith('**/raw/**');
    });
  });

  describe('status bar text', () => {
    it('should show page count excluding index.md and log.md', async () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);
      // Wait for the initial async refresh to complete
      await vi.runAllTimersAsync();
      // Allow microtasks (promise resolution)
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(mockStatusBarItem.text).toBe('$(book) Wiki: 2 pages');
    });

    it('should show "Not initialized" when wiki dir does not exist', async () => {
      setupWikiNotExists();
      mockListPages.mockResolvedValue([]);
      mockReaddir.mockRejectedValue(new Error('ENOENT'));
      mockReadLog.mockResolvedValue([]);
      mockReadIndex.mockResolvedValue([]);

      manager = createStatusBar(mockContext, WORKSPACE);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(mockStatusBarItem.text).toBe('$(book) Wiki: Not initialized');
    });
  });

  describe('tooltip', () => {
    it('should show source count, last ingest date, and coverage', async () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(mockStatusBarItem.tooltip).toBe(
        'Sources: 2 | Last ingest: 2024-01-15 | Coverage: 100%',
      );
    });

    it('should show "never" when no ingest entries exist', async () => {
      setupWikiExists();
      setupDefaultStats({
        logEntries: [
          { date: '2024-01-10', verb: 'initialized', subject: 'wiki', details: 'init' },
        ],
      });

      manager = createStatusBar(mockContext, WORKSPACE);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(mockStatusBarItem.tooltip).toBe(
        'Sources: 2 | Last ingest: never | Coverage: 100%',
      );
    });

    it('should compute coverage correctly with orphan pages', async () => {
      setupWikiExists();
      const wikiDir = join(WORKSPACE, 'wiki');
      setupDefaultStats({
        pages: [
          join(wikiDir, 'entities/alan-turing.md'),
          join(wikiDir, 'concepts/neural-networks.md'),
          join(wikiDir, 'concepts/orphan.md'),
          join(wikiDir, 'index.md'),
          join(wikiDir, 'log.md'),
        ],
        indexEntries: [
          { path: 'entities/alan-turing.md', title: 'Turing', summary: 's', category: 'Entities', tags: [] },
          { path: 'concepts/neural-networks.md', title: 'NN', summary: 's', category: 'Concepts', tags: [] },
        ],
      });

      manager = createStatusBar(mockContext, WORKSPACE);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      // 2 out of 3 pages are indexed → 67%
      expect(mockStatusBarItem.tooltip).toContain('Coverage: 67%');
    });
  });

  describe('debounced refresh on file changes', () => {
    it('should debounce refresh with 300ms delay on watcher events', async () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);
      // Let initial refresh complete
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      vi.clearAllMocks();
      setupWikiExists();
      setupDefaultStats({ pages: [
        join(WIKI_DIR, 'entities/new-page.md'),
        join(WIKI_DIR, 'index.md'),
        join(WIKI_DIR, 'log.md'),
      ] });

      // Fire multiple change events rapidly
      mockWatchers[0]._fireChange();
      mockWatchers[0]._fireCreate();
      mockWatchers[0]._fireDelete();

      // listPages should not have been called yet (debounce pending)
      expect(mockListPages).not.toHaveBeenCalled();

      // Advance past debounce
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();
      await vi.runAllTimersAsync();

      // Should have called only once due to debounce
      expect(mockListPages).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should not throw when refresh encounters errors', async () => {
      setupWikiExists();
      mockListPages.mockRejectedValue(new Error('disk error'));
      mockReaddir.mockRejectedValue(new Error('ENOENT'));
      mockReadLog.mockRejectedValue(new Error('disk error'));
      mockReadIndex.mockRejectedValue(new Error('disk error'));

      expect(() => {
        manager = createStatusBar(mockContext, WORKSPACE);
      }).not.toThrow();

      await vi.runAllTimersAsync();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      // Should still have some text set — not crash
      expect(mockStatusBarItem.text).toBeDefined();
    });
  });

  describe('dispose', () => {
    it('should dispose the status bar item', () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);
      manager.dispose();

      expect(mockStatusBarItem.dispose).toHaveBeenCalled();
    });

    it('should dispose file system watchers', () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);
      manager.dispose();

      for (const w of mockWatchers) {
        expect(w.dispose).toHaveBeenCalled();
      }
    });

    it('should clear the debounce timer on dispose', async () => {
      setupWikiExists();
      setupDefaultStats();

      manager = createStatusBar(mockContext, WORKSPACE);
      await vi.runAllTimersAsync();
      await Promise.resolve();

      // Trigger a change that starts a debounce
      vi.clearAllMocks();
      setupWikiExists();
      setupDefaultStats();
      mockWatchers[0]._fireChange();

      // Dispose before debounce fires
      manager.dispose();

      // Advance past debounce time — refresh should NOT have fired
      await vi.advanceTimersByTimeAsync(500);
      expect(mockListPages).not.toHaveBeenCalled();
    });
  });

  describe('coverage edge cases', () => {
    it('should report 100% coverage when there are zero wiki pages', async () => {
      setupWikiExists();
      setupDefaultStats({
        pages: [
          join(WIKI_DIR, 'index.md'),
          join(WIKI_DIR, 'log.md'),
        ],
        indexEntries: [],
        sourceCount: 0,
        logEntries: [],
      });

      manager = createStatusBar(mockContext, WORKSPACE);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(mockStatusBarItem.text).toBe('$(book) Wiki: 0 pages');
      expect(mockStatusBarItem.tooltip).toContain('Coverage: 100%');
    });

    it('should handle readdir returning a mix of files and directories', async () => {
      setupWikiExists();
      mockListPages.mockResolvedValue([
        join(WIKI_DIR, 'entities/page.md'),
        join(WIKI_DIR, 'index.md'),
        join(WIKI_DIR, 'log.md'),
      ]);
      mockReaddir.mockResolvedValue([
        { isFile: () => true, name: 'a.txt' },
        { isFile: () => false, name: 'subdir' },
        { isFile: () => true, name: 'b.txt' },
      ]);
      mockReadLog.mockResolvedValue([]);
      mockReadIndex.mockResolvedValue([
        { path: 'entities/page.md', title: 'P', summary: 's', category: 'E', tags: [] },
      ]);

      manager = createStatusBar(mockContext, WORKSPACE);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(mockStatusBarItem.tooltip).toContain('Sources: 2');
    });
  });
});
