import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writePrepRecap } from '../../src/prep/recap.js';
import type { Profile } from '../../src/profile/schema.js';
import type { PrepTurn } from '../../src/prep/session.js';

const profile = { skills: { core: [], familiar: [] } } as unknown as Profile;

describe('writePrepRecap', () => {
  let outDir: string;
  beforeEach(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'lapel-prep-'));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('writes interview-prep.md to a company-role folder from the model output', async () => {
    const transcript: PrepTurn[] = [
      { role: 'coach', text: 'What round?' },
      { role: 'candidate', text: 'Technical screen.' },
    ];
    const generate = vi.fn().mockResolvedValue({
      company: 'Acme Co',
      roleTitle: 'Senior Engineer',
      markdown: '## Round context\nTechnical screen.',
    });
    const result = await writePrepRecap({
      outputDir: outDir,
      profile,
      postingText: 'posting',
      transcript,
      company: 'fallback',
      title: 'fallback',
      generate,
    });
    expect(result).not.toBeNull();
    const expected = path.join(outDir, 'acme-co-senior-engineer', 'interview-prep.md');
    expect(result!.path).toBe(expected);
    expect(readFileSync(expected, 'utf8')).toContain('## Round context');
  });

  it('falls back to caller company/title when the model returns blanks', async () => {
    const transcript: PrepTurn[] = [
      { role: 'coach', text: 'Hi' },
      { role: 'candidate', text: 'Hello' },
    ];
    const generate = vi.fn().mockResolvedValue({ company: '', roleTitle: '', markdown: '# Prep' });
    const result = await writePrepRecap({
      outputDir: outDir,
      profile,
      postingText: 'p',
      transcript,
      company: 'Globex',
      title: 'Staff SWE',
      generate,
    });
    expect(result!.path).toBe(path.join(outDir, 'globex-staff-swe', 'interview-prep.md'));
  });

  it('skips writing when there are no candidate turns', async () => {
    const generate = vi.fn();
    const result = await writePrepRecap({
      outputDir: outDir,
      profile,
      postingText: 'p',
      transcript: [{ role: 'coach', text: 'Opening only' }],
      company: 'Acme',
      title: 'SWE',
      generate,
    });
    expect(result).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(existsSync(path.join(outDir, 'acme-swe'))).toBe(false);
  });
});
