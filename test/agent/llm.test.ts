import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { structuredCall } from '../../src/agent/llm.js';

const schema = z.object({ score: z.number() });
const toolUse = (input: unknown) => ({
  content: [{ type: 'tool_use', name: 'emit', id: 't1', input }],
});

describe('structuredCall', () => {
  it('returns validated tool input', async () => {
    const client = { messages: { create: vi.fn().mockResolvedValue(toolUse({ score: 9 })) } };
    const out = await structuredCall({
      client: client as never,
      model: 'm',
      system: 's',
      user: 'u',
      toolName: 'emit',
      schema,
    });
    expect(out).toEqual({ score: 9 });
  });

  it('repairs once on invalid output then succeeds', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUse({ score: 'NaN' }))
      .mockResolvedValueOnce(toolUse({ score: 7 }));
    const client = { messages: { create } };
    const out = await structuredCall({
      client: client as never,
      model: 'm',
      system: 's',
      user: 'u',
      toolName: 'emit',
      schema,
    });
    expect(out).toEqual({ score: 7 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws after a failed repair', async () => {
    const create = vi.fn().mockResolvedValue(toolUse({ score: 'x' }));
    const client = { messages: { create } };
    await expect(
      structuredCall({
        client: client as never,
        model: 'm',
        system: 's',
        user: 'u',
        toolName: 'emit',
        schema,
      }),
    ).rejects.toThrow(/validation/i);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
