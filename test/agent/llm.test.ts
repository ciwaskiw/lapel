import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { structuredCall } from '../../src/agent/llm.js';

const schema = z.object({ score: z.number() });
const backendOf = (fn: ReturnType<typeof vi.fn>) => ({ callOnce: fn });
const base = { model: 'm', system: 's', user: 'u', toolName: 'emit', schema };

describe('structuredCall', () => {
  it('returns validated raw output from the backend', async () => {
    const out = await structuredCall({
      backend: backendOf(vi.fn().mockResolvedValue({ score: 9 })),
      ...base,
    });
    expect(out).toEqual({ score: 9 });
  });
  it('repairs once on invalid output then succeeds', async () => {
    const callOnce = vi
      .fn()
      .mockResolvedValueOnce({ score: 'NaN' })
      .mockResolvedValueOnce({ score: 7 });
    const out = await structuredCall({ backend: backendOf(callOnce), ...base });
    expect(out).toEqual({ score: 7 });
    expect(callOnce).toHaveBeenCalledTimes(2);
  });
  it('throws after a failed repair', async () => {
    const callOnce = vi.fn().mockResolvedValue({ score: 'x' });
    await expect(structuredCall({ backend: backendOf(callOnce), ...base })).rejects.toThrow(
      /validation/i,
    );
    expect(callOnce).toHaveBeenCalledTimes(2);
  });
  it('passes a json schema into callOnce', async () => {
    const callOnce = vi.fn().mockResolvedValue({ score: 1 });
    await structuredCall({ backend: backendOf(callOnce), ...base });
    expect(callOnce.mock.calls[0][0]).toHaveProperty('jsonSchema');
  });
});
