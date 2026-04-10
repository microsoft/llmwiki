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
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  },
  workspace: {},
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
  lintWiki: vi.fn(),
  ingestSource: vi.fn(),
  queryWiki: vi.fn(),
  getWikiStatus: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
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

const mockProviders = {
  wikiPages: { refresh: vi.fn() },
  rawSources: { refresh: vi.fn() },
  lintFindings: { setFindings: vi.fn() },
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

  describe('llmwiki.lint', () => {
    it('should show warning when wiki not initialized', async () => {
      mockDirectoryExists.mockResolvedValue(false);

      await commandHandlers['llmwiki.lint']();

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        'Wiki not initialized. Run "LLM Wiki: Initialize Wiki" first.',
      );
    });

    it('should show success message when no lint issues found', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      mockLintWiki.mockResolvedValue({
        findings: [],
        errorCount: 0,
        warningCount: 0,
      });

      await commandHandlers['llmwiki.lint']();

      expect(mockProviders.lintFindings.setFindings).toHaveBeenCalledWith([]);
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        'Lint: no issues found ✓',
      );
    });

    it('should show warning message when errors found', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      mockLintWiki.mockResolvedValue({
        findings: [{ severity: 'error', message: 'broken link' }],
        errorCount: 1,
        warningCount: 0,
      });

      await commandHandlers['llmwiki.lint']();

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        'Lint: 1 error(s)',
      );
    });
  });

  describe('llmwiki.openPage', () => {
    it('should show warning when readIndex throws', async () => {
      mockReadIndex.mockRejectedValue(new Error('File not found'));

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
    it('should refresh wiki pages and raw sources providers', async () => {
      await commandHandlers['llmwiki.refresh']();

      expect(mockProviders.wikiPages.refresh).toHaveBeenCalled();
      expect(mockProviders.rawSources.refresh).toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        'LLM Wiki: views refreshed.',
      );
    });
  });

  describe('error wrapping', () => {
    it('should catch errors and show error message', async () => {
      mockDirectoryExists.mockResolvedValue(true);
      mockLintWiki.mockRejectedValue(new Error('Unexpected disk failure'));

      await commandHandlers['llmwiki.lint']();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'LLM Wiki: Unexpected disk failure',
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected disk failure'),
      );
    });
  });
});
