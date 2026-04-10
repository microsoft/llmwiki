import { Command } from 'commander';
import { lintWiki, lintFix, type LintResult, type LintFixResult } from '@llmwiki/shared';

/**
 * Format lint result as human-readable output.
 */
function formatLintOutput(result: LintResult): string {
  const lines: string[] = [];

  if (result.findings.length === 0) {
    lines.push('✓ No lint issues found');
    return lines.join('\n');
  }

  const severityIcon: Record<string, string> = {
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
  };

  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  const infos = result.findings.filter((f) => f.severity === 'info');

  for (const group of [errors, warnings, infos]) {
    for (const finding of group) {
      const icon = severityIcon[finding.severity];
      lines.push(`${icon} [${finding.category}] ${finding.message}`);
    }
  }

  lines.push('');
  const parts: string[] = [];
  if (result.errorCount > 0) parts.push(`${result.errorCount} error(s)`);
  if (result.warningCount > 0) parts.push(`${result.warningCount} warning(s)`);
  if (result.infoCount > 0) parts.push(`${result.infoCount} info(s)`);
  lines.push(`Summary: ${parts.join(', ')}`);

  return lines.join('\n');
}

/**
 * Format lint-fix result as human-readable output.
 */
function formatLintFixOutput(result: LintFixResult): string {
  const lines: string[] = [];

  if (result.fixedCount > 0) {
    lines.push(`✓ Fixed ${result.fixedCount} issue(s):`);
    for (const finding of result.fixed) {
      lines.push(`  ✓ [${finding.category}] ${finding.message}`);
    }
  } else {
    lines.push('✓ No auto-fixable issues found');
  }

  if (result.remaining.length > 0) {
    lines.push('');
    lines.push(`Remaining issues (${result.remaining.length}):`);
    const severityIcon: Record<string, string> = {
      error: '✗',
      warning: '⚠',
      info: 'ℹ',
    };
    for (const finding of result.remaining) {
      const icon = severityIcon[finding.severity];
      lines.push(`  ${icon} [${finding.category}] ${finding.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Register the `lint` subcommand on the wiki command group.
 */
export function registerLintCommand(wiki: Command): void {
  wiki
    .command('lint')
    .description('Run health checks on the wiki knowledge base')
    .option('--path <dir>', 'Target directory', '.')
    .option('--category <categories>', 'Comma-separated list of check categories to run')
    .option('--fix', 'Automatically fix deterministic lint issues')
    .option('--fix-orphans', 'Include orphan pages in auto-fix (adds to index)')
    .action(async (options: { path: string; category?: string; fix?: boolean; fixOrphans?: boolean }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;

      if (options.fix) {
        const result = await lintFix(options.path, {
          fixOrphans: options.fixOrphans,
        });

        if (jsonMode) {
          console.log(JSON.stringify(result));
        } else {
          console.log(formatLintFixOutput(result));
        }

        const remainingErrors = result.remaining.filter((f) => f.severity === 'error');
        if (remainingErrors.length > 0) {
          process.exitCode = 1;
        }
      } else {
        const categories = options.category
          ? options.category.split(',').map((c) => c.trim())
          : undefined;

        const result = await lintWiki(options.path, categories);

        if (jsonMode) {
          console.log(JSON.stringify(result));
        } else {
          console.log(formatLintOutput(result));
        }

        if (result.errorCount > 0) {
          process.exitCode = 1;
        }
      }
    });
}
