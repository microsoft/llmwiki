export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Map ordered chat turns into model messages.
 *
 * Walks the turns in the order they happened. Assistant turns whose text is
 * an empty string are dropped; whitespace-only text is kept. User turns are
 * always kept.
 */
export function historyToMessages(turns: readonly HistoryTurn[]): HistoryTurn[] {
  const messages: HistoryTurn[] = [];
  for (const turn of turns) {
    if (turn.role === 'assistant' && turn.text.length === 0) {
      continue;
    }
    messages.push({ role: turn.role, text: turn.text });
  }
  return messages;
}
