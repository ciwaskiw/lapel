import { describe, it, expect, vi } from 'vitest';
import { confirmAndApply } from '../../src/agent/propose.js';
import type { Profile } from '../../src/profile/schema.js';

const profile = {
  notes: [],
  skills: { core: [], familiar: [] },
  experience: [],
  preferences: {},
} as unknown as Profile;

describe('confirmAndApply', () => {
  it('saves when the user confirms', async () => {
    const save = vi.fn();
    const next = await confirmAndApply({
      profile,
      update: { reason: 'Add commute', setPreferences: { maxCommuteMiles: 30 } },
      confirm: async () => true,
      save,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(next!.preferences.maxCommuteMiles).toBe(30);
  });

  it('does nothing when the user declines', async () => {
    const save = vi.fn();
    const next = await confirmAndApply({
      profile,
      update: { reason: 'x', addNote: 'n' },
      confirm: async () => false,
      save,
    });
    expect(save).not.toHaveBeenCalled();
    expect(next).toBeNull();
  });
});
