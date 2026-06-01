import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

// Strip control chars EXCEPT tab (\t) and newline (\n); collapse whitespace.
export function cleanText(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(file: string): Promise<string> {
  const buf = new Uint8Array(await readFile(file));
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return cleanText(Array.isArray(text) ? text.join('\n') : text);
}

export async function extractProfileSources(dir: string): Promise<{ file: string; text: string }[]> {
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const out: { file: string; text: string }[] = [];
  for (const f of pdfs) out.push({ file: f, text: await extractPdfText(path.join(dir, f)) });
  return out;
}
