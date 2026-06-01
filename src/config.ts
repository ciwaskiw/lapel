import path from 'node:path';

export const SCORING_BATCH_SIZE = 10;

export interface Config {
  rootDir: string;
  profileDir: string;
  profileJson: string;
  profileMd: string;
  outputDir: string;
  dbPath: string;
  companiesFile: string;
  anthropicApiKey: string | undefined;
  models: { worker: string; synth: string };
  scoringBatchSize: number;
  debug: boolean;
}

export function loadConfig(
  rootDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const profileDir = path.join(rootDir, 'profile');
  return {
    rootDir,
    profileDir,
    profileJson: path.join(profileDir, 'profile.json'),
    profileMd: path.join(profileDir, 'profile.md'),
    outputDir: path.join(rootDir, 'output'),
    dbPath: path.join(rootDir, 'job-scout.db'),
    companiesFile: path.join(rootDir, 'companies.yaml'),
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    models: {
      worker: env.JOB_SCOUT_MODEL_WORKER ?? 'claude-sonnet-4-6',
      synth: env.JOB_SCOUT_MODEL_SYNTH ?? 'claude-opus-4-8',
    },
    scoringBatchSize: SCORING_BATCH_SIZE,
    debug: env.JOB_SCOUT_DEBUG === '1',
  };
}
