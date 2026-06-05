import { describe, it, expect } from 'vitest';
import { slug } from '../../src/text/slug.js';

describe('slug', () => {
  it('lowercases and collapses non-alphanumeric runs to single hyphens', () => {
    expect(slug('Acme Co., Inc.')).toBe('acme-co-inc');
  });
  it('trims leading and trailing hyphens', () => {
    expect(slug('  !Senior Engineer!  ')).toBe('senior-engineer');
  });
  it('caps length at 60 characters', () => {
    expect(slug('a'.repeat(80)).length).toBe(60);
  });
});
