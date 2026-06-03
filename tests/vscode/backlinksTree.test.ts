import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

const { mockOnDidChangeActiveTextEditor } = vi.hoisted(() => ({
  mockOnDidChangeActiveTextEditor: vi.fn().mockReturnValue({ dispose: vi.fn() }),
}));

vi.mock('vscode', () => ({
  TreeItem: class MockTreeItem {
    label: string;
    collapsibleState: number;
    description?: string;
    contextValue?: string;
    iconPath?: { id: string };
    command?: { command: string; title: string; arguments: unknown[] };
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class MockThemeIcon {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  },
  EventEmitter: class MockEventEmitter {
    private _listeners: ((data?: unknown) => void)[] = [];
    event = (listener: (data?: unknown) => void): { dispose: () => void } => {
      this._listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data?: unknown): void {
      for (const listener of this._listeners) {
        listener(data);
      }
    }
    dispose(): void {
      this._listeners = [];
    }
  },
  window: {
    activeTextEditor: undefined as
      | { document: { uri: { fsPath: string } } }
      | undefined,
    onDidChangeActiveTextEditor: mockOnDidChangeActiveTextEditor,
  },
}));

vi.mock('@llmwiki/core', () => ({
  getBacklinks: vi.fn(),
}));

import {
  BacklinksTreeDataProvider,
  BacklinkTreeItem,
} from '../../packages/vscode/src/backlinksTree';
import { getBacklinks } from '@llmwiki/core';
import * as vscode from 'vscode';
import { join } from 'node:path';

const mockGetBacklinks = getBacklinks as Mock;

const WORKSPACE = '/test/workspace';
const WIKI_DIR = join(WORKSPACE, 'wiki');

describe('BacklinksTreeDataProvider', () => {
  let provider: BacklinksTreeDataProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.window as Record<string, unknown>).activeTextEditor = undefined;
    provider = new BacklinksTreeDataProvider(WORKSPACE);
  });

  describe('getChildren — no active wiki file', () => {
    it('should return guidance message when no editor is active', async () => {
      (vscode.window as Record<string, unknown>).activeTextEditor = undefined;

      const items = await provider.getChildren();

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('Open a wiki page to see backlinks');
      expect(items[0].contextValue).toBe('message');
      expect((items[0].iconPath as { id: string }).id).toBe('info');
      expect(items[0].command).toBeUndefined();
    });

    it('should return guidance message when active file is not in wiki directory', async () => {
      (vscode.window as Record<string, unknown>).activeTextEditor = {
        document: { uri: { fsPath: join(WORKSPACE, 'raw', 'notes.txt') } },
      };

      const items = await provider.getChildren();

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('Open a wiki page to see backlinks');
      expect(items[0].contextValue).toBe('message');
    });
  });

  describe('getChildren — active wiki file with no backlinks', () => {
    it('should return "No backlinks found" when getBacklinks returns empty', async () => {
      (vscode.window as Record<string, unknown>).activeTextEditor = {
        document: { uri: { fsPath: join(WIKI_DIR, 'concepts', 'ai.md') } },
      };
      mockGetBacklinks.mockResolvedValue([]);

      const items = await provider.getChildren();

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('No backlinks found');
      expect(items[0].contextValue).toBe('message');
      expect(mockGetBacklinks).toHaveBeenCalledWith(WIKI_DIR, 'concepts/ai.md');
    });
  });

  describe('getChildren — active wiki file with backlinks', () => {
    const mockBacklinks = [
      {
        sourcePage: join(WIKI_DIR, 'overview', 'intro.md'),
        sourceTitle: 'Introduction',
        linkText: 'Artificial Intelligence',
      },
      {
        sourcePage: join(WIKI_DIR, 'topics', 'ml.md'),
        sourceTitle: 'Machine Learning',
        linkText: 'AI concepts',
      },
    ];

    beforeEach(() => {
      (vscode.window as Record<string, unknown>).activeTextEditor = {
        document: { uri: { fsPath: join(WIKI_DIR, 'concepts', 'ai.md') } },
      };
      mockGetBacklinks.mockResolvedValue(mockBacklinks);
    });

    it('should return correct number of backlink items', async () => {
      const items = await provider.getChildren();

      expect(items).toHaveLength(2);
    });

    it('should set label to sourceTitle', async () => {
      const items = await provider.getChildren();

      expect(items[0].label).toBe('Introduction');
      expect(items[1].label).toBe('Machine Learning');
    });

    it('should set description to linkText', async () => {
      const items = await provider.getChildren();

      expect(items[0].description).toBe('Artificial Intelligence');
      expect(items[1].description).toBe('AI concepts');
    });

    it('should set icon to references', async () => {
      const items = await provider.getChildren();

      expect((items[0].iconPath as { id: string }).id).toBe('references');
      expect((items[1].iconPath as { id: string }).id).toBe('references');
    });

    it('should set contextValue to backlink', async () => {
      const items = await provider.getChildren();

      expect(items[0].contextValue).toBe('backlink');
      expect(items[1].contextValue).toBe('backlink');
    });

    it('should set command to open source page', async () => {
      const items = await provider.getChildren();

      expect(items[0].command).toBeDefined();
      expect(items[0].command!.command).toBe('vscode.open');
      expect(items[0].command!.title).toBe('Open Page');
      expect(
        (items[0].command!.arguments![0] as { fsPath: string }).fsPath,
      ).toBe(join(WIKI_DIR, 'overview', 'intro.md'));
    });

    it('should call getBacklinks with correct wikiDir and relative target path', async () => {
      await provider.getChildren();

      expect(mockGetBacklinks).toHaveBeenCalledWith(WIKI_DIR, 'concepts/ai.md');
    });
  });

  describe('getTreeItem', () => {
    it('should return the element as-is', async () => {
      (vscode.window as Record<string, unknown>).activeTextEditor = undefined;

      const items = await provider.getChildren();
      const item = items[0];

      expect(provider.getTreeItem(item)).toBe(item);
    });
  });

  describe('refresh', () => {
    it('should fire onDidChangeTreeData event', () => {
      let fired = false;
      provider.onDidChangeTreeData(() => {
        fired = true;
      });

      provider.refresh();

      expect(fired).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should dispose without errors', () => {
      expect(() => provider.dispose()).not.toThrow();
    });

    it('should dispose editor listener', () => {
      const disposeSpy = vi.fn();
      mockOnDidChangeActiveTextEditor.mockReturnValue({ dispose: disposeSpy });

      const p = new BacklinksTreeDataProvider(WORKSPACE);
      p.dispose();

      expect(disposeSpy).toHaveBeenCalled();
    });
  });

  describe('editor change listener', () => {
    it('should subscribe to onDidChangeActiveTextEditor in constructor', () => {
      expect(mockOnDidChangeActiveTextEditor).toHaveBeenCalled();
    });
  });
});
