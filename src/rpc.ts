import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { object } from './limits';
import { Log, redactText, responseShape } from './diagnostics';

export class RpcError extends Error {
  constructor(public code: number, public needsLogin: boolean) {
    super(needsLogin ? 'Codex is not authenticated. Sign in with Codex, then refresh.' : `Codex RPC failed (code ${code}). The method may be unsupported or account limits unavailable.`);
  }
}
export class Rpc {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { method: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private closed = false;
  constructor(executable: string, args: string[], onEvent: (method: string, params: unknown) => void, onClose: (error: Error) => void, private log: Log = () => {}) {
    log(`Starting Codex process: ${args[0] === 'app-server' && args[1] === '--listen' && args[2] === 'stdio://' ? 'app-server --listen stdio://' : '(arguments omitted)'}`);
    this.child = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'pipe' });
    let stderr = '';
    this.child.stderr.setEncoding('utf8');
    // Buffer before redaction so tokens split across stream chunks cannot escape filtering.
    this.child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-65536); });
    this.child.on('spawn', () => log('Codex process started successfully. App-server connectivity is verified by initialize.'));
    this.child.stdin.on('error', () => this.fail(new Error('Codex connection closed.'), onClose));
    this.child.on('error', (e: NodeJS.ErrnoException) => {
      log(`Codex process start failed (code ${e.code ?? 'unknown'}).`);
      this.fail(new Error('Codex could not be started. Check installation and executable path.'), onClose);
    });
    this.child.on('close', (code, signal) => {
      log(`Codex process exited: code=${code}, signal=${signal ?? 'none'}.`);
      log(`Codex stderr (redacted): ${stderr ? redactText(stderr) : '(empty)'}`);
      this.fail(new Error(`Codex process exited (code ${code}, signal ${signal ?? 'none'}). Check Codex Usage output for app-server diagnostics.`), onClose);
    });
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      try {
        const msg = object(JSON.parse(line));
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          log(`${p.method} response received (id=${msg.id}).`);
          if (p.method === 'account/rateLimits/read' && 'result' in msg) log(`account/rateLimits/read raw response shape: ${JSON.stringify(responseShape(msg.result))}`);
          let rpcError: RpcError | undefined;
          if (msg.error) {
            const e = object(msg.error);
            // Inspect only in memory; never display the server's arbitrary error text.
            rpcError = new RpcError(typeof e.code === 'number' ? e.code : -1, typeof e.message === 'string' && /auth|login|sign.in|unauthorized/i.test(e.message));
            log(`${p.method} RPC error: code=${rpcError.code}; ${rpcError.message}`);
          }
          this.pending.delete(msg.id); clearTimeout(p.timer);
          if (rpcError) p.reject(rpcError);
          else if ('result' in msg) p.resolve(msg.result);
          else p.reject(new Error('Unrecognized Codex RPC response.'));
        } else if (typeof msg.method === 'string' && msg.id === undefined) onEvent(msg.method, msg.params);
        else if (msg.id !== undefined && typeof msg.method === 'string') {
          this.send({ id: msg.id, error: { code: -32601, message: 'Unsupported client request' } });
        }
      } catch { log('Protocol JSON/envelope validation failed. Raw payload omitted.'); this.fail(new Error('Malformed Codex protocol response.'), onClose); }
    });
  }
  private fail(error: Error, onClose: (error: Error) => void): void {
    if (this.closed) return;
    this.dispose(error); onClose(error);
  }
  private send(message: unknown): void {
    if (this.closed) throw new Error('Codex connection closed.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  notify(method: string): void { this.send({ method, params: {} }); this.log(`${method} notification sent.`); }
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex connection closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.log(`Timeout: ${method} (id=${id}) after 15000ms.`);
        reject(new Error(`Codex ${method} request timed out after 15 seconds.`));
      }, 15000);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.send({ id, method, ...(params === undefined ? {} : { params }) }); this.log(`${method} request sent (id=${id}).`); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('Codex connection closed.')); }
    });
  }
  dispose(error = new Error('Codex connection closed.')): void {
    if (this.closed) return;
    this.log(`Connection disposal: ${error.message}`);
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.child.stdin.end(); this.child.kill();
  }
}
