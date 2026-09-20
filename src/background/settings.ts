import type { Settings } from '../shared/types';
import { SEARCH_LANE_ENABLED } from '../shared/config';

const KEY = 'settings_v1';

export const DEFAULTS: Settings = {
  mode: 'autopilot',
  enabled: true,
  searchLaneEnabled: SEARCH_LANE_ENABLED,
  showRoutingChips: true,
  nerEnabled: false,
  autoRedactNames: false,
  nerAutoRedactMinScore: 0.7,
  theme: 'light',
};

export async function get(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  return { ...DEFAULTS, ...((got[KEY] as Partial<Settings> | undefined) ?? {}) };
}

export async function set(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await get()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
