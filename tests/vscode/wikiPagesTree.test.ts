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

vi.mock('@llmwiki/shared', () => ({
  readIndex: vi.fn(),
}));

import {
  WikiPagesTreeDataProvider,
  WikiTreeItem,
} from '../../packages/vscode/src/wikiPagesTree';
import { readIndex } from '@llmwiki/shared';
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
  let provider: WikiPagesTreeDataProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new WikiPagesTreeDataProvider(WORKSPACE);
  });

  describe('getChildren (root level — categories)', () => {
    it('should extract unique categories from index entries', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const categories = await provider.getChildren();

      expect(categories).toHaveLength(3);
      expect(categories[0].label).toBe('Entities');
      expect(categories[1].label).toBe('Concepts');
      expect(categories[2].label).toBe('Sources');
    });

    it('should preserve category order of first appearance', async () => {
      const reorderedEntries = [
        { ...mockEntries[0], category: 'Entities' },
        { ...mockEntries[2], category: 'Concepts' },
        { ...mockEntries[0], category: 'Entities', path: 'entities/dup.md' },
        { ...mockEntries[3], category: 'Sources' },
      ];
      mockReadIndex.mockResolvedValue(reorderedEntries);

      const categories = await provider.getChildren();

      expect(categories).toHaveLength(3);
      expect(categories[0].label).toBe('Entities');
      expect(categories[1].label).toBe('Concepts');
      expect(categories[2].label).toBe('Sources');
    });

    it('should return empty array for empty index', async () => {
      mockReadIndex.mockResolvedValue([]);

      const categories = await provider.getChildren();

      expect(categories).toEqual([]);
    });
  });

  describe('getChildren (category level — pages)', () => {
    it('should return pages grouped under the correct category', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      // First get category items
      const categories = await provider.getChildren();
      const entitiesCategory = categories[0];

      // Then get pages for Entities category
      mockReadIndex.mockResolvedValue(mockEntries);
      const pages = await provider.getChildren(entitiesCategory);

      expect(pages).toHaveLength(2);
      expect(pages[0].label).toBe('Alan Turing');
      expect(pages[1].label).toBe('Claude Shannon');
    });

    it('should return empty array for non-category element', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const categories = await provider.getChildren();
      const entitiesCategory = categories[0];

      mockReadIndex.mockResolvedValue(mockEntries);
      const pages = await provider.getChildren(entitiesCategory);

      // A page item should return empty children
      const children = await provider.getChildren(pages[0]);
      expect(children).toEqual([]);
    });
  });

  describe('WikiTreeItem properties — category items', () => {
    it('should have correct properties for category items', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const categories = await provider.getChildren();
      const categoryItem = categories[0];

      expect(categoryItem.contextValue).toBe('category');
      expect(categoryItem.collapsibleState).toBe(1); // Collapsed
      expect(categoryItem.iconPath).toBeDefined();
      expect((categoryItem.iconPath as { id: string }).id).toBe('folder');
    });
  });

  describe('WikiTreeItem properties — page items', () => {
    it('should have correct properties for page items', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const categories = await provider.getChildren();
      mockReadIndex.mockResolvedValue(mockEntries);
      const pages = await provider.getChildren(categories[0]);

      const pageItem = pages[0];

      expect(pageItem.label).toBe('Alan Turing');
      expect(pageItem.description).toBe('Father of CS');
      expect(pageItem.contextValue).toBe('page');
      expect(pageItem.collapsibleState).toBe(0); // None
      expect((pageItem.iconPath as { id: string }).id).toBe('file-text');
    });

    it('should have command that opens the file with correct URI', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const categories = await provider.getChildren();
      mockReadIndex.mockResolvedValue(mockEntries);
      const pages = await provider.getChildren(categories[0]);

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

      const categories = await provider.getChildren();
      mockReadIndex.mockResolvedValue(mockEntries);
      const pages = await provider.getChildren(categories[0]);

      const expectedPath = join(WORKSPACE, 'wiki', 'entities/alan-turing.md');
      expect((pages[0] as WikiTreeItem & { pagePath: string }).pagePath).toBe(
        expectedPath,
      );
    });
  });

  describe('getTreeItem', () => {
    it('should return the element as-is', async () => {
      mockReadIndex.mockResolvedValue(mockEntries);

      const categories = await provider.getChildren();
      const item = categories[0];

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
  });

  describe('index path', () => {
    it('should call readIndex with correct path', async () => {
      mockReadIndex.mockResolvedValue([]);

      await provider.getChildren();

      expect(mockReadIndex).toHaveBeenCalledWith(
        join(WORKSPACE, 'wiki', 'index.md'),
      );
    });
  });
});
