import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { LlmBackend, RawCallRequest } from '../backend.js';

export function modelAlias(model: string): string {
  if (/opus/i.test(model)) return 'opus';
  if (/haiku/i.test(model)) return 'haiku';
  return 'sonnet';
}

export type RunClaude = (args: string[], cwd: string) => Promise<{ stdout: string; code: number }>;

function defaultRun(command: string): RunClaude {
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (err) =>
        reject(
          new Error(
            `Could not run \`${command}\`: ${err.message}. Install Claude Code and log in, or set LAPEL_BACKEND=api with ANTHROPIC_API_KEY.`,
          ),
        ),
      );
      child.on('close', (code) => resolve({ stdout: stdout || stderr, code: code ?? 1 }));
    });
}

export function subscriptionBackend(opts: { command?: string; run?: RunClaude } = {}): LlmBackend {
  const command = opts.command ?? 'claude';
  const run = opts.run ?? defaultRun(command);
  return {
    async callOnce(req: RawCallRequest): Promise<unknown> {
      const args = [
        '-p',
        req.user,
        '--system-prompt',
        req.system,
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(req.jsonSchema),
        '--model',
        modelAlias(req.model),
        '--exclude-dynamic-system-prompt-sections',
      ];
      const { stdout, code } = await run(args, tmpdir());
      let env: {
        is_error?: boolean;
        result?: string;
        subtype?: string;
        structured_output?: unknown;
      };
      try {
        env = JSON.parse(stdout);
      } catch {
        throw new Error(`claude returned non-JSON output (exit ${code}): ${stdout.slice(0, 300)}`);
      }
      if (code !== 0 || env.is_error) {
        throw new Error(`claude call failed: ${env.result ?? env.subtype ?? `exit ${code}`}`);
      }
      return env.structured_output;
    },
  };
}
