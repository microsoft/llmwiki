import { describe, it, expect } from 'vitest';
import { createProgram } from '../../../packages/cli/src/cli.js';

describe('CLI', () => {
  it('should show version with --version', () => {
    const program = createProgram();
    expect(program.version()).toBeDefined();
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should have wiki command', () => {
    const program = createProgram();
    const wiki = program.commands.find(cmd => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();
  });

  it('wiki command should have --json option', () => {
    const program = createProgram();
    const wiki = program.commands.find(cmd => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();
    const jsonOption = wiki!.options.find(opt => opt.long === '--json');
    expect(jsonOption).toBeDefined();
  });

  it('wiki command should have all 5 subcommands', () => {
    const program = createProgram();
    const wiki = program.commands.find(cmd => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();

    const expectedCommands = ['init', 'ingest', 'query', 'lint', 'status'];
    const actualCommands = wiki!.commands.map(cmd => cmd.name());

    for (const expected of expectedCommands) {
      expect(actualCommands).toContain(expected);
    }
  });

  it('plaid wiki --help should list all subcommands', () => {
    const program = createProgram();
    const wiki = program.commands.find(cmd => cmd.name() === 'wiki');
    expect(wiki).toBeDefined();

    const helpText = wiki!.helpInformation();
    expect(helpText).toContain('init');
    expect(helpText).toContain('ingest');
    expect(helpText).toContain('query');
    expect(helpText).toContain('lint');
    expect(helpText).toContain('status');
    expect(helpText).toContain('--json');
  });

  it('plaid --help should show wiki command', () => {
    const program = createProgram();
    const helpText = program.helpInformation();
    expect(helpText).toContain('wiki');
  });
});
