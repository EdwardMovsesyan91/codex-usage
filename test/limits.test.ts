import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, mergeUpdate, formatStatus, formatDetails } from '../src/limits';

const primary = { usedPercent: 82, windowDurationMins: 300, resetsAt: 1800000000 };
const secondary = { usedPercent: 91, windowDurationMins: 10080, resetsAt: 1800500000 };
const snapshot = { limitId: 'codex', primary, secondary };
test('parse legacy snapshot and format remaining percentages while preserving reset times', () => {
  const result = parseSnapshot({ rateLimits: snapshot, futureField: true });
  assert.equal(formatStatus(result), 'Codex 5h 18% | Week 9%');
  assert.match(formatDetails(result, 1800000000000), /18% remaining/);
  assert.match(formatDetails(result, 1800000000000), /9% remaining/);
  assert.ok(formatDetails(result, 1800000000000).includes(new Date(primary.resetsAt * 1000).toLocaleString()));
  assert.ok(formatDetails(result, 1800000000000).includes(new Date(secondary.resetsAt * 1000).toLocaleString()));
  assert.match(formatDetails(result, 1800000000000), /Last refresh:/);
});
test('multi-bucket Codex view takes precedence over legacy and other models', () => {
  const result = parseSnapshot({ rateLimits: { ...snapshot, primary: { ...primary, usedPercent: 1 } },
    rateLimitsByLimitId: { codex: snapshot, other: { ...snapshot, limitId: 'other' } } });
  assert.equal(formatStatus(result), 'Codex 5h 18% | Week 9%');
});
test('sparse update preserves absent windows and nullable metadata; zero is a valid update', () => {
  const old = parseSnapshot({ rateLimits: snapshot });
  const next = mergeUpdate(old, { rateLimits: { limitId: 'codex', primary: { usedPercent: 0, windowDurationMins: null, resetsAt: null }, secondary: null } });
  assert.equal(next.codex.primary?.resetsAt, primary.resetsAt);
  assert.equal(formatStatus(next), 'Codex 5h 100% | Week 9%');
  assert.equal(old.codex.primary?.usedPercent, 82);
});
test('update for another bucket leaves codex untouched', () => {
  const old = parseSnapshot({ rateLimits: snapshot });
  const next = mergeUpdate(old, { rateLimits: { limitId: 'other', primary, secondary: null } });
  assert.equal(formatStatus(next), formatStatus(old));
  assert.ok(next.other);
});
test('authoritative reads can clear windows', () => {
  assert.equal(formatStatus(parseSnapshot({ rateLimits: { ...snapshot, primary: null, secondary: null } })), 'Codex 5h — | Week —');
});
test('unknown durations and unrelated buckets are not mislabeled', () => {
  assert.equal(formatStatus(parseSnapshot({ rateLimits: { ...snapshot, primary: { ...primary, windowDurationMins: 15 }, secondary: null } })), 'Codex 5h — | Week —');
  assert.equal(formatStatus(parseSnapshot({ rateLimits: { ...snapshot, limitId: 'other' } })), 'Codex 5h — | Week —');
});
test('reject malformed snapshots and updates', () => {
  for (const value of [null, {}, [], { rateLimits: {} }, { rateLimits: { ...snapshot, primary: { ...primary, usedPercent: '82' } } },
    { rateLimits: { ...snapshot, primary: { ...primary, usedPercent: NaN } } },
    { rateLimits: { ...snapshot, primary: { ...primary, resetsAt: 1e20 } } }]) assert.throws(() => parseSnapshot(value));
  assert.throws(() => mergeUpdate({}, { rateLimits: { primary: { usedPercent: -1 } } }));
});
test('primary is 5-hour and secondary is weekly; conflicting durations are unavailable', () => {
  assert.equal(formatStatus(parseSnapshot({ rateLimits: { ...snapshot, primary: secondary, secondary: primary } })), 'Codex 5h — | Week —');
  assert.equal(formatStatus(parseSnapshot({ rateLimits: { ...snapshot, primary: { ...primary, windowDurationMins: null }, secondary: { ...secondary, windowDurationMins: null } } })), 'Codex 5h 18% | Week 9%');
});
test('remaining display clamps exhausted and over-quota values', () => {
  assert.equal(formatStatus(parseSnapshot({ rateLimits: { ...snapshot, primary: { ...primary, usedPercent: 100 }, secondary: { ...secondary, usedPercent: 0 } } })), 'Codex 5h 0% | Week 100%');
  assert.equal(formatStatus(parseSnapshot({ rateLimits: { ...snapshot, primary: { ...primary, usedPercent: 101.2 } } })), 'Codex 5h 0% | Week 9%');
});
