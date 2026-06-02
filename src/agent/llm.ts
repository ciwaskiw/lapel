import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { LlmBackend } from './backend.js';

export interface StructuredCallArgs<T> {
  backend: LlmBackend;
  model: string;
  system: string;
  user: string;
  toolName: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export async function structuredCall<T>(args: StructuredCallArgs<T>): Promise<T> {
  const { backend, model, system, user, toolName, schema, maxTokens = 2048 } = args;
  const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;

  for (let attempt = 0; attempt < 2; attempt++) {
    const repaired =
      attempt === 0
        ? user
        : `${user}\n\nYour previous response failed schema validation. Re-emit valid data.`;
    const raw = await backend.callOnce({
      system,
      user: repaired,
      jsonSchema,
      model,
      toolName,
      maxTokens,
    });
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    if (attempt === 1) {
      throw new Error(`Structured output failed validation: ${parsed.error.message}`);
    }
  }
  throw new Error('unreachable');
}
