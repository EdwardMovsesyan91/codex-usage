import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPercent, remainingPercent, progressBar, severity, quotaTooltip, quotaText, untilReset } from '../src/ui';

test('progress bars contain exactly 10 filled or empty characters', () => {
  for (const [value, expected] of [[100, '██████████'], [80, '████████░░'], [75, '████████░░'], [50, '█████░░░░░'], [20, '██░░░░░░░░'], [0, '░░░░░░░░░░'], [120, '██████████'], [-10, '░░░░░░░░░░']] as const) {
    assert.equal(progressBar(value), expected);
    assert.equal(progressBar(value).length, 10);
    assert.match(progressBar(value), /^[█░]{10}$/);
  }
});
test('remaining percentages subtract used and clamp to 0–100', () => {
  assert.equal(remainingPercent(10), 90); assert.equal(remainingPercent(2), 98);
  assert.equal(remainingPercent(100), 0); assert.equal(remainingPercent(0), 100);
  assert.equal(remainingPercent(150), 0); assert.equal(remainingPercent(-20), 100);
  assert.equal(clampPercent(-1), 0); assert.equal(clampPercent(101), 100);
  assert.equal(clampPercent(NaN), 0); assert.equal(clampPercent(Infinity), 100);
});
test('severity boundaries use exact remaining values', () => {
  for (const [value, expected] of [[100, 'normal'], [60, 'normal'], [59.9, 'warning'], [30, 'warning'], [29.9, 'strongWarning'], [10, 'strongWarning'], [9.9, 'danger'], [0, 'danger']] as const) assert.equal(severity(value), expected);
});
test('separate quota labels and Markdown tooltip include all fields', () => {
  const window = { usedPercent: 10, windowDurationMins: 300, resetsAt: 4600 };
  assert.equal(quotaText('Codex 5h', window), 'Codex 5h █████████░ 90%');
  assert.equal(quotaText('Week', { ...window, usedPercent: 2 }), 'Week ██████████ 98%');
  const tooltip = quotaTooltip('Codex 5h', window, 900000, 1000000);
  for (const value of ['**90%**', '`█████████░`', 'Used: 10%', 'Time until reset: 1h', 'Last updated:', new Date(4600000).toLocaleString()]) assert.ok(tooltip.includes(value));
  assert.match(quotaTooltip('Week', undefined, 0), /Unavailable/);
});
test('reset countdown never estimates recovered quota', () => {
  assert.equal(untilReset(null, 0), 'Unknown');
  assert.equal(untilReset(1, 1000), 'Reset time reached; awaiting updated quota');
  assert.equal(untilReset(90000, 0), '1d 1h');
});
