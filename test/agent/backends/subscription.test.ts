import { describe, it, expect, vi } from 'vitest';
import { subscriptionBackend, modelAlias } from '../../../src/agent/backends/subscription.js';

const envelope = (o: unknown) => ({
  stdout: JSON.stringify({ is_error: false, structured_output: o }),
  code: 0,
});
const req = (over = {}) => ({
  system: 's',
  user: 'u',
  jsonSchema: { type: 'object' },
  model: 'claude-sonnet-4-6',
  toolName: 'emit',
  maxTokens: 1024,
  ...over,
});

describe('subscriptionBackend', () => {
  it('passes -p/--json-schema/--model and returns structured_output', async () => {
    const run = vi.fn().mockResolvedValue(envelope({ score: 5 }));
    const out = await subscriptionBackend({ run }).callOnce(req({ model: 'claude-opus-4-8' }));
    expect(out).toEqual({ score: 5 });
    const args = run.mock.calls[0][0] as string[];
    expect(args).toContain('-p');
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args).toContain('--output-format');
    expect(args).toContain('--json-schema');
    expect(args).toContain('--exclude-dynamic-system-prompt-sections');
  });
  it('throws when the envelope is an error', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ stdout: JSON.stringify({ is_error: true, result: 'nope' }), code: 0 });
    await expect(subscriptionBackend({ run }).callOnce(req())).rejects.toThrow(/nope/);
  });
  it('throws on non-JSON output', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'not json', code: 1 });
    await expect(subscriptionBackend({ run }).callOnce(req())).rejects.toThrow(/non-JSON/);
  });
  it('modelAlias maps full ids to claude aliases', () => {
    expect(modelAlias('claude-opus-4-8')).toBe('opus');
    expect(modelAlias('claude-sonnet-4-6')).toBe('sonnet');
    expect(modelAlias('claude-haiku-4-5')).toBe('haiku');
  });
});
