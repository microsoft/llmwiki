import * as vscode from 'vscode';

const CONFIG_SECTION = 'llmwiki';
const MODEL_FAMILY_KEY = 'modelFamily';

/**
 * Read the user's preferred Copilot model family from the `llmwiki.modelFamily`
 * setting. Returns `undefined` when the setting is empty / whitespace-only,
 * which signals "use any available Copilot model".
 */
export function getConfiguredModelFamily(): string | undefined {
  const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(MODEL_FAMILY_KEY);
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the Copilot chat model to use.
 *
 * Tries the configured family first (default `claude-opus-4.6`), then falls
 * back to any available Copilot model. Returns `undefined` if no Copilot
 * model is available at all.
 *
 * @param outputChannel Optional channel used for diagnostic logging.
 */
export async function selectPreferredModel(
  outputChannel?: vscode.OutputChannel,
): Promise<vscode.LanguageModelChat | undefined> {
  const family = getConfiguredModelFamily();

  if (family) {
    try {
      const preferred = await vscode.lm.selectChatModels({ vendor: 'copilot', family });
      if (preferred.length > 0) {
        outputChannel?.appendLine(`[model] Using configured model: ${preferred[0].family}`);
        return preferred[0];
      }
      outputChannel?.appendLine(
        `[model] Configured family "${family}" is not available — falling back to any Copilot model`,
      );
    } catch (err) {
      outputChannel?.appendLine(`[model] selectChatModels failed for "${family}": ${String(err)}`);
    }
  }

  try {
    const fallback = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (fallback.length > 0) {
      outputChannel?.appendLine(`[model] Using fallback model: ${fallback[0].family}`);
      return fallback[0];
    }
  } catch (err) {
    outputChannel?.appendLine(`[model] Fallback selectChatModels failed: ${String(err)}`);
  }

  outputChannel?.appendLine('[model] No Copilot model available');
  return undefined;
}

/**
 * Show a QuickPick of every Copilot model currently installed for the user
 * and persist the selection to `llmwiki.modelFamily`. The currently
 * configured family is marked with a check icon.
 *
 * Includes an "(Any available model)" entry that clears the setting.
 */
export async function selectModelInteractively(
  outputChannel?: vscode.OutputChannel,
): Promise<void> {
  let models: readonly vscode.LanguageModelChat[];
  try {
    models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  } catch (err) {
    vscode.window.showErrorMessage(`LLM Wiki: Could not list Copilot models — ${String(err)}`);
    return;
  }

  if (models.length === 0) {
    vscode.window.showWarningMessage(
      'LLM Wiki: No Copilot chat models are available. Make sure GitHub Copilot is installed and signed in.',
    );
    return;
  }

  const current = getConfiguredModelFamily();

  // De-duplicate by family — a single family may surface multiple versions.
  const seen = new Set<string>();
  const uniqueFamilies = models
    .filter((m) => {
      if (seen.has(m.family)) return false;
      seen.add(m.family);
      return true;
    })
    .sort((a, b) => a.family.localeCompare(b.family));

  type Item = vscode.QuickPickItem & { family: string | undefined };

  const items: Item[] = [
    {
      label: '$(sparkle) (Any available model)',
      description: current === undefined ? 'Current' : undefined,
      detail: 'Use whichever Copilot model is available; do not pin a family.',
      family: undefined,
    },
    ...uniqueFamilies.map<Item>((m) => ({
      label: m.family === current ? `$(check) ${m.family}` : m.family,
      description: [m.name, m.vendor].filter(Boolean).join(' • '),
      detail: `Max input tokens: ${m.maxInputTokens.toLocaleString()}`,
      family: m.family,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'LLM Wiki: Select Model',
    placeHolder: current
      ? `Currently using: ${current}`
      : 'Currently using: any available Copilot model',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) return; // user cancelled

  // Ask which scope to save into when a workspace is open; otherwise default to Global.
  let target = vscode.ConfigurationTarget.Global;
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const scope = await vscode.window.showQuickPick(
      [
        { label: 'User (global)', target: vscode.ConfigurationTarget.Global },
        { label: 'Workspace', target: vscode.ConfigurationTarget.Workspace },
      ],
      { title: 'Save selection to…', placeHolder: 'Where should this setting be saved?' },
    );
    if (!scope) return;
    target = scope.target;
  }

  // Empty string clears the setting (so the default kicks back in for the
  // "any model" case).
  const newValue = picked.family ?? '';
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(MODEL_FAMILY_KEY, newValue, target);

  const summary = picked.family
    ? `LLM Wiki: Model set to ${picked.family}`
    : 'LLM Wiki: Model preference cleared — using any available Copilot model';
  outputChannel?.appendLine(`[model] ${summary}`);
  vscode.window.showInformationMessage(summary);
}
