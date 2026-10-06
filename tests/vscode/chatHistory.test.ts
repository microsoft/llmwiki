import { describe, it, expect } from 'vitest';
import { historyToMessages } from '../../packages/vscode/src/chatHistory';

describe('historyToMessages', () => {
  it('keeps interleaved user and assistant turns in their original order', () => {
    const messages = historyToMessages([
      { role: 'user', text: 'A' },
      { role: 'assistant', text: 'B' },
      { role: 'user', text: 'C' },
    ]);

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages.map((message) => message.text)).toEqual(['A', 'B', 'C']);
  });

  it('drops assistant turns whose text is empty', () => {
    const messages = historyToMessages([
      { role: 'user', text: 'A' },
      { role: 'assistant', text: '' },
      { role: 'user', text: 'C' },
    ]);

    expect(messages).toEqual([
      { role: 'user', text: 'A' },
      { role: 'user', text: 'C' },
    ]);
  });

  it('returns an empty array when history is empty', () => {
    expect(historyToMessages([])).toEqual([]);
  });
});
