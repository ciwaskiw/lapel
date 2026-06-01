import { z } from 'zod';

export const ProfileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  basics: z.object({
    name: z.string(),
    headline: z.string(),
    yearsExperience: z.number(),
    summary: z.string(),
  }),
  skills: z.object({ core: z.array(z.string()), familiar: z.array(z.string()) }),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string().nullable(),
      highlights: z.array(z.string()),
      tech: z.array(z.string()),
    }),
  ),
  preferences: z.object({
    targetRoles: z.array(z.string()),
    seniority: z.array(z.string()),
    locations: z.array(z.string()),
    remote: z.enum(['remote', 'hybrid', 'onsite', 'any']),
    maxCommuteMiles: z.number().nullable(),
    minBaseComp: z.number().nullable(),
    mustHave: z.array(z.string()),
    dealbreakers: z.array(z.string()),
  }),
  notes: z.array(z.string()),
  extras: z.record(z.unknown()).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;
