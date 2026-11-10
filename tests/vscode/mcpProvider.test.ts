import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('vscode', () => {
  class McpStdioServerDefinition {
    cwd?: { fsPath: string };
    constructor(
      public label: string,
      public command: string,
      public args: string[],
      public env: Record<string, string | number | null>,
      public version?: string,
    ) {}
  }
  class EventEmitter {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  }
  return {
    McpStdioServerDefinition,
    EventEmitter,
    Uri: { file: (fsPath: string) => ({ fsPath, scheme: 'file' }) },
    lm: { registerMcpServerDefinitionProvider: vi.fn(() => ({ dispose: vi.fn() })) },
  };
});

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));
vi.mock('@llmwiki/core', () => ({ WIKI_DIR_NAME: '.wiki' }));

import * as vscode from 'vscode';
import {
  createLlmWikiServerDefinition,
  registerMcpServerProvider,
} from '../../packages/vscode/src/mcpProvider';

const outputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel;

function makeContext() {
  return {
    subscriptions: [] as Array<{ dispose: () => void }>,
    asAbsolutePath: (p: string) => `/ext/${p.replace(/\\/g, '/')}`,
    extension: { packageJSON: { version: '9.9.9' } },
  } as unknown as vscode.ExtensionContext;
}

describe('createLlmWikiServerDefinition', () => {
  it('runs the bundled launcher with the editor binary in Node mode', () => {
    const def = createLlmWikiServerDefinition('/ext/out/mcp-server.cjs', '/ws/.wiki', '/ws', '1.2.3');

    expect(def.label).toBe('LLM Wiki');
    expect(def.command).toBe(process.execPath);
    expect(def.args).toEqual(['/ext/out/mcp-server.cjs', '/ws/.wiki']);
    expect(def.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(def.version).toBe('1.2.3');
    expect(def.cwd?.fsPath).toBe('/ws');
  });
});

describe('registerMcpServerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a provider that serves the llmwiki definition', async () => {
    const context = makeContext();

    const disposable = registerMcpServerProvider(context, '/ws', outputChannel);

    expect(disposable).toBeDefined();
    const register = vscode.lm.registerMcpServerDefinitionProvider as unknown as Mock;
    expect(register).toHaveBeenCalledWith('llmwiki', expect.any(Object));
    const provider = register.mock.calls[0][1] as vscode.McpServerDefinitionProvider;
    const defs = (await provider.provideMcpServerDefinitions(
      {} as vscode.CancellationToken,
    )) as vscode.McpStdioServerDefinition[];
    expect(defs).toHaveLength(1);
    expect(defs[0].args[0]).toBe('/ext/out/mcp-server.cjs');
    expect(defs[0].args[1].replace(/\\/g, '/')).toBe('/ws/.wiki');
    expect(defs[0].env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(defs[0].version).toBe('9.9.9');
  });

  it('skips registration when the MCP API is unavailable', () => {
    const lm = vscode.lm as unknown as Record<string, unknown>;
    const original = lm.registerMcpServerDefinitionProvider;
    lm.registerMcpServerDefinitionProvider = undefined;
    try {
      expect(registerMcpServerProvider(makeContext(), '/ws', outputChannel)).toBeUndefined();
      expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
    } finally {
      lm.registerMcpServerDefinitionProvider = original;
    }
  });
});
