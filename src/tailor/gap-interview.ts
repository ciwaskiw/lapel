import type { Profile } from '../profile/schema.js';
import type { Gaps } from '../agent/prompts/tailor-gap-interview.js';
import type { UpdateProfile } from '../agent/tools/update-profile.js';

const SKIP = /^(skip|no|none|n\/a|no experience)\.?$/i;

export interface GapInterviewDeps {
  profile: Profile;
  postingText: string;
  identifyGaps: (profile: Profile, postingText: string) => Promise<Gaps>;
  ask: (question: string) => Promise<string>;
}

export interface GapInterviewResult {
  extraExperience: string;
  proposals: UpdateProfile[];
}

export async function runGapInterview(deps: GapInterviewDeps): Promise<GapInterviewResult> {
  const { gaps } = await deps.identifyGaps(deps.profile, deps.postingText);
  const extras: string[] = [];
  const proposals: UpdateProfile[] = [];
  for (const gap of gaps) {
    const answer = (await deps.ask(gap.question)).trim();
    if (!answer || SKIP.test(answer)) continue;
    extras.push(`${gap.skill}: ${answer}`);
    proposals.push({
      reason: `You described ${gap.skill} experience: "${answer.slice(0, 80)}${answer.length > 80 ? '…' : ''}". Add it to your profile?`,
      addCoreSkills: [gap.skill],
      addNote: `${gap.skill}: ${answer}`,
    });
  }
  return { extraExperience: extras.join('\n'), proposals };
}
