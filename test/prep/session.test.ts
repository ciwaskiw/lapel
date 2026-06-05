import { describe, it, expect, vi } from 'vitest';
import { runPrepSession, type PrepTurn } from '../../src/prep/session.js';

/** Build an `ask` that returns each scripted line in order, then null (EOF) forever. */
function scriptedAsk(lines: (string | null)[]): () => Promise<string | null> {
  let i = 0;
  return () => Promise.resolve(i < lines.length ? lines[i++] : null);
}

describe('runPrepSession', () => {
  it('produces an opening coach turn before reading input', async () => {
    const respond = vi.fn().mockResolvedValue('What round is this?');
    const ask = scriptedAsk([null]); // user immediately ends (EOF)
    const say = vi.fn();
    const { transcript } = await runPrepSession({ transcript: [], respond, ask, say });
    expect(respond).toHaveBeenCalledTimes(1);
    expect(transcript).toEqual([{ role: 'coach', text: 'What round is this?' }]);
    expect(say).toHaveBeenCalledWith('What round is this?');
  });

  it('appends candidate input and the coach reply, then ends on exit command', async () => {
    const respond = vi
      .fn()
      .mockResolvedValueOnce('Opening: what round?')
      .mockResolvedValueOnce('Here is how to answer that.');
    const ask = scriptedAsk(['Behavioral with the HM', 'exit']);
    const onTurn = vi.fn();
    const { transcript } = await runPrepSession({
      transcript: [],
      respond,
      ask,
      say: vi.fn(),
      onTurn,
    });
    expect(transcript).toEqual([
      { role: 'coach', text: 'Opening: what round?' },
      { role: 'candidate', text: 'Behavioral with the HM' },
      { role: 'coach', text: 'Here is how to answer that.' },
    ]);
    expect(respond.mock.calls[1][0]).toContainEqual({
      role: 'candidate',
      text: 'Behavioral with the HM',
    });
    expect(onTurn).toHaveBeenCalledTimes(2); // after each coach turn
  });

  it('re-prompts on empty input without calling respond again', async () => {
    const respond = vi.fn().mockResolvedValueOnce('Opening').mockResolvedValueOnce('Real reply');
    const ask = scriptedAsk(['', '   ', 'a real question', null]);
    await runPrepSession({ transcript: [], respond, ask, say: vi.fn() });
    expect(respond).toHaveBeenCalledTimes(2); // opening + the one real question
  });

  it('ends the loop on EOF (null from ask)', async () => {
    const respond = vi.fn().mockResolvedValue('Opening');
    const ask = scriptedAsk([null]);
    const { transcript } = await runPrepSession({ transcript: [], respond, ask, say: vi.fn() });
    expect(transcript).toHaveLength(1);
  });

  it('carries a seeded (resumed) transcript into the opening respond call', async () => {
    const seeded: PrepTurn[] = [
      { role: 'coach', text: 'Earlier coaching' },
      { role: 'candidate', text: 'Earlier answer' },
    ];
    const respond = vi.fn().mockResolvedValue('Welcome back — last time we covered...');
    const ask = scriptedAsk([null]);
    const { transcript } = await runPrepSession({
      transcript: seeded,
      respond,
      ask,
      say: vi.fn(),
    });
    expect(respond.mock.calls[0][0]).toEqual(seeded);
    expect(transcript).toHaveLength(3); // seeded 2 + opening coach turn
  });
});
