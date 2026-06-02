import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createBackend } from '../../src/agent/backend.js';

describe('createBackend', () => {
  it('returns a subscription backend by default (no key needed)', () => {
    expect(typeof createBackend(loadConfig('/tmp/x', {})).callOnce).toBe('function');
  });
  it('throws for the api backend without a key', () => {
    expect(() => createBackend(loadConfig('/tmp/x', { LAPEL_BACKEND: 'api' }))).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
  it('builds the api backend when a key is present', () => {
    expect(
      typeof createBackend(
        loadConfig('/tmp/x', { LAPEL_BACKEND: 'api', ANTHROPIC_API_KEY: 'sk-test' }),
      ).callOnce,
    ).toBe('function');
  });
});
