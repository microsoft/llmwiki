import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
// js-yaml is a transitive dependency via gray-matter
import yaml from 'js-yaml';

const WORKFLOW_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'ingest.yml',
);

describe('ingest workflow YAML', () => {
  let content: string;
  let workflow: Record<string, unknown>;

  // Load and parse once
  it('should be valid YAML', async () => {
    content = await readFile(WORKFLOW_PATH, 'utf-8');
    workflow = yaml.load(content) as Record<string, unknown>;
    expect(workflow).toBeDefined();
    expect(typeof workflow).toBe('object');
  });

  it('should have a name', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;
    expect(workflow.name).toBe('Auto-Ingest');
  });

  it('should trigger on push to raw/** paths', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const on = workflow.on as Record<string, unknown>;
    expect(on).toBeDefined();

    const push = on.push as Record<string, unknown>;
    expect(push).toBeDefined();
    expect(push.paths).toEqual(expect.arrayContaining(['raw/**']));
  });

  it('should support workflow_dispatch', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const on = workflow.on as Record<string, unknown>;
    expect(on).toHaveProperty('workflow_dispatch');
  });

  it('should set up Node.js 20', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const jobs = workflow.jobs as Record<string, unknown>;
    const ingest = jobs.ingest as Record<string, unknown>;
    const steps = ingest.steps as Array<Record<string, unknown>>;

    const nodeStep = steps.find(
      (s) => s.uses && (s.uses as string).startsWith('actions/setup-node'),
    );
    expect(nodeStep).toBeDefined();
    expect((nodeStep!.with as Record<string, unknown>)['node-version']).toBe(20);
  });

  it('should run npm ci', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const jobs = workflow.jobs as Record<string, unknown>;
    const ingest = jobs.ingest as Record<string, unknown>;
    const steps = ingest.steps as Array<Record<string, unknown>>;

    const npmCiStep = steps.find((s) => s.run && (s.run as string).includes('npm ci'));
    expect(npmCiStep).toBeDefined();
  });

  it('should build the CLI', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const jobs = workflow.jobs as Record<string, unknown>;
    const ingest = jobs.ingest as Record<string, unknown>;
    const steps = ingest.steps as Array<Record<string, unknown>>;

    const buildStep = steps.find((s) => s.run && (s.run as string).includes('npm run build'));
    expect(buildStep).toBeDefined();
  });

  it('should detect changed files using git diff', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const jobs = workflow.jobs as Record<string, unknown>;
    const ingest = jobs.ingest as Record<string, unknown>;
    const steps = ingest.steps as Array<Record<string, unknown>>;

    const diffStep = steps.find(
      (s) => s.run && (s.run as string).includes('git diff'),
    );
    expect(diffStep).toBeDefined();
    expect((diffStep!.run as string)).toContain('raw/');
  });

  it('should run ingest for each changed file', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const jobs = workflow.jobs as Record<string, unknown>;
    const ingest = jobs.ingest as Record<string, unknown>;
    const steps = ingest.steps as Array<Record<string, unknown>>;

    const ingestStep = steps.find(
      (s) => s.run && (s.run as string).includes('dist/cli.js wiki ingest'),
    );
    expect(ingestStep).toBeDefined();
  });

  it('should use stefanzweifel/git-auto-commit-action@v5', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const jobs = workflow.jobs as Record<string, unknown>;
    const ingest = jobs.ingest as Record<string, unknown>;
    const steps = ingest.steps as Array<Record<string, unknown>>;

    const commitStep = steps.find(
      (s) => s.uses && (s.uses as string).includes('stefanzweifel/git-auto-commit-action@v5'),
    );
    expect(commitStep).toBeDefined();
  });

  it('should use bot user identity for commits', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const jobs = workflow.jobs as Record<string, unknown>;
    const ingest = jobs.ingest as Record<string, unknown>;
    const steps = ingest.steps as Array<Record<string, unknown>>;

    const commitStep = steps.find(
      (s) => s.uses && (s.uses as string).includes('git-auto-commit-action'),
    );
    expect(commitStep).toBeDefined();
    const withConfig = commitStep!.with as Record<string, unknown>;
    expect(withConfig.commit_user_name).toContain('github-actions[bot]');
    expect(withConfig.commit_user_email).toContain('github-actions[bot]');
  });

  it('should use GITHUB_TOKEN (not PAT) — permissions.contents set', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const permissions = workflow.permissions as Record<string, unknown>;
    expect(permissions).toBeDefined();
    expect(permissions.contents).toBe('write');

    // Ensure no PAT reference
    expect(content).not.toContain('PAT');
    expect(content).not.toContain('PERSONAL_ACCESS_TOKEN');
  });

  it('should checkout with fetch-depth 0 for full git diff history', async () => {
    content ??= await readFile(WORKFLOW_PATH, 'utf-8');
    workflow ??= yaml.load(content) as Record<string, unknown>;

    const jobs = workflow.jobs as Record<string, unknown>;
    const ingest = jobs.ingest as Record<string, unknown>;
    const steps = ingest.steps as Array<Record<string, unknown>>;

    const checkoutStep = steps.find(
      (s) => s.uses && (s.uses as string).startsWith('actions/checkout'),
    );
    expect(checkoutStep).toBeDefined();
    expect((checkoutStep!.with as Record<string, unknown>)['fetch-depth']).toBe(0);
  });
});
