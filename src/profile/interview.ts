import { createInterface } from 'node:readline/promises';

export interface Prompter {
  ask: (question: string) => Promise<string>;
  /** Close the readline interface so the process can exit. */
  close: () => void;
}

export function createPrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string): Promise<string> => (await rl.question(`\n${q}\n> `)).trim();
  const close = (): void => rl.close();
  return { ask, close };
}
