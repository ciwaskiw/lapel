import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadConfig, SCORING_BATCH_SIZE } from '../src/config.js';

describe('loadConfig', () => {
  it('derives all paths from the root dir', () => {
    const c = loadConfig('/tmp/js', {});
    expect(c.profileJson).toBe(path.join('/tmp/js', 'profile', 'profile.json'));
    expect(c.dbPath).toBe(path.join('/tmp/js', 'job-scout.db'));
    expect(c.companiesFile).toBe(path.join('/tmp/js', 'companies.yaml'));
    expect(c.outputDir).toBe(path.join('/tmp/js', 'output'));
  });

  it('defaults models and honors env overrides', () => {
    expect(loadConfig('/x', {}).models.worker).toBe('claude-sonnet-4-6');
    expect(loadConfig('/x', {}).models.synth).toBe('claude-opus-4-8');
    const c = loadConfig('/x', { JOB_SCOUT_MODEL_WORKER: 'm1', JOB_SCOUT_MODEL_SYNTH: 'm2', JOB_SCOUT_DEBUG: '1' });
    expect(c.models.worker).toBe('m1');
    expect(c.models.synth).toBe('m2');
    expect(c.debug).toBe(true);
    expect(c.scoringBatchSize).toBe(SCORING_BATCH_SIZE);
  });
});
