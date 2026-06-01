import type { Profile } from '../profile/schema.js';
import type { NormalizedJob } from '../sources/types.js';

export interface Dropped {
  job: NormalizedJob;
  reason: string;
}

const JUNIOR = /\b(intern|internship|junior|jr\.?|entry[- ]level|new grad|graduate)\b/i;

function hay(job: NormalizedJob): string {
  return `${job.title}\n${job.description}\n${job.location ?? ''}`.toLowerCase();
}

export function prefilter(
  jobs: NormalizedJob[],
  profile: Profile,
): { kept: NormalizedJob[]; dropped: Dropped[] } {
  const pref = profile.preferences;
  const kept: NormalizedJob[] = [];
  const dropped: Dropped[] = [];

  for (const job of jobs) {
    const text = hay(job);

    const db = pref.dealbreakers.find((d) => d && text.includes(d.toLowerCase()));
    if (db) {
      dropped.push({ job, reason: `dealbreaker: "${db}"` });
      continue;
    }

    if (pref.mustHave.length && !pref.mustHave.some((m) => text.includes(m.toLowerCase()))) {
      dropped.push({ job, reason: `missing all must-have terms: ${pref.mustHave.join(', ')}` });
      continue;
    }

    const wantsSenior = pref.seniority.some((s) => /senior|staff|principal|lead/i.test(s));
    if (wantsSenior && JUNIOR.test(job.title)) {
      dropped.push({ job, reason: `seniority mismatch: "${job.title}"` });
      continue;
    }

    if (pref.remote === 'remote' && job.remote === false) {
      dropped.push({ job, reason: 'remote preference but job is onsite' });
      continue;
    }

    kept.push(job);
  }
  return { kept, dropped };
}
