import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ignored = new Set(['.git', 'node_modules', '.validation']);
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['API key', /\b(?:sk-|sess-)[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['personal Windows path', /\b[A-Za-z]:[\\/]Users[\\/][^\s"']+/i],
  ['personal Unix path', /\/(?:home|Users)\/[A-Za-z0-9_.-]+\//],
  ['email address', /\b[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['credential assignment', /\b(?:access_token|refresh_token|api_key|password|client_secret)\s*[=:]\s*["']?[A-Za-z0-9_+./=-]{20,}/i],
  ['account ID value', /["']?\baccount[_-]?id["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/i],
];
let checked = 0;
let findings = 0;
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    if (!entry.isFile() || /\.vsix$/.test(entry.name)) continue;
    const name = relative(root, path).replaceAll('\\', '/');
    checked++;
    if (/^(?:\.env(?:\.|$)|.*\.(?:log|pem|key)$)/.test(name)) {
      console.error(`Unexpected private/diagnostic file: ${name}`); findings++; continue;
    }
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [label, pattern] of patterns) {
        // Deliberate privacy-test fixture, never a real identity.
        if (label === 'email address' && /^(?:test\/diagnostics\.test\.ts|out\/test\/diagnostics\.test\.js(?:\.map)?)$/.test(name) && !pattern.test(line.replaceAll(['user', 'example.test'].join('@'), ''))) continue;
        if (label === 'account ID value' && /^(?:test\/diagnostics\.test\.ts|out\/test\/diagnostics\.test\.js(?:\.map)?)$/.test(name) && !pattern.test(line.replaceAll('fixture-account', ''))) continue;
        if (pattern.test(line)) { console.error(`${label}: ${name}:${i + 1} (value withheld)`); findings++; }
      }
    });
  }
}
visit(root);
console.log(`Audited ${checked} source/reference/build files; ${findings} findings requiring review.`);
if (findings) process.exitCode = 1;
