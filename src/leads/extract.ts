import { z } from 'zod';
import type { LlmBackend } from '../agent/backend.js';
import { structuredCall } from '../agent/llm.js';
import type { LeadInput } from './resolve.js';

export const LeadsSchema = z.object({
  leads: z.array(z.object({ company: z.string(), urls: z.array(z.string()), notes: z.string() })),
});

export const EXTRACT_SYSTEM = `You extract job leads from a messy, free-form notes file. Return one
entry per distinct COMPANY (merge multiple roles/links for the same company into that company's
\`urls\` list). Include every explicit posting URL you see, cleaned of tracking query params. Put any
useful free-text (referrals, location/commute notes, "interested") into \`notes\`. Do not invent URLs
or companies.`;

export function extractLeads(
  backend: LlmBackend,
  model: string,
  text: string,
): Promise<{ leads: LeadInput[] }> {
  return structuredCall({
    backend,
    model,
    system: EXTRACT_SYSTEM,
    user: `LEADS FILE:\n${text.slice(0, 20000)}`,
    toolName: 'emit_leads',
    schema: LeadsSchema,
    maxTokens: 4096,
  });
}
