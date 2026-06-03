import * as vscode from 'vscode';
import { join } from 'node:path';
import type { LintFinding } from '@llmwiki/core';

function severityIcon(severity: 'error' | 'warning' | 'info'): vscode.ThemeIcon {
  return new vscode.ThemeIcon(severity);
}

function severityLabel(severity: 'error' | 'warning' | 'info'): string {
  switch (severity) {
    case 'error': return 'Errors';
    case 'warning': return 'Warnings';
    case 'info': return 'Info';
  }
}

export class LintFindingTreeItem extends vscode.TreeItem {
  readonly severity?: 'error' | 'warning' | 'info';

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      severity?: 'error' | 'warning' | 'info';
      count?: number;
      finding?: LintFinding;
      fullPath?: string;
      message?: boolean;
    },
  ) {
    super(label, collapsibleState);

    if (options?.severity && options.count !== undefined) {
      // Severity group item
      this.contextValue = 'severityGroup';
      this.label = severityLabel(options.severity);
      this.description = String(options.count);
      this.iconPath = severityIcon(options.severity);
      this.severity = options.severity;
    } else if (options?.finding) {
      // Finding item
      this.contextValue = 'lintFinding';
      this.label = options.finding.message;
      this.description = options.finding.file;
      this.iconPath = severityIcon(options.finding.severity);
      if (options.fullPath) {
        this.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(options.fullPath)],
        };
      }
    } else if (options?.message) {
      // Message item
      this.contextValue = 'message';
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}

export class LintFindingsTreeDataProvider
  implements vscode.TreeDataProvider<LintFindingTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    LintFindingTreeItem | undefined | null | void
  >();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _findings: LintFinding[] = [];

  constructor(private readonly workspaceFolder: string) {}

  getTreeItem(element: LintFindingTreeItem): LintFindingTreeItem {
    return element;
  }

  async getChildren(element?: LintFindingTreeItem): Promise<LintFindingTreeItem[]> {
    if (element === undefined) {
      if (this._findings.length === 0) {
        return [
          new LintFindingTreeItem(
            'Run lint to check wiki health',
            vscode.TreeItemCollapsibleState.None,
            { message: true },
          ),
        ];
      }

      const severities: Array<'error' | 'warning' | 'info'> = ['error', 'warning', 'info'];
      const groups: LintFindingTreeItem[] = [];

      for (const severity of severities) {
        const count = this._findings.filter((f) => f.severity === severity).length;
        if (count > 0) {
          groups.push(
            new LintFindingTreeItem(
              severityLabel(severity),
              vscode.TreeItemCollapsibleState.Collapsed,
              { severity, count },
            ),
          );
        }
      }

      return groups;
    }

    if (element.contextValue === 'severityGroup') {
      return this._findings
        .filter((f) => f.severity === element.severity)
        .map(
          (finding) =>
            new LintFindingTreeItem(
              finding.message,
              vscode.TreeItemCollapsibleState.None,
              {
                finding,
                fullPath: finding.file ? join(this.workspaceFolder, 'wiki', finding.file) : undefined,
              },
            ),
        );
    }

    return [];
  }

  setFindings(findings: LintFinding[]): void {
    this._findings = findings;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
