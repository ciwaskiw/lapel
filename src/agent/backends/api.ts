import type Anthropic from '@anthropic-ai/sdk';
import type { LlmBackend, RawCallRequest } from '../backend.js';

export function apiBackend(client: Anthropic): LlmBackend {
  return {
    async callOnce(req: RawCallRequest): Promise<unknown> {
      const tool = {
        name: req.toolName,
        description: `Emit the result as structured ${req.toolName} data.`,
        input_schema: req.jsonSchema,
      };
      const res = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        tools: [tool as never],
        tool_choice: { type: 'tool', name: req.toolName } as never,
        messages: [{ role: 'user', content: req.user }],
      });
      const block = (res.content as { type: string; input?: unknown }[]).find(
        (b) => b.type === 'tool_use',
      );
      return block?.input;
    },
  };
}
