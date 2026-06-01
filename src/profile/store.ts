import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import { ProfileSchema, type Profile } from './schema.js';

export function loadProfile(cfg: Config): Profile | null {
  if (!existsSync(cfg.profileJson)) return null;
  const parsed = JSON.parse(readFileSync(cfg.profileJson, 'utf8'));
  return ProfileSchema.parse(parsed);
}

export function saveProfile(cfg: Config, profile: Profile): void {
  mkdirSync(path.dirname(cfg.profileJson), { recursive: true });
  ProfileSchema.parse(profile);
  writeFileSync(cfg.profileJson, JSON.stringify(profile, null, 2) + '\n');
  writeFileSync(cfg.profileMd, renderProfileMarkdown(profile));
}

export function renderProfileMarkdown(p: Profile): string {
  const lines: string[] = [];
  lines.push(
    `# ${p.basics.name}`,
    '',
    `**${p.basics.headline}** — ${p.basics.yearsExperience} years`,
    '',
    p.basics.summary,
    '',
  );
  lines.push(
    '## Skills',
    '',
    `**Core:** ${p.skills.core.join(', ')}`,
    `**Familiar:** ${p.skills.familiar.join(', ')}`,
    '',
  );
  lines.push('## Experience', '');
  for (const e of p.experience) {
    lines.push(`### ${e.title} — ${e.company} (${e.start}–${e.end ?? 'present'})`);
    for (const h of e.highlights) lines.push(`- ${h}`);
    if (e.tech.length) lines.push(`*Tech: ${e.tech.join(', ')}*`);
    lines.push('');
  }
  const pr = p.preferences;
  lines.push(
    '## Preferences',
    '',
    `- Target roles: ${pr.targetRoles.join(', ')}`,
    `- Seniority: ${pr.seniority.join(', ')}`,
    `- Locations: ${pr.locations.join(', ')} (remote: ${pr.remote})`,
    `- Max commute: ${pr.maxCommuteMiles ?? 'n/a'} mi`,
    `- Min base comp: ${pr.minBaseComp ?? 'n/a'}`,
    `- Must have: ${pr.mustHave.join(', ')}`,
    `- Dealbreakers: ${pr.dealbreakers.join(', ')}`,
    '',
  );
  if (p.notes.length) lines.push('## Notes', '', ...p.notes.map((n) => `- ${n}`), '');
  return lines.join('\n');
}
