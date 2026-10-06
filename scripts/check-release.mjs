import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const failures = [];
if (!manifest.publisher || /placeholder|local-dev/i.test(manifest.publisher)) failures.push('Provide the verified Marketplace publisher ID.');
const repository = manifest.repository?.url;
if (!repository || !/^https:\/\/github\.com\/[\w.-]+\/codex-usage(?:\.git)?$/.test(repository)) failures.push('Provide the real GitHub repository URL for codex-usage.');
if (!manifest.homepage || !manifest.bugs?.url) failures.push('Set homepage and bugs URLs from the verified repository.');
if (manifest.license !== 'MIT') failures.push('Verify the extension license.');
for (const file of ['LICENSE', 'CHANGELOG.md', 'README.md', '.vscodeignore']) {
  try { readFileSync(new URL(`../${file}`, import.meta.url)); }
  catch { failures.push(`Missing ${file}.`); }
}
if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
else console.log('Public release metadata checks passed.');
