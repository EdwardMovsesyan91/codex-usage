import type { Window } from './limits';

export function clampPercent(value: number): number {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.min(100, value));
}
export function remainingPercent(usedPercent: number): number { return clampPercent(100 - usedPercent); }
export function progressBar(remaining: number): string {
  const filled = Math.round(clampPercent(remaining) / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}
export function severity(remaining: number): 'normal' | 'warning' | 'strongWarning' | 'danger' {
  const value = clampPercent(remaining);
  return value >= 60 ? 'normal' : value >= 30 ? 'warning' : value >= 10 ? 'strongWarning' : 'danger';
}
export function quotaText(label: string, window?: Window): string {
  if (!window) return `${label} —`;
  const remaining = remainingPercent(window.usedPercent);
  return `${label} ${progressBar(remaining)} ${Math.round(remaining)}%`;
}
export function untilReset(resetSeconds: number | null, now: number): string {
  if (resetSeconds === null) return 'Unknown';
  if (resetSeconds * 1000 <= now) return 'Reset time reached; awaiting updated quota';
  const minutes = Math.ceil((resetSeconds * 1000 - now) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes % 60 ? `${minutes % 60}m` : ''];
  return parts.filter(Boolean).join(' ');
}
export function quotaTooltip(label: string, window: Window | undefined, updated: number, now = Date.now()): string {
  const remaining = window ? remainingPercent(window.usedPercent) : undefined;
  return `**${label} quota**\n\n` +
    `Remaining: **${remaining !== undefined ? `${remaining}%` : 'Unavailable'}**\n\n` +
    `${remaining !== undefined ? `\`${progressBar(remaining)}\`` : 'Progress: unavailable'}\n\n` +
    `Used: ${window ? `${window.usedPercent}%` : 'Unavailable'}\n\n` +
    `Reset time: ${window?.resetsAt != null ? new Date(window.resetsAt * 1000).toLocaleString() : 'Unknown'}\n\n` +
    `Time until reset: ${untilReset(window?.resetsAt ?? null, now)}\n\n` +
    `Last updated: ${updated ? new Date(updated).toLocaleString() : 'Never'}\n\n` +
    'Reset times use your local timezone. Click to show details.';
}
