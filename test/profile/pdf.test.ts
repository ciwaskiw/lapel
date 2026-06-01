import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { cleanText, extractPdfText, extractProfileSources } from '../../src/profile/pdf.js';

let dir: string;
let pdfPath: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'js-pdf-'));
  pdfPath = path.join(dir, 'resume.pdf');
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello Resume Chris Iwaskiw', { x: 20, y: 150, size: 14, font });
  writeFileSync(pdfPath, await doc.save());
});

describe('cleanText', () => {
  it('collapses whitespace and strips control chars', () => {
    expect(cleanText('a   b\n\n\nc   d')).toBe('a b\n\nc d');
  });
  it('removes control characters but keeps tabs/newlines content', () => {
    expect(cleanText('a\x01bc')).toBe('abc');
  });
});

describe('extractPdfText', () => {
  it('extracts text from a generated pdf', async () => {
    const txt = await extractPdfText(pdfPath);
    expect(txt.toLowerCase()).toContain('resume');
  });
});

describe('extractProfileSources', () => {
  it('reads every pdf in a directory', async () => {
    const sources = await extractProfileSources(dir);
    expect(sources).toHaveLength(1);
    expect(sources[0].file).toBe('resume.pdf');
    expect(sources[0].text.toLowerCase()).toContain('chris');
  });
});
