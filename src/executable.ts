import { existsSync } from 'node:fs';
import { delimiter, join, dirname, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';

export function findExecutable(configured: string): string {
  if (configured) {
    if (!isAbsolute(configured) || !existsSync(configured) || /\.(cmd|bat|ps1)$/i.test(configured)) throw new Error('Set executablePath to an existing absolute native Codex executable path.');
    return configured;
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const native = join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (existsSync(native)) return native;
    if (process.platform !== 'win32') continue;
    // Resolve the npm binary directly: no shell, PowerShell policy changes, or orphan shim process.
    const script = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (!existsSync(script)) continue;
    const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    let root = join(dirname(script), '..', 'vendor');
    try { root = join(dirname(createRequire(script).resolve(`@openai/codex-win32-${process.arch}/package.json`)), 'vendor'); } catch { /* Older bundled distribution. */ }
    const binary = join(root, triple, 'bin', 'codex.exe');
    if (existsSync(binary)) return binary;
  }
  throw new Error('Codex is not installed or not on PATH. Install Codex or set codexUsage.executablePath.');
}
