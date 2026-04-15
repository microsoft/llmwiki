import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

export class CopilotCliError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_INSTALLED' | 'NOT_AUTHENTICATED' | 'EXEC_FAILED',
  ) {
    super(message);
    this.name = 'CopilotCliError';
  }
}

/**
 * Execute a command, handling Windows .bat/.cmd shims by routing through cmd.exe.
 */
async function execCommand(
  bin: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === 'win32') {
    // On Windows, .bat/.cmd shims can't be called directly via execFile.
    // Use cmd.exe /c which resolves PATH and handles .bat/.cmd properly.
    return execFileAsync('cmd.exe', ['/c', bin, ...args], options);
  }
  return execFileAsync(bin, args, options);
}

/**
 * Resolve the path to the `copilot` binary.
 * Throws CopilotCliError if not found.
 */
async function resolveCopilotBinary(): Promise<string> {
  try {
    await execCommand('copilot', ['--version'], { timeout: 10_000 });
    return 'copilot';
  } catch {
    throw new CopilotCliError(
      'GitHub Copilot CLI is not installed or not on PATH. Install: npm install -g @github/copilot',
      'NOT_INSTALLED',
    );
  }
}

export interface CopilotCliOptions {
  /** Maximum time in ms to wait for the Copilot CLI response. Default: 120_000 */
  timeout?: number;
  /** Additional CLI flags (e.g. --model). */
  extraArgs?: string[];
}

/**
 * Run a prompt through the GitHub Copilot CLI programmatically.
 *
 * Uses `copilot -p "<prompt>" -s --no-ask-user` for non-interactive,
 * clean text output.
 *
 * @see https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically
 */
export async function runCopilotCli(
  prompt: string,
  options: CopilotCliOptions = {},
): Promise<string> {
  const { timeout = 120_000, extraArgs = [] } = options;

  const bin = await resolveCopilotBinary();

  // Write prompt to a temp file — avoids cmd.exe ~8191 char command line limit
  const promptFile = join(tmpdir(), `copilot-prompt-${randomUUID()}.txt`);
  writeFileSync(promptFile, prompt, 'utf-8');

  const args = [
    '-p', `@${promptFile}`,
    '-s',              // silent mode — no session metadata
    '--no-ask-user',   // don't prompt for clarification
    '--allow-all',     // auto-approve tools so it doesn't hang
    '--no-custom-instructions', // skip AGENTS.md loading
    ...extraArgs,
  ];

  try {
    const { stdout, stderr } = await execCommand(bin, args, {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });

    if (stderr) {
      // Copilot CLI may emit warnings on stderr; log but don't fail
      process.stderr.write(`[copilot-cli] ${stderr}\n`);
    }

    return stdout.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ETIMEDOUT') || msg.includes('timed out')) {
      throw new CopilotCliError(
        `Copilot CLI timed out after ${timeout / 1000}s`,
        'EXEC_FAILED',
      );
    }
    if (msg.includes('auth') || msg.includes('401') || msg.includes('403')) {
      throw new CopilotCliError(
        'GitHub Copilot CLI is not authenticated. Run: copilot auth login',
        'NOT_AUTHENTICATED',
      );
    }
    throw new CopilotCliError(`Copilot CLI failed: ${msg}`, 'EXEC_FAILED');
  } finally {
    try { unlinkSync(promptFile); } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Check whether the Copilot CLI is available and authenticated.
 * Returns true if ready, false otherwise.
 */
export async function isCopilotCliAvailable(): Promise<boolean> {
  try {
    await resolveCopilotBinary();
    return true;
  } catch {
    return false;
  }
}
