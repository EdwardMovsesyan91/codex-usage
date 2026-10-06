import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, responseShape } from '../src/diagnostics';

test('response shape retains quota numbers and structural types but excludes secret values', () => {
  const value = { rateLimits: { limitId: 'codex', primary: { usedPercent: 82, windowDurationMins: 300, resetsAt: 1800000000 } },
    access_token: 'short-secret', credentials: { value: 'hidden' }, future: { value: 'another-secret', accountId: 123456 } };
  const shape = JSON.stringify(responseShape(value));
  assert.match(shape, /"usedPercent":82/);
  assert.match(shape, /"limitId":"<string>"/);
  assert.match(shape, /\[REDACTED\]/);
  for (const secret of ['short-secret', 'hidden', 'another-secret', '123456']) assert.ok(!shape.includes(secret));
});
test('diagnostics redact local paths, account identifiers and email addresses', () => {
  const windowsPath = ['C:', 'Users', 'sample-user', 'private', 'codex.exe'].join(String.fromCharCode(92));
  const unixPath = ['', 'home', 'sample-user', '.codex', 'state'].join('/');
  const message = `Executable: ${windowsPath}\nSocket: ${unixPath}\naccountId=fixture-account\nuser@example.test\n00000000-1111-2222-3333-444444444444\nfailed to connect (os error 10013)`;
  const redacted = redactText(message);
  for (const privateValue of ['sample-user', 'fixture-account', 'user@example.test', '00000000-1111-2222-3333-444444444444', windowsPath, unixPath]) assert.ok(!redacted.includes(privateValue));
  assert.match(redacted, /os error 10013/);
});
test('stderr redaction covers bearer, JSON credentials, env secrets, API keys and opaque tokens', () => {
  const text = `Authorization: Bearer bearer-value\n{"access_token":"short-secret"}\nAPI_KEY=env-secret\nCookie: session=private-cookie\nsk-api-secret\n${'x'.repeat(48)}\nError: failed to connect (os error 10013)`;
  const redacted = redactText(text);
  for (const secret of ['bearer-value', 'short-secret', 'env-secret', 'private-cookie', 'sk-api-secret', 'x'.repeat(48)]) assert.ok(!redacted.includes(secret));
  assert.match(redacted, /failed to connect \(os error 10013\)/);
});
