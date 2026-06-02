import type { Profile } from '../profile/schema.js';
import type { NormalizedJob } from '../sources/types.js';

export interface Dropped {
  job: NormalizedJob;
  reason: string;
}

const JUNIOR = /\b(intern|internship|junior|jr\.?|entry[- ]level|new grad|graduate)\b/i;

// Title markers of clearly NON-engineering job families (conservative exclusion list).
const OFF_FAMILY =
  /\b(sales|account executive|account manager|marketing|growth marketing|recruit(?:er|ing)|talent acquisition|designer|art director|creative director|brand|copywriter|content strategist|editor|producer|social media|community manager|customer success|support specialist|operations associate|office manager|people partner|accountant|controller|paralegal|legal counsel)\b/i;

// Engineering / technical role terms — a title with any of these is "in family" (keep).
const ROLE_TERMS =
  /\b(engineer|engineering|developer|swe|sde|programmer|architect|full[- ]?stack|back[- ]?end|front[- ]?end|software|platform|infrastructure|devops|sre)\b/i;

const SENIORITY_STOPWORDS = new Set([
  'senior',
  'staff',
  'principal',
  'lead',
  'junior',
  'mid',
  'level',
  'the',
  'and',
  'of',
  'for',
]);

function wantsSenior(profile: Profile): boolean {
  return profile.preferences.seniority.some((s) => /senior|staff|principal|lead/i.test(s));
}

// Does the title contain a meaningful word from the candidate's target roles (excluding
// seniority/stop words)? Generalizes role matching beyond the built-in engineering vocab.
function matchesTargetRole(title: string, targetRoles: string[]): boolean {
  const t = title.toLowerCase();
  return targetRoles.some((role) =>
    role
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3 && !SENIORITY_STOPWORDS.has(w))
      .some((w) => t.includes(w)),
  );
}

export function prefilter(
  jobs: NormalizedJob[],
  profile: Profile,
): { kept: NormalizedJob[]; dropped: Dropped[] } {
  const pref = profile.preferences;
  const kept: NormalizedJob[] = [];
  const dropped: Dropped[] = [];

  for (const job of jobs) {
    const title = job.title;

    // 1. Seniority mismatch (title-based; only when the candidate targets senior+).
    if (wantsSenior(profile) && JUNIOR.test(title)) {
      dropped.push({ job, reason: `seniority mismatch: "${title}"` });
      continue;
    }

    // 2. Remote conflict (structured flag; unambiguous).
    if (pref.remote === 'remote' && job.remote === false) {
      dropped.push({ job, reason: 'remote-only preference but role is on-site' });
      continue;
    }

    // 3. Different job family (conservative): the title clearly names a non-engineering function
    //    AND has no engineering/target-role term. Skills, culture, and dealbreaker nuance are left
    //    to the LLM scorer — the prefilter does NOT substring-match must-haves/dealbreakers.
    if (
      OFF_FAMILY.test(title) &&
      !ROLE_TERMS.test(title) &&
      !matchesTargetRole(title, pref.targetRoles)
    ) {
      dropped.push({ job, reason: `different job family: "${title}"` });
      continue;
    }

    kept.push(job);
  }
  return { kept, dropped };
}
