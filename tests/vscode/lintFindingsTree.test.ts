import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import {
  LintFindingsTreeDataProvider,
  LintFindingTreeItem,
} from '../../packages/vscode/src/lintFindingsTree';
import type { LintFinding } from '@llmwiki/core';
import { join } from 'node:path';

const WORKSPACE = '/test/workspace';

const mockFindings: LintFinding[] = [
  {
    severity: 'error',
    category: 'broken-link',
    message: 'Broken link to missing-page.md',
    file: 'concepts/ai.md',
  },
  {
    severity: 'error',
    category: 'broken-link',
    message: 'Broken link to gone.md',
    file: 'entities/turing.md',
  },
  {
    severity: 'warning',
    category: 'missing-backlinks',
    message: 'Page has no incoming links',
    file: 'topics/obscure.md',
  },
  {
    severity: 'info',
    category: 'style',
    message: 'Consider adding a summary section',
  },
];

describe('LintFindingsTreeDataProvider', () => {
  let provider: LintFindingsTreeDataProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LintFindingsTreeDataProvider(WORKSPACE);
  });

  describe('getChildren (root level — empty findings)', () => {
    it('should return guidance message when no findings exist', async () => {
      const items = await provider.getChildren();

      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('Run lint to check wiki health');
      expect(items[0].contextValue).toBe('message');
      expect((items[0].iconPath as { id: string }).id).toBe('info');
      expect(items[0].command).toBeUndefined();
    });
  });

  describe('getChildren (root level — severity groups)', () => {
    beforeEach(() => {
      provider.setFindings(mockFindings);
    });

    it('should return severity groups in order: errors, warnings, info', async () => {
      const groups = await provider.getChildren();

      expect(groups).toHaveLength(3);
      expect(groups[0].label).toBe('Errors');
      expect(groups[1].label).toBe('Warnings');
      expect(groups[2].label).toBe('Info');
    });

    it('should set description to count as string', async () => {
      const groups = await provider.getChildren();

      expect(groups[0].description).toBe('2');
      expect(groups[1].description).toBe('1');
      expect(groups[2].description).toBe('1');
    });

    it('should set contextValue to severityGroup', async () => {
      const groups = await provider.getChildren();

      for (const group of groups) {
        expect(group.contextValue).toBe('severityGroup');
      }
    });

    it('should set correct icons for each severity group', async () => {
      const groups = await provider.getChildren();

      expect((groups[0].iconPath as { id: string }).id).toBe('error');
      expect((groups[1].iconPath as { id: string }).id).toBe('warning');
      expect((groups[2].iconPath as { id: string }).id).toBe('info');
    });

    it('should set collapsibleState to Collapsed', async () => {
      const groups = await provider.getChildren();

      for (const group of groups) {
        expect(group.collapsibleState).toBe(1); // Collapsed
      }
    });

    it('should omit severity groups with zero findings', async () => {
      provider.setFindings([
        {
          severity: 'warning',
          category: 'style',
          message: 'Some warning',
          file: 'a.md',
        },
      ]);

      const groups = await provider.getChildren();

      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('Warnings');
    });

    it('should store severity on the group item', async () => {
      const groups = await provider.getChildren();

      expect((groups[0] as LintFindingTreeItem & { severity: string }).severity).toBe('error');
      expect((groups[1] as LintFindingTreeItem & { severity: string }).severity).toBe('warning');
      expect((groups[2] as LintFindingTreeItem & { severity: string }).severity).toBe('info');
    });
  });

  describe('getChildren (severity group level — finding items)', () => {
    beforeEach(() => {
      provider.setFindings(mockFindings);
    });

    it('should return findings filtered by severity under error group', async () => {
      const groups = await provider.getChildren();
      const errorGroup = groups[0];
      const findings = await provider.getChildren(errorGroup);

      expect(findings).toHaveLength(2);
      expect(findings[0].label).toBe('Broken link to missing-page.md');
      expect(findings[1].label).toBe('Broken link to gone.md');
    });

    it('should set description to finding.file', async () => {
      const groups = await provider.getChildren();
      const errorGroup = groups[0];
      const findings = await provider.getChildren(errorGroup);

      expect(findings[0].description).toBe('concepts/ai.md');
      expect(findings[1].description).toBe('entities/turing.md');
    });

    it('should set description to undefined when finding has no file', async () => {
      const groups = await provider.getChildren();
      const infoGroup = groups[2];
      const findings = await provider.getChildren(infoGroup);

      expect(findings[0].description).toBeUndefined();
    });

    it('should set contextValue to lintFinding', async () => {
      const groups = await provider.getChildren();
      const errorGroup = groups[0];
      const findings = await provider.getChildren(errorGroup);

      for (const finding of findings) {
        expect(finding.contextValue).toBe('lintFinding');
      }
    });

    it('should set icon matching the severity', async () => {
      const groups = await provider.getChildren();
      const errorGroup = groups[0];
      const findings = await provider.getChildren(errorGroup);

      expect((findings[0].iconPath as { id: string }).id).toBe('error');
    });

    it('should set command to open file when finding has a file', async () => {
      const groups = await provider.getChildren();
      const errorGroup = groups[0];
      const findings = await provider.getChildren(errorGroup);

      const expectedPath = join(WORKSPACE, 'wiki', 'concepts/ai.md');
      expect(findings[0].command).toBeDefined();
      expect(findings[0].command!.command).toBe('vscode.open');
      expect(findings[0].command!.title).toBe('Open File');
      expect(
        (findings[0].command!.arguments![0] as { fsPath: string }).fsPath,
      ).toBe(expectedPath);
    });

    it('should not set command when finding has no file', async () => {
      const groups = await provider.getChildren();
      const infoGroup = groups[2];
      const findings = await provider.getChildren(infoGroup);

      expect(findings[0].command).toBeUndefined();
    });

    it('should set collapsibleState to None for finding items', async () => {
      const groups = await provider.getChildren();
      const errorGroup = groups[0];
      const findings = await provider.getChildren(errorGroup);

      for (const finding of findings) {
        expect(finding.collapsibleState).toBe(0); // None
      }
    });
  });

  describe('getChildren — non-severityGroup element', () => {
    it('should return empty array for finding items', async () => {
      provider.setFindings(mockFindings);

      const groups = await provider.getChildren();
      const errorGroup = groups[0];
      const findings = await provider.getChildren(errorGroup);
      const children = await provider.getChildren(findings[0]);

      expect(children).toEqual([]);
    });
  });

  describe('getTreeItem', () => {
    it('should return the element as-is', async () => {
      const items = await provider.getChildren();
      const item = items[0];

      expect(provider.getTreeItem(item)).toBe(item);
    });
  });

  describe('setFindings', () => {
    it('should update findings and fire change event', () => {
      let fired = false;
      provider.onDidChangeTreeData(() => {
        fired = true;
      });

      provider.setFindings(mockFindings);

      expect(fired).toBe(true);
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
