import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';

export function createClient(cfg: Config): Anthropic {
  if (!cfg.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to your environment or .env file.');
  }
  return new Anthropic({ apiKey: cfg.anthropicApiKey });
}
