import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

// Exercise the actual extension lifecycle with a mocked VS Code host and RPC peer.
test('extension lifecycle: notifications, fallback, in-flight updates, account switch and disposal', async () => {
  const primary = { usedPercent: 82, windowDurationMins: 300, resetsAt: 1800000000 };
  const secondary = { usedPercent: 91, windowDurationMins: 10080, resetsAt: 1800500000 };
  const snapshot = { rateLimits: { limitId: 'codex', primary, secondary } };
  let result: unknown = snapshot;
  let readResolve: ((v: unknown) => void) | undefined;
  let holdRead = false;
  let reads = 0;
  let interval!: () => void;
  let now = 100000;
  let cleared = false;
  let peer!: FakeRpc;
  const commands = new Map<string, () => unknown>();
  const logs: string[] = [];
  const errors: string[] = [];
  let shown = false;
  let detailsChoice: string | undefined;
  type Bar = { text: string; tooltip?: { value: string }; command?: string; color?: { id: string }; backgroundColor?: { id: string }; show(): void; dispose(): void };
  const bars: Bar[] = [];
  class MarkdownString {
    value = ''; isTrusted = false;
    appendText(value: string) { this.value += value; return this; }
    appendMarkdown(value: string) { this.value += value; return this; }
  }
  class FakeRpc {
    disposed = false;
    methods: string[] = [];
    constructor(_exe: string, public args: string[], public onEvent: (m: string, p: unknown) => void) { peer = this; }
    request(method: string): Promise<unknown> {
      this.methods.push(method);
      if (method === 'initialize') return Promise.resolve({});
      reads++;
      if (holdRead) return new Promise(resolve => { readResolve = resolve; });
      return Promise.resolve(result);
    }
    notify(method: string) { this.methods.push(method); }
    dispose() { this.disposed = true; }
  }
  const vscode = {
    MarkdownString,
    ThemeColor: class { constructor(public id: string) {} },
    StatusBarAlignment: { Right: 2 },
    window: {
      createStatusBarItem: () => { const item = { text: '', show() {}, dispose() {} }; bars.push(item); return item; },
      createOutputChannel: (name: string) => { assert.equal(name, 'Codex Usage'); return { appendLine: (line: string) => logs.push(line), show: () => { shown = true; }, dispose() {} }; },
      showInformationMessage: () => Promise.resolve(detailsChoice),
      showErrorMessage: (message: string) => { errors.push(message); return Promise.resolve('Show Output'); },
    },
    commands: { registerCommand: (name: string, fn: () => unknown) => { commands.set(name, fn); return { dispose() {} }; } },
    workspace: {
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  const originalInterval = global.setInterval;
  const originalClear = global.clearInterval;
  const originalNow = Date.now;
  const subscriptions: { dispose(): void }[] = [];
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  try {
    Date.now = () => now;
    global.setInterval = ((fn: () => void) => { interval = fn; return 1; }) as unknown as typeof setInterval;
    global.clearInterval = (() => { cleared = true; }) as typeof clearInterval;
    loader._load = function(id, ...args) {
      if (id === 'vscode') return vscode;
      if (id === './rpc') return { Rpc: FakeRpc };
      if (id === './executable') return { findExecutable: () => 'codex' };
      return originalLoad.call(this, id, ...args);
    };
    const { activate } = require('../src/extension');
    loader._load = originalLoad;
    activate({ subscriptions });
    await flush();
    assert.deepEqual(peer.args, ['app-server', '--listen', 'stdio://']);
    assert.deepEqual(peer.methods, ['initialize', 'initialized', 'account/rateLimits/read']);
    const [bar, week] = bars;
    assert.equal(bars.length, 2);
    assert.equal(bar.text, 'Codex 5h ██░░░░░░░░ 18%');
    assert.equal(week.text, 'Week █░░░░░░░░░ 9%');
    assert.equal(bar.command, 'codexUsage.showDetails'); assert.equal(week.command, 'codexUsage.showDetails');
    assert.equal(bar.backgroundColor?.id, 'statusBarItem.warningBackground');
    assert.equal(week.backgroundColor?.id, 'statusBarItem.errorBackground');
    assert.ok(bar.tooltip instanceof MarkdownString);
    assert.match(bar.tooltip!.value, /Used: 82%/);
    assert.ok(commands.has('codexUsage.showDetails'));

    now += 59000;
    peer.onEvent('account/rateLimits/updated', { rateLimits: { limitId: 'other', primary, secondary } });
    now += 1000; interval(); await flush();
    assert.equal(reads, 2, 'unrelated bucket must not suppress fallback');

    now += 59000;
    peer.onEvent('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { ...primary, usedPercent: 85 }, secondary: null } });
    now += 1000; interval(); await flush();
    assert.equal(reads, 2, 'recent Codex notifications suppress polling');
    assert.equal(bar.text, 'Codex 5h ██░░░░░░░░ 15%');
    assert.equal(week.text, 'Week █░░░░░░░░░ 9%');

    holdRead = true;
    const refresh = commands.get('codexUsage.refresh')!() as Promise<void>;
    peer.onEvent('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { ...primary, usedPercent: 90 }, secondary: null } });
    readResolve!(snapshot); await refresh;
    assert.equal(bar.text, 'Codex 5h █░░░░░░░░░ 10%', 'snapshot cannot overwrite newer notification');

    const oldAccountRead = commands.get('codexUsage.refresh')!() as Promise<void>;
    peer.onEvent('account/updated', {});
    assert.equal(bar.text, 'Codex 5h —', 'account switch clears cached values immediately');
    assert.equal(week.text, 'Week —');
    holdRead = false;
    result = { rateLimits: { limitId: 'codex', primary: { ...primary, usedPercent: 7 }, secondary: { ...secondary, usedPercent: 8 } } };
    readResolve!(snapshot); await oldAccountRead; await flush();
    assert.equal(bar.text, 'Codex 5h █████████░ 93%', 'old account read is discarded and new account refetched');
    assert.equal(week.text, 'Week █████████░ 92%');
    assert.equal(bar.backgroundColor, undefined); assert.equal(week.backgroundColor, undefined);

    result = { rateLimits: { limitId: 'codex', primary, secondary: null } };
    await commands.get('codexUsage.refresh')!();
    now += 59000;
    peer.onEvent('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { ...primary, usedPercent: 86 }, secondary: null } });
    const count = reads;
    now += 1000; interval(); await flush();
    assert.equal(reads, count + 1, 'incomplete quota notifications must not suppress full reads');

    result = { unexpected: 'private-server-value' };
    await commands.get('codexUsage.refresh')!();
    assert.match(errors.at(-1)!, /refresh failed.*Missing rate-limit snapshot/);
    assert.ok(shown, 'error action opens diagnostics');
    assert.ok(logs.some(line => line.includes('parsing/validation failed')));
    assert.ok(!logs.join('\n').includes('private-server-value'));

    // The details Refresh action must report the same failure instead of silently closing.
    detailsChoice = 'Refresh';
    const errorCount = errors.length;
    await commands.get('codexUsage.showDetails')!();
    assert.equal(errors.length, errorCount + 1);

    // Manual refresh during an automatic in-flight read waits for its outcome.
    holdRead = true;
    now += 60000; interval();
    await flush();
    const joined = commands.get('codexUsage.refresh')!() as Promise<void>;
    readResolve!({ bad: true }); await joined;
    assert.equal(errors.length, errorCount + 2);
    assert.ok(logs.some(line => line.includes('waiting for the current refresh')));

    for (const item of subscriptions) item.dispose();
    assert.ok(peer.disposed); assert.ok(cleared);
    const finalCount = reads;
    await commands.get('codexUsage.refresh')!();
    assert.equal(reads, finalCount, 'disposed extension cannot reconnect');
  } finally {
    for (const item of subscriptions) item.dispose();
    loader._load = originalLoad;
    global.setInterval = originalInterval; global.clearInterval = originalClear; Date.now = originalNow;
  }
});
