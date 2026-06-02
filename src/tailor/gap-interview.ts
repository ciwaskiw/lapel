import type { Profile } from '../profile/schema.js';
import type { Gaps } from '../agent/prompts/tailor-gap-interview.js';
import type { UpdateProfile } from '../agent/tools/update-profile.js';

const SKIP = /^(skip|pass|no|none|n\/a|no experience)\.?$/i;

export interface GapInterviewDeps {
  profile: Profile;
  postingText: string;
  identifyGaps: (profile: Profile, postingText: string) => Promise<Gaps>;
  ask: (question: string) => Promise<string>;
  /** How many substantive answers to collect before stopping (default 3). */
  targetAnswers?: number;
}

export interface GapInterviewResult {
  extraExperience: string;
  proposals: UpdateProfile[];
}

export async function runGapInterview(deps: GapInterviewDeps): Promise<GapInterviewResult> {
  const target = deps.targetAnswers ?? 3;
  const { gaps } = await deps.identifyGaps(deps.profile, deps.postingText);
  const extras: string[] = [];
  const proposals: UpdateProfile[] = [];
  // Ask down the ranked list; "pass"/"skip" moves on without counting, so the candidate can skip
  // questions they have no story for and still reach ~`target` answered questions.
  for (const gap of gaps) {
    if (proposals.length >= target) break;
    const answer = (
      await deps.ask(`${gap.question}\n(reply "pass" if you have no strong example)`)
    ).trim();
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
