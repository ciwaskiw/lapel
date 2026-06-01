import { z } from 'zod';
import type { Profile } from '../../profile/schema.js';

export const UpdateProfileInput = z.object({
  reason: z.string().describe('Why this update is proposed (shown to the user for confirmation).'),
  addNote: z.string().optional(),
  addCoreSkills: z.array(z.string()).optional(),
  addExperienceHighlight: z.object({ company: z.string(), highlight: z.string() }).optional(),
  setPreferences: z
    .object({
      maxCommuteMiles: z.number().nullable().optional(),
      minBaseComp: z.number().nullable().optional(),
      remote: z.enum(['remote', 'hybrid', 'onsite', 'any']).optional(),
      mustHave: z.array(z.string()).optional(),
      dealbreakers: z.array(z.string()).optional(),
    })
    .optional(),
});
export type UpdateProfile = z.infer<typeof UpdateProfileInput>;

const uniq = (a: string[]) => [...new Set(a)];

export function applyProfileUpdate(
  profile: Profile,
  update: Omit<UpdateProfile, 'reason'>,
): Profile {
  const next: Profile = structuredClone(profile);
  if (update.addNote) next.notes = uniq([...next.notes, update.addNote]);
  if (update.addCoreSkills) next.skills.core = uniq([...next.skills.core, ...update.addCoreSkills]);
  if (update.addExperienceHighlight) {
    const exp = next.experience.find((e) => e.company === update.addExperienceHighlight!.company);
    if (exp) exp.highlights = uniq([...exp.highlights, update.addExperienceHighlight.highlight]);
    else
      next.notes = uniq([
        ...next.notes,
        `${update.addExperienceHighlight.company}: ${update.addExperienceHighlight.highlight}`,
      ]);
  }
  if (update.setPreferences) Object.assign(next.preferences, update.setPreferences);
  next.updatedAt = new Date().toISOString();
  return next;
}
