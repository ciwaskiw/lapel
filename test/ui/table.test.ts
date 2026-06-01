import { describe, it, expect } from 'vitest';
import { formatTable } from '../../src/ui/table.js';

describe('formatTable', () => {
  it('renders aligned columns with a header', () => {
    const out = formatTable(['ID', 'Title'], [['1', 'Senior Eng'], ['2', 'Staff Eng']]);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/ID\s+Title/);
    expect(lines).toHaveLength(4); // header + separator + 2 rows
  });

  it('handles empty rows', () => {
    expect(formatTable(['A'], [])).toContain('A');
  });
});
