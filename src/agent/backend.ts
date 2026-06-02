import type { Config } from '../config.js';
import { createClient } from './client.js';
import { apiBackend } from './backends/api.js';
import { subscriptionBackend } from './backends/subscription.js';

export interface RawCallRequest {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  model: string;
  toolName: string;
  maxTokens: number;
}

export interface LlmBackend {
  callOnce(req: RawCallRequest): Promise<unknown>;
}

export function createBackend(cfg: Config): LlmBackend {
  if (cfg.backend === 'api') return apiBackend(createClient(cfg));
  return subscriptionBackend();
}
