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
  listSources: vi.fn(),
}));

import {
  RawSourcesTreeDataProvider,
  RawSourceTreeItem,
} from '../../packages/vscode/src/rawSourcesTree';
import { listSources } from '@llmwiki/shared';
import { join } from 'node:path';

const mockListSources = listSources as Mock;

const WORKSPACE = '/test/workspace';
const RAW_DIR = join(WORKSPACE, 'raw');

const mockSources = [
  {
    name: 'paper.pdf',
    path: 'paper.pdf',
    size: 1536,
    modified: '2024-06-15T10:30:00.000Z',
    extension: '.pdf',
  },
  {
    name: 'notes.txt',
    path: 'notes.txt',
    size: 256,
    modified: '2024-07-01T08:00:00.000Z',
    extension: '.txt',
  },
  {
    name: 'chapter1.md',
    path: 'books/chapter1.md',
    size: 4096,
    modified: '2024-05-20T14:00:00.000Z',
    extension: '.md',
  },
  {
    name: 'chapter2.md',
    path: 'books/chapter2.md',
    size: 2048000,
    modified: '2024-05-21T09:00:00.000Z',
    extension: '.md',
  },
];

describe('RawSourcesTreeDataProvider', () => {
  let provider: RawSourcesTreeDataProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RawSourcesTreeDataProvider(WORKSPACE);
  });

  describe('getChildren (root level)', () => {
    it('should return root files and directory groups', async () => {
      mockListSources.mockResolvedValue(mockSources);

      const items = await provider.getChildren();

      // Should have 1 directory (books) + 2 root files
      expect(items).toHaveLength(3);
      expect(items[0].label).toBe('books');
      expect(items[0].isDirectory).toBe(true);
      expect(items[1].label).toBe('paper.pdf');
      expect(items[2].label).toBe('notes.txt');
    });

    it('should return a placeholder drop-zone item when no sources exist', async () => {
      mockListSources.mockResolvedValue([]);

      const items = await provider.getChildren();

      expect(items).toHaveLength(1);
      expect(items[0].contextValue).toBe('rawSourcePlaceholder');
      expect(items[0].label).toBe('No sources yet');
      expect(items[0].command?.command).toBe('llmwiki.ingest');
    });

    it('should return only root files when no subdirs exist', async () => {
      mockListSources.mockResolvedValue([mockSources[0], mockSources[1]]);

      const items = await provider.getChildren();

      expect(items).toHaveLength(2);
      expect(items.every((i) => !i.isDirectory)).toBe(true);
    });

    it('should call listSources with correct raw directory path', async () => {
      mockListSources.mockResolvedValue([]);

      await provider.getChildren();

      expect(mockListSources).toHaveBeenCalledWith(RAW_DIR);
    });
  });

  describe('getChildren (directory level)', () => {
    it('should return files inside the directory', async () => {
      mockListSources.mockResolvedValue(mockSources);

      const root = await provider.getChildren();
      const booksDir = root[0];

      mockListSources.mockResolvedValue(mockSources);
      const children = await provider.getChildren(booksDir);

      expect(children).toHaveLength(2);
      expect(children[0].label).toBe('chapter1.md');
      expect(children[1].label).toBe('chapter2.md');
    });

    it('should return empty for a file item', async () => {
      mockListSources.mockResolvedValue(mockSources);

      const root = await provider.getChildren();
      const fileItem = root[1]; // paper.pdf

      mockListSources.mockResolvedValue(mockSources);
      const children = await provider.getChildren(fileItem);

      expect(children).toEqual([]);
    });
  });

  describe('RawSourceTreeItem properties — file items', () => {
    it('should have correct label, description, contextValue', async () => {
      mockListSources.mockResolvedValue([mockSources[0]]);

      const items = await provider.getChildren();
      const item = items[0];

      expect(item.label).toBe('paper.pdf');
      expect(item.contextValue).toBe('rawSource');
      expect(item.description).toBe('1.5 KB • 2024-06-15');
      expect((item.iconPath as { id: string }).id).toBe('file');
    });

    it('should have command that opens the file', async () => {
      mockListSources.mockResolvedValue([mockSources[0]]);

      const items = await provider.getChildren();
      const item = items[0];

      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('vscode.open');
      expect(item.command!.title).toBe('Open Source');
      const expectedPath = join(RAW_DIR, 'paper.pdf');
      expect((item.command!.arguments![0] as { fsPath: string }).fsPath).toBe(expectedPath);
    });

    it('should store filePath on file items', async () => {
      mockListSources.mockResolvedValue([mockSources[0]]);

      const items = await provider.getChildren();
      const item = items[0] as RawSourceTreeItem;

      expect(item.filePath).toBe(join(RAW_DIR, 'paper.pdf'));
    });
  });

  describe('RawSourceTreeItem properties — directory items', () => {
    it('should have correct contextValue and icon', async () => {
      mockListSources.mockResolvedValue(mockSources);

      const items = await provider.getChildren();
      const dirItem = items[0];

      expect(dirItem.contextValue).toBe('rawSourceDir');
      expect(dirItem.isDirectory).toBe(true);
      expect((dirItem.iconPath as { id: string }).id).toBe('folder');
      expect(dirItem.collapsibleState).toBe(1); // Collapsed
    });
  });

  describe('size formatting', () => {
    it('should format bytes correctly', async () => {
      mockListSources.mockResolvedValue([
        { name: 'tiny.txt', path: 'tiny.txt', size: 42, modified: '2024-01-01T00:00:00.000Z', extension: '.txt' },
      ]);

      const items = await provider.getChildren();
      expect(items[0].description).toBe('42 B • 2024-01-01');
    });

    it('should format kilobytes correctly', async () => {
      mockListSources.mockResolvedValue([
        { name: 'small.txt', path: 'small.txt', size: 1536, modified: '2024-01-01T00:00:00.000Z', extension: '.txt' },
      ]);

      const items = await provider.getChildren();
      expect(items[0].description).toBe('1.5 KB • 2024-01-01');
    });

    it('should format megabytes correctly', async () => {
      mockListSources.mockResolvedValue([
        { name: 'big.bin', path: 'big.bin', size: 2048000, modified: '2024-01-01T00:00:00.000Z', extension: '.bin' },
      ]);

      const items = await provider.getChildren();
      expect(items[0].description).toBe('2.0 MB • 2024-01-01');
    });
  });

  describe('getTreeItem', () => {
    it('should return the element as-is', async () => {
      mockListSources.mockResolvedValue([mockSources[0]]);

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
  });
});
