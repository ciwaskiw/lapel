import type { Profile } from '../profile/schema.js';
import { applyProfileUpdate, type UpdateProfile } from './tools/update-profile.js';

export interface ConfirmAndApplyDeps {
  profile: Profile;
  update: UpdateProfile;
  confirm: (reason: string) => Promise<boolean>;
  save: (next: Profile) => void;
}

export async function confirmAndApply(deps: ConfirmAndApplyDeps): Promise<Profile | null> {
  const ok = await deps.confirm(deps.update.reason);
  if (!ok) return null;
  // applyProfileUpdate ignores `reason`; passing the whole update is type-safe and lint-clean.
  const next = applyProfileUpdate(deps.profile, deps.update);
  deps.save(next);
  return next;
}
