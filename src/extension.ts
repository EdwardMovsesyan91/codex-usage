import * as vscode from 'vscode';
import { Rpc } from './rpc';
import { findExecutable } from './executable';
import { Limits, Window, parseSnapshot, mergeUpdate, formatDetails, windows } from './limits';
import { redactText } from './diagnostics';
import { quotaText, quotaTooltip, remainingPercent, severity } from './ui';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Codex Usage');
  let outputDisposed = false;
  const log = (message: string) => { if (!outputDisposed) output.appendLine(`[${new Date().toISOString()}] ${redactText(message)}`); };
  log('Codex Usage activated.');
  const fiveHourBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  const weeklyBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  fiveHourBar.name = 'Codex Usage: 5-hour'; weeklyBar.name = 'Codex Usage: Weekly';
  for (const bar of [fiveHourBar, weeklyBar]) { bar.command = 'codexUsage.showDetails'; bar.show(); }
  let rpc: Rpc | undefined;
  let limits: Limits = {};
  let lastRefresh = 0;
  let lastActivity = 0;
  let error = '';
  let busy = false;
  const refreshWaiters: (() => void)[] = [];
  let disposed = false;
  let generation = 0;
  let accountRevision = 0;
  let updatesDuringRead: unknown[] | undefined;
  let refreshAgain = false;
  let timer: NodeJS.Timeout | undefined;
  function renderQuota(bar: vscode.StatusBarItem, label: string, window?: Window): void {
    bar.text = error ? `${label} unavailable` : quotaText(label, window);
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = false;
    if (error) tooltip.appendText(`${error}\n\nCached snapshot (may be stale):\n\n`);
    tooltip.appendMarkdown(quotaTooltip(label, window, lastRefresh));
    bar.tooltip = tooltip;
    // Clear previous styling so a recovered quota returns to its normal theme.
    bar.color = undefined; bar.backgroundColor = undefined;
    const level = !error && window ? severity(remainingPercent(window.usedPercent)) : 'normal';
    if (level === 'warning') bar.color = new vscode.ThemeColor('editorWarning.foreground');
    if (level === 'strongWarning') {
      bar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      bar.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    }
    if (level === 'danger') {
      bar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      bar.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    }
    bar.accessibilityInformation = { label: `${label}: ${window ? `${remainingPercent(window.usedPercent)} percent remaining` : 'unavailable'}. ${error || level}. Click to show details.` };
  }
  function render(): void {
    const quota = windows(limits);
    renderQuota(fiveHourBar, 'Codex 5h', quota.fiveHour);
    renderQuota(weeklyBar, 'Week', quota.weekly);
  }
  function accept(next: Limits): void {
    limits = next; lastRefresh = lastActivity = Date.now(); error = ''; render();
  }
  async function refresh(): Promise<void> {
    if (disposed) return;
    if (busy) {
      log('Refresh requested while busy; waiting for the current refresh.');
      return new Promise(resolve => refreshWaiters.push(resolve));
    }
    log('Refresh started.');
    busy = true;
    const current = generation;
    lastActivity = Date.now();
    try {
      if (!rpc) {
        const config = vscode.workspace.getConfiguration('codexUsage');
        const args = ['app-server', '--listen', 'stdio://'];
        let executable: string;
        try { executable = findExecutable(config.get('executablePath', '')); log('Codex executable found (resolved path withheld).'); }
        catch (e) { log(`Codex executable lookup failed: ${e instanceof Error ? e.message : 'unknown error'}`); throw e; }
        log('Creating/restarting Codex connection.');
        rpc = new Rpc(executable, args, (method, params) => {
          if (disposed || current !== generation) return;
          if (method === 'account/rateLimits/updated') {
            try {
              const next = mergeUpdate(limits, params);
              const changed = next.codex?.primary !== limits.codex?.primary || next.codex?.secondary !== limits.codex?.secondary;
              limits = next;
              if (changed) {
                lastRefresh = Date.now(); error = '';
                const quota = windows(limits);
                // Other buckets and incomplete notifications must not starve the full read.
                if (quota.fiveHour && quota.weekly) lastActivity = Date.now();
                render();
              }
              updatesDuringRead?.push(params);
            }
            catch (e) { log(`Rate-limit notification parsing/validation failed: ${e instanceof Error ? e.message : 'unknown error'}`); error = 'Unrecognized rate-limit update. Try Refresh or update Codex Usage.'; render(); }
          } else if (method === 'account/updated') {
            // Account may have switched: never retain the previous account's quota.
            accountRevision++; limits = {}; lastRefresh = 0; lastActivity = 0; render();
            log('Account changed; discarded cached usage and scheduled a new read.');
            if (busy) refreshAgain = true;
            else void refresh();
          }
        }, e => {
          if (disposed || current !== generation) return;
          log(`Connection closed: ${e.message}`); rpc = undefined; error = e.message; render();
        }, log);
        await rpc.request('initialize', { clientInfo: { name: 'codex_usage_vscode', title: 'Codex Usage', version: '0.1.0' }, capabilities: null });
        rpc.notify('initialized');
      }
      const account = accountRevision;
      updatesDuringRead = [];
      const result = await rpc.request('account/rateLimits/read');
      if (!disposed && current === generation && account === accountRevision) {
        let next: Limits;
        try { next = parseSnapshot(result); }
        catch (e) { log(`account/rateLimits/read parsing/validation failed: ${e instanceof Error ? e.message : 'unknown error'}`); throw e; }
        for (const update of updatesDuringRead) next = mergeUpdate(next, update);
        accept(next);
        log(`Usage snapshot accepted. 5-hour available=${!!windows(next).fiveHour}; weekly available=${!!windows(next).weekly}.`);
      }
    } catch (e) {
      if (!disposed && current === generation) {
        error = e instanceof Error ? e.message : 'Codex usage unavailable.';
        log(`Refresh failed: ${error}`);
        rpc?.dispose(); rpc = undefined; render();
      }
    } finally {
      updatesDuringRead = undefined;
      busy = false;
      for (const resolve of refreshWaiters.splice(0)) resolve();
      if (!disposed && (current !== generation || refreshAgain)) { refreshAgain = false; void refresh(); }
    }
  }
  async function manualRefresh(): Promise<void> {
    await refresh();
    if (!disposed && error) {
      const choice = await vscode.window.showErrorMessage(`Codex Usage refresh failed: ${error}`, 'Show Output');
      if (choice === 'Show Output') output.show(true);
    }
  }
  function schedule(): void {
    if (timer) clearInterval(timer);
    const seconds = vscode.workspace.getConfiguration('codexUsage').get<number>('refreshInterval', 60);
    if (seconds > 0) {
      const interval = Math.max(60, seconds) * 1000;
      timer = setInterval(() => { if (Date.now() - lastActivity >= interval) void refresh(); }, interval);
    }
  }
  const uiTimer = setInterval(render, 30000); // Countdown only; no reads or quota reset inference.
  context.subscriptions.push(fiveHourBar, weeklyBar,
    vscode.commands.registerCommand('codexUsage.refresh', manualRefresh),
    vscode.commands.registerCommand('codexUsage.showDetails', () => vscode.window.showInformationMessage(
      (error ? `${error}\n\nCached snapshot:\n` : '') + formatDetails(limits, lastRefresh), { modal: true }, 'Refresh').then(choice => { if (choice === 'Refresh') return manualRefresh(); })),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('codexUsage')) return;
      log('Settings changed; disposing connection and restarting.');
      generation++; rpc?.dispose(); rpc = undefined; limits = {}; lastRefresh = 0; error = ''; schedule(); void refresh();
    }),
    { dispose: () => { disposed = true; clearInterval(uiTimer); if (timer) clearInterval(timer); log('Extension disposing connection.'); rpc?.dispose(); outputDisposed = true; output.dispose(); } });
  render(); schedule(); void refresh();
}
