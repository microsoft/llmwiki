import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ── Capture command handlers during registration ─────────────
const commandHandlers: Record<string, (...args: unknown[]) => Promise<void>> = {};

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => Promise<void>) => {
      commandHandlers[id] = handler;
      return { dispose: vi.fn() };
    }),
    executeCommand: vi.fn(),
  },
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInputBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showQuickPick: vi.fn(),
    withProgress: vi.fn(async (_opts: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => {
      return task({ report: vi.fn() }, { isCancellationRequested: false });
    }),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: [base.fsPath, ...segments].join('/'),
      scheme: 'file',
    }),
  },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64, Unknown: 0 },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  workspace: {
    fs: {
      stat: vi.fn(),
      readDirectory: vi.fn(),
    },
  },
}));

vi.mock('@llmwiki/shared', () => ({
  readIndex: vi.fn(),
  readPage: vi.fn(),
  writePage: vi.fn(),
  listPages: vi.fn(),
  readLog: vi.fn(),
  addEntry: vi.fn(),
  appendEntry: vi.fn(),
  directoryExists: vi.fn(),
  initWiki: vi.fn(),
  lintWiki: vi.fn(),
  lintFix: vi.fn(),
  ingestSource: vi.fn(),
  queryWiki: vi.fn(),
  getWikiStatus: vi.fn(),
  isNotFoundError: (err: unknown) =>
    err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT',
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn(),
  stat: vi.fn(),
  copyFile: vi.fn(),
  unlink: vi.fn(),
}));

// llmIngest pulls in vscode.lm and the full enrichment pipeline; stub it
// out so the bulk-ingest tests can drive the command without side effects.
vi.mock('../../packages/vscode/src/llmIngest', () => ({
  llmIngest: vi.fn().mockResolvedValue({ pagesCreated: [], pagesUpdated: [] }),
}));

import { registerCommands } from '../../packages/vscode/src/commands';
import {
  readIndex,
  directoryExists,
  lintWiki,
  listPages,
  readLog,
  ingestSource,
  queryWiki,
  getWikiStatus,
} from '@llmwiki/shared';
import { readdir } from 'node:fs/promises';
import * as vscode from 'vscode';

const mockDirectoryExists = directoryExists as Mock;
const mockReadIndex = readIndex as Mock;
const mockLintWiki = lintWiki as Mock;
const mockListPages = listPages as Mock;
const mockReadLog = readLog as Mock;
const mockReaddir = readdir as Mock;
const mockIngestSource = ingestSource as Mock;
const mockQueryWiki = queryWiki as Mock;
const mockGetWikiStatus = getWikiStatus as Mock;
const mockShowWarningMessage = vscode.window.showWarningMessage as Mock;
const mockShowInformationMessage = vscode.window.showInformationMessage as Mock;
const mockShowInputBox = vscode.window.showInputBox as Mock;
const mockShowQuickPick = vscode.window.showQuickPick as Mock;

const WORKSPACE = '/test/workspace';
const PROJECT_FOLDER = '/test';

const mockProviders = {
  entities: { refresh: vi.fn() },
  concepts: { refresh: vi.fn() },
  rawSources: { refresh: vi.fn() },
};

const mockOutputChannel = {
  appendLine: vi.fn(),
  append: vi.fn(),
  clear: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
  name: 'LLM Wiki',
  replace: vi.fn(),
};

const mockContext = {
  subscriptions: [] as Array<{ dispose: () => void }>,
} as unknown as vscode.ExtensionContext;

