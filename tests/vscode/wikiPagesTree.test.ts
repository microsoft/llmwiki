import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

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
}));

vi.mock('@llmwiki/core', () => ({
  readIndex: vi.fn(),
}));

import {
  WikiPagesTreeDataProvider,
  WikiTreeItem,
} from '../../packages/vscode/src/wikiPagesTree';
import { readIndex } from '@llmwiki/core';
import { join } from 'node:path';

const mockReadIndex = readIndex as Mock;

const mockEntries = [
  {
    path: 'entities/alan-turing.md',
    title: 'Alan Turing',
    summary: 'Father of CS',
    category: 'Entities',
    tags: ['cs'],
  },
  {
    path: 'entities/claude-shannon.md',
    title: 'Claude Shannon',
    summary: 'Info theory',
    category: 'Entities',
    tags: ['info'],
  },
  {
    path: 'concepts/neural-networks.md',
    title: 'Neural Networks',
    summary: 'Bio-inspired models',
    category: 'Concepts',
    tags: ['ai'],
  },
  {
    path: 'sources/turing-bio.md',
    title: 'Turing Biography',
    summary: 'A biography',
    category: 'Sources',
    tags: ['bio'],
  },
];

const WORKSPACE = '/test/workspace';

describe('WikiPagesTreeDataProvider', () => {
  let entitiesProvider: WikiPagesTreeDataProvider;
  let conceptsProvider: WikiPagesTreeDataProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    entitiesProvider = new WikiPagesTreeDataProvider(WORKSPACE, 'Entities');
    conceptsProvider = new WikiPagesTreeDataProvider(WORKSPACE, 'Concepts');
  });

  describe('getChildren — entities', () => {
    it('should return only entity pages', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const pages = await entitiesProvider.getChildren();

      expect(pages).toHaveLength(2);
      expect(pages[0].label).toBe('Alan Turing');
      expect(pages[1].label).toBe('Claude Shannon');
    });

    it('should return empty array when no entities exist', async () => {
      mockReadIndex.mockResolvedValue([mockEntries[2], mockEntries[3]]); // only Concepts + Sources

      const pages = await entitiesProvider.getChildren();

      expect(pages).toEqual([]);
    });

    it('should return empty array for empty index', async () => {
      mockReadIndex.mockResolvedValue([]);

      const pages = await entitiesProvider.getChildren();

      expect(pages).toEqual([]);
    });

    it('should return empty on readIndex error', async () => {
      mockReadIndex.mockRejectedValue(new Error('ENOENT'));

      const pages = await entitiesProvider.getChildren();

      expect(pages).toEqual([]);
    });
  });

  describe('getChildren — concepts', () => {
    it('should return only concept pages', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const pages = await conceptsProvider.getChildren();

      expect(pages).toHaveLength(1);
      expect(pages[0].label).toBe('Neural Networks');
    });
  });

  describe('WikiTreeItem properties', () => {
    it('should have correct properties for page items', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const pages = await entitiesProvider.getChildren();
      const pageItem = pages[0];

      expect(pageItem.label).toBe('Alan Turing');
      expect(pageItem.description).toBe('Father of CS');
      expect(pageItem.contextValue).toBe('page');
      expect(pageItem.collapsibleState).toBe(0); // None
      expect((pageItem.iconPath as { id: string }).id).toBe('file-text');
    });

    it('should have command that opens the file with correct URI', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const pages = await entitiesProvider.getChildren();
      const pageItem = pages[0];
      const expectedPath = join(WORKSPACE, 'wiki', 'entities/alan-turing.md');

      expect(pageItem.command).toBeDefined();
      expect(pageItem.command!.command).toBe('vscode.open');
      expect(pageItem.command!.title).toBe('Open Page');
      expect(pageItem.command!.arguments).toHaveLength(1);
      expect(
        (pageItem.command!.arguments![0] as { fsPath: string }).fsPath,
      ).toBe(expectedPath);
    });

    it('should store pagePath on page items', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const pages = await entitiesProvider.getChildren();
      const expectedPath = join(WORKSPACE, 'wiki', 'entities/alan-turing.md');
      expect((pages[0] as WikiTreeItem & { pagePath: string }).pagePath).toBe(
        expectedPath,
      );
    });
  });

  describe('getTreeItem', () => {
    it('should return the element as-is', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const pages = await entitiesProvider.getChildren();
      const item = pages[0];

      expect(entitiesProvider.getTreeItem(item)).toBe(item);
    });
  });

  describe('refresh', () => {
    it('should fire onDidChangeTreeData event', () => {
      let fired = false;
      entitiesProvider.onDidChangeTreeData(() => {
        fired = true;
      });

      entitiesProvider.refresh();

      expect(fired).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should dispose without errors', () => {
      expect(() => entitiesProvider.dispose()).not.toThrow();
    });
  });

  describe('index path', () => {
    it('should call readIndex with correct path', async () => {
      mockReadIndex.mockResolvedValue([]);

      await entitiesProvider.getChildren();

      expect(mockReadIndex).toHaveBeenCalledWith(
        join(WORKSPACE, 'wiki', 'index.md'),
      );
    });
  });
});
