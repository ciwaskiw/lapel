import type Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

export interface StructuredCallArgs<T> {
  client: Anthropic;
  model: string;
  system: string;
  user: string;
  toolName: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export async function structuredCall<T>(args: StructuredCallArgs<T>): Promise<T> {
  const { client, model, system, user, toolName, schema, maxTokens = 2048 } = args;
  const inputSchema = zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;
  const tool = { name: toolName, description: `Emit the result as structured ${toolName} data.`, input_schema: inputSchema };

  const call = (extra: string) =>
    client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: [tool as never],
      tool_choice: { type: 'tool', name: toolName } as never,
      messages: [{ role: 'user', content: user + extra }],
    });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call(attempt === 0 ? '' : '\n\nYour previous response failed schema validation. Re-emit valid data.');
    const block = (res.content as { type: string; name?: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
    const parsed = schema.safeParse(block?.input);
    if (parsed.success) return parsed.data;
    if (attempt === 1) throw new Error(`Structured output failed validation: ${parsed.error.message}`);
  }
  throw new Error('unreachable');
}