describe('Command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(commandHandlers).forEach((k) => delete commandHandlers[k]);
    mockContext.subscriptions = [];

    registerCommands(
      mockContext,
      PROJECT_FOLDER,
      WORKSPACE,
      mockProviders as never,
      mockOutputChannel as unknown as vscode.OutputChannel,
    );
  });

  describe('llmwiki.init', () => {
    it('should register the init command', () => {
      expect(commandHandlers['llmwiki.init']).toBeDefined();
    });

    it('should show warning when wiki already exists', async () => {
      mockDirectoryExists.mockResolvedValue(true);

      await commandHandlers['llmwiki.init']();

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        'Wiki is already initialized (wiki/ directory exists).',
      );
    });
  });

  describe('llmwiki.ingest', () => {
    it('should show warning when wiki not initialized', async () => {
      mockDirectoryExists.mockResolvedValue(false);
      mockShowWarningMessage.mockResolvedValue(undefined);

      await commandHandlers['llmwiki.ingest']();

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        'Wiki not initialized.',
        'Initialize Now',
      );
    });

    it('should call init when user selects "Initialize Now"', async () => {
      mockDirectoryExists.mockResolvedValue(false);
      mockShowWarningMessage.mockResolvedValue('Initialize Now');

      await commandHandlers['llmwiki.ingest']();

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('llmwiki.init');
    });

    it('should default to the open dialog when no args are supplied', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      mockShowQuickPick.mockResolvedValue({ value: 'files' });
      (vscode.window.showOpenDialog as Mock).mockResolvedValue(undefined);

      await commandHandlers['llmwiki.ingest']();

      // First prompts the user to choose Files vs Folder, then opens the dialog.
      expect(mockShowQuickPick).toHaveBeenCalled();
      expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: true,
        }),
      );
    });

    it('should accept a single Uri argument from the explorer context menu', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      const fileUri = { fsPath: '/test/raw/note.md', scheme: 'file' };
      (vscode.workspace.fs.stat as Mock).mockResolvedValue({ type: 1 /* File */ });
      const { llmIngest } = await import('../../packages/vscode/src/llmIngest');

      await commandHandlers['llmwiki.ingest'](fileUri);

      expect(vscode.window.showOpenDialog).not.toHaveBeenCalled();
      expect(llmIngest).toHaveBeenCalledTimes(1);
    });

    it('should accept a multi-selection array from the explorer context menu', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      const uris = [
        { fsPath: '/test/raw/a.md', scheme: 'file' },
        { fsPath: '/test/raw/b.md', scheme: 'file' },
      ];
      (vscode.workspace.fs.stat as Mock).mockResolvedValue({ type: 1 /* File */ });
      const { llmIngest } = await import('../../packages/vscode/src/llmIngest');

      await commandHandlers['llmwiki.ingest'](uris[0], uris);

      expect(vscode.window.showOpenDialog).not.toHaveBeenCalled();
      expect(llmIngest).toHaveBeenCalledTimes(2);
    });

    it('should walk a folder selection and ingest every contained file', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      const folderUri = { fsPath: '/test/raw/notes', scheme: 'file' };
      (vscode.workspace.fs.stat as Mock).mockImplementation(async (u: { fsPath: string }) => {
        if (u.fsPath === '/test/raw/notes') return { type: 2 /* Directory */ };
        return { type: 1 /* File */ };
      });
      (vscode.workspace.fs.readDirectory as Mock).mockImplementation(async (u: { fsPath: string }) => {
        if (u.fsPath === '/test/raw/notes') {
          return [
            ['a.md', 1 /* File */],
            ['sub', 2 /* Directory */],
            ['.hidden', 1 /* File */],       // filtered: dot-prefixed
            ['node_modules', 2 /* Directory */], // filtered: skip-dir
          ];
        }
        if (u.fsPath === '/test/raw/notes/sub') {
          return [['b.md', 1 /* File */]];
        }
        return [];
      });
      const { llmIngest } = await import('../../packages/vscode/src/llmIngest');

      await commandHandlers['llmwiki.ingest'](folderUri);

      // Two real files (a.md + sub/b.md); hidden + node_modules skipped.
      expect(llmIngest).toHaveBeenCalledTimes(2);
    });

    it('should show "No files found" when a folder contains no usable files', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      const folderUri = { fsPath: '/test/raw/empty', scheme: 'file' };
      (vscode.workspace.fs.stat as Mock).mockResolvedValue({ type: 2 /* Directory */ });
      (vscode.workspace.fs.readDirectory as Mock).mockResolvedValue([
        ['.git', 2 /* Directory */],
      ]);
      const { llmIngest } = await import('../../packages/vscode/src/llmIngest');

      await commandHandlers['llmwiki.ingest'](folderUri);

      expect(llmIngest).not.toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No files found'),
      );
    });
  });

  describe('llmwiki.query', () => {
    it('should show warning when wiki not initialized', async () => {
      mockDirectoryExists.mockResolvedValue(false);

      await commandHandlers['llmwiki.query']();

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        'Wiki not initialized. Run "LLM Wiki: Initialize Wiki" first.',
      );
    });

    it('should return early when user cancels input', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      mockShowInputBox.mockResolvedValue(undefined);

      await commandHandlers['llmwiki.query']();

      expect(mockReadIndex).not.toHaveBeenCalled();
    });

    it('should show "No results" when query matches nothing', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      mockShowInputBox.mockResolvedValue('xyznonexistent');
      mockQueryWiki.mockResolvedValue({
        command: 'query',
        query: 'xyznonexistent',
        matches: 0,
        results: [],
      });

      await commandHandlers['llmwiki.query']();

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No results'),
      );
    });
  });

  describe('llmwiki.openPage', () => {
    it('should show warning when readIndex throws', async () => {
      const err = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
      mockReadIndex.mockRejectedValue(err);

      await commandHandlers['llmwiki.openPage']();

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        'Wiki not initialized. Run "LLM Wiki: Initialize Wiki" first.',
      );
    });

    it('should show info message when no pages exist', async () => {
      mockReadIndex.mockResolvedValue([]);

      await commandHandlers['llmwiki.openPage']();

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        'No pages in the wiki yet.',
      );
    });

    it('should show quick pick with pages', async () => {
      mockReadIndex.mockResolvedValue([
        { path: 'entities/a.md', title: 'Alan', summary: 'Test', category: 'Entities', tags: [] },
      ]);
      mockShowQuickPick.mockResolvedValue(undefined);

      await commandHandlers['llmwiki.openPage']();

      expect(mockShowQuickPick).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Alan', description: 'Entities' }),
        ]),
        expect.objectContaining({ placeHolder: 'Select a wiki page to open' }),
      );
    });
  });

  describe('llmwiki.status', () => {
    it('should show status information', async () => {
      mockGetWikiStatus.mockResolvedValue({
        command: 'status',
        source_count: 0,
        wiki_page_count: 0,
        last_ingest_date: null,
        last_lint_date: null,
        orphan_page_count: 0,
        index_coverage_pct: 100,
      });

      await commandHandlers['llmwiki.status']();

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Wiki Status'),
      );
    });
  });

  describe('llmwiki.refresh', () => {
    it('should refresh all providers and run lint-fix', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      const { lintFix } = await import('@llmwiki/shared');
      (lintFix as Mock).mockResolvedValue({
        fixed: [],
        remaining: [],
        fixedCount: 0,
      });

      await commandHandlers['llmwiki.refresh']();

      expect(mockProviders.entities.refresh).toHaveBeenCalled();
      expect(mockProviders.concepts.refresh).toHaveBeenCalled();
      expect(mockProviders.rawSources.refresh).toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('no issues found'),
      );
    });
  });

  describe('error wrapping', () => {
    it('should catch errors and show error message', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      mockQueryWiki.mockRejectedValue(new Error('Unexpected disk failure'));

      await commandHandlers['llmwiki.query']();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'LLM Wiki: Unexpected disk failure',
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected disk failure'),
      );
    });
  });
});
