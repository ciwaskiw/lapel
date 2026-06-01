import { createInterface } from 'node:readline/promises';

export function createPrompter(): (q: string) => Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return async (q: string) => {
    const a = await rl.question(`\n${q}\n> `);
    return a.trim();
  };
}
