import { remainingPercent } from './ui';
// Runtime validation deliberately tolerates additional protocol fields.
export type Window = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
export type Snapshot = { limitId: string | null; primary: Window | null; secondary: Window | null };
export type Limits = Record<string, Snapshot>;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unrecognized Codex protocol response.');
  return value as Record<string, unknown>;
}
function windowValue(value: unknown): Window | null {
  if (value === null || value === undefined) return null;
  const w = object(value);
  if (typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent) || w.usedPercent < 0) throw new Error('Invalid quota percentage.');
  for (const key of ['windowDurationMins', 'resetsAt']) {
    if (w[key] != null && (typeof w[key] !== 'number' || !Number.isFinite(w[key]) || (w[key] as number) < 0)) throw new Error('Invalid quota window.');
  }
  if (typeof w.resetsAt === 'number' && w.resetsAt > 8.64e12) throw new Error('Invalid quota reset time.');
  return { usedPercent: w.usedPercent, windowDurationMins: w.windowDurationMins as number ?? null, resetsAt: w.resetsAt as number ?? null };
}
function snapshot(value: unknown): Snapshot {
  const s = object(value);
  if (!('primary' in s) && !('secondary' in s)) throw new Error('Missing quota windows.');
  if (s.limitId != null && typeof s.limitId !== 'string') throw new Error('Invalid quota bucket.');
  return { limitId: s.limitId as string ?? null, primary: windowValue(s.primary), secondary: windowValue(s.secondary) };
}
export function parseSnapshot(value: unknown): Limits {
  const response = object(value);
  const result: Limits = Object.create(null);
  if (response.rateLimitsByLimitId != null) {
    for (const [id, value] of Object.entries(object(response.rateLimitsByLimitId))) result[id] = snapshot(value);
  }
  if (response.rateLimits != null) {
    const legacy = snapshot(response.rateLimits);
    const id = legacy.limitId ?? 'codex';
    if (!(id in result)) result[id] = legacy;
  }
  if (!Object.keys(result).length) throw new Error('Missing rate-limit snapshot.');
  return result;
}
export function mergeUpdate(previous: Limits, value: unknown): Limits {
  const update = snapshot(object(value).rateLimits);
  const id = update.limitId ?? 'codex';
  const old = previous[id];
  const mergeWindow = (next: Window | null, prev: Window | null | undefined): Window | null => next ? {
    usedPercent: next.usedPercent,
    windowDurationMins: next.windowDurationMins ?? prev?.windowDurationMins ?? null,
    resetsAt: next.resetsAt ?? prev?.resetsAt ?? null,
  } : prev ?? null;
  // Generated protocol: null windows in rolling updates mean unavailable, not cleared.
  return { ...previous, [id]: { limitId: update.limitId ?? old?.limitId ?? null,
    primary: mergeWindow(update.primary, old?.primary), secondary: mergeWindow(update.secondary, old?.secondary) } };
}
export function windows(limits: Limits): { fiveHour?: Window; weekly?: Window } {
  const codex = limits.codex;
  // Confirmed protocol: primary is 5-hour, secondary is weekly. Reject conflicting durations.
  return { fiveHour: codex?.primary && (codex.primary.windowDurationMins == null || codex.primary.windowDurationMins === 300) ? codex.primary : undefined,
    weekly: codex?.secondary && (codex.secondary.windowDurationMins == null || codex.secondary.windowDurationMins === 10080) ? codex.secondary : undefined };
}
export function formatStatus(limits: Limits): string {
  const { fiveHour, weekly } = windows(limits);
  const percent = (w?: Window) => w ? `${Math.round(remainingPercent(w.usedPercent))}%` : '—';
  return `Codex 5h ${percent(fiveHour)} | Week ${percent(weekly)}`;
}
export function formatDetails(limits: Limits, lastRefresh: number): string {
  const { fiveHour, weekly } = windows(limits);
  const describe = (name: string, w?: Window) => `${name}: ${w ? `${remainingPercent(w.usedPercent)}% remaining` : 'unavailable'}\nReset: ${w?.resetsAt != null ? new Date(w.resetsAt * 1000).toLocaleString() : 'unknown'}`;
  return `${describe('5-hour', fiveHour)}\n\n${describe('Weekly', weekly)}\n\nLast refresh: ${lastRefresh ? new Date(lastRefresh).toLocaleString() : 'never'}\nPercentages show remaining quota. Reset times use your local timezone.`;
}
