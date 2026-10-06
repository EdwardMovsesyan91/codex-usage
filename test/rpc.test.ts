import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rpc, RpcError } from '../src/rpc';

test('transport writes LF-delimited JSON and parses fragmented UTF-8 and combined stdout lines', { timeout: 3000 }, async () => {
  // Read bytes directly, independently of readline, to verify the actual stdin framing.
  const program = `let input=Buffer.alloc(0);
    process.stdin.on('data',chunk=>{
      input=Buffer.concat([input,chunk]);
      const lf=input.indexOf(10);if(lf<0)return;
      const frame=input.subarray(0,lf+1);const m=JSON.parse(frame.subarray(0,-1).toString('utf8'));
      const exact=frame.equals(Buffer.from(JSON.stringify(m)+'\\n'));
      const first=Buffer.from(JSON.stringify({id:m.id,result:{exactLF:exact,lastByte:frame.at(-1),userAgent:'mock-é'}})+'\\n');
      const second=Buffer.from(JSON.stringify({method:'account/rateLimits/updated',params:{rateLimits:{primary:null,secondary:null}}})+'\\n');
      const split=first.indexOf(Buffer.from('é'))+1;
      process.stdout.write(first.subarray(0,split));
      setTimeout(()=>process.stdout.write(Buffer.concat([first.subarray(split),second])),10);
    });`;
  let eventResolve!: (v: unknown) => void;
  const event = new Promise(resolve => { eventResolve = resolve; });
  const rpc = new Rpc(process.execPath, ['-e', program], (method, params) => {
    assert.equal(method, 'account/rateLimits/updated'); eventResolve(params);
  }, () => {});
  try {
    const response = await rpc.request('initialize', { clientInfo: { name: 'test', version: '0.1.0' }, capabilities: null });
    assert.deepEqual(response, { exactLF: true, lastByte: 10, userAgent: 'mock-é' });
    assert.deepEqual(await event, { rateLimits: { primary: null, secondary: null } });
  } finally { rpc.dispose(); }
});

test('stdio RPC handshake, initial read, and notification', async () => {
  const program = `const rl=require('node:readline').createInterface({input:process.stdin});
    let initialized=false;
    const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
    rl.on('line',line=>{const m=JSON.parse(line);
      if(m.method==='initialize')send({id:m.id,result:{userAgent:'mock'}});
      if(m.method==='initialized')initialized=true;
      if(m.method==='account/rateLimits/read'){
        if(!initialized)send({id:m.id,error:{code:-1,message:'Not initialized'}});
        else{send({id:m.id,result:{rateLimits:{primary:null,secondary:null}}});
          send({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:12,windowDurationMins:300,resetsAt:null},secondary:null}}});}
      }
    });`;
  let eventResolve!: (v: unknown) => void;
  const event = new Promise(resolve => { eventResolve = resolve; });
  const logs: string[] = [];
  const rpc = new Rpc(process.execPath, ['-e', program], (method, params) => {
    if (method === 'account/rateLimits/updated') eventResolve(params);
  }, () => {}, message => logs.push(message));
  try {
    await rpc.request('initialize', { clientInfo: { name: 'test', version: '0.1.0' } });
    rpc.notify('initialized');
    assert.deepEqual(await rpc.request('account/rateLimits/read'), { rateLimits: { primary: null, secondary: null } });
    const received = await Promise.race([event, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('No event')), 2000); t.unref(); })]);
    assert.ok(received);
    for (const step of ['initialize request sent', 'initialize response received', 'initialized notification sent',
      'account/rateLimits/read request sent', 'account/rateLimits/read response received', 'raw response shape']) {
      assert.ok(logs.some(line => line.includes(step)), step);
    }
  } finally { rpc.dispose(); }
});
test('failed app-server logs exit code and redacted stderr across chunk boundaries', async () => {
  const logs: string[] = [];
  let closeResolve!: () => void;
  const closed = new Promise<void>(resolve => { closeResolve = resolve; });
  const program = `process.stderr.write('Error: daemon unavailable\\naccess_to');
    setTimeout(()=>{process.stderr.write('ken=split-secret\\n');process.exit(7);},20);`;
  const rpc = new Rpc(process.execPath, ['-e', program], () => {}, closeResolve, message => logs.push(message));
  try {
    await assert.rejects(rpc.request('initialize'), /exited \(code 7/);
    await closed;
    assert.ok(logs.some(line => line.includes('started successfully')));
    assert.ok(logs.some(line => line.includes('code=7')));
    assert.ok(logs.some(line => line.includes('daemon unavailable')));
    assert.ok(!logs.join('\n').includes('split-secret'));
    assert.ok(logs.some(line => line.includes('Connection disposal')));
  } finally { rpc.dispose(); }
});
test('RPC timeout names the failed protocol step and logs it', async () => {
  const logs: string[] = [];
  const originalTimeout = global.setTimeout;
  // Accelerate only the RPC's 15-second deadline, without altering implementation behavior.
  global.setTimeout = ((fn: () => void, ms: number) => originalTimeout(fn, ms === 15000 ? 100 : ms)) as typeof setTimeout;
  const rpc = new Rpc(process.execPath, ['-e', 'process.stdin.resume();'], () => {}, () => {}, message => logs.push(message));
  try {
    await assert.rejects(rpc.request('account/rateLimits/read'), /account\/rateLimits\/read request timed out/);
    assert.ok(logs.some(line => line.includes('Timeout: account/rateLimits/read')));
  } finally { global.setTimeout = originalTimeout; rpc.dispose(); }
});
test('RPC auth errors are sanitized', async () => {
  const program = `require('node:readline').createInterface({input:process.stdin}).on('line',l=>{
    const m=JSON.parse(l);process.stdout.write(JSON.stringify({id:m.id,error:{code:401,message:'Unauthorized private-value'}})+'\\n');});`;
  const rpc = new Rpc(process.execPath, ['-e', program], () => {}, () => {});
  try {
    await assert.rejects(rpc.request('account/rateLimits/read'), e => e instanceof RpcError && e.needsLogin && !e.message.includes('private-value'));
  } finally { rpc.dispose(); }
});
test('malformed JSON rejects pending reads and closes connection', async () => {
  const rpc = new Rpc(process.execPath, ['-e', `process.stdin.once('data',()=>process.stdout.write('invalid-json\\n'));`], () => {}, () => {});
  try { await assert.rejects(rpc.request('account/rateLimits/read'), /Malformed Codex protocol response/); }
  finally { rpc.dispose(); }
});
test('malformed error envelope rejects pending request without hanging', async () => {
  const program = `require('node:readline').createInterface({input:process.stdin}).on('line',l=>{
    const m=JSON.parse(l);process.stdout.write(JSON.stringify({id:m.id,error:'bad-envelope'})+'\\n');});`;
  const rpc = new Rpc(process.execPath, ['-e', program], () => {}, () => {});
  try { await assert.rejects(rpc.request('account/rateLimits/read'), /Malformed Codex protocol response/); }
  finally { rpc.dispose(); }
});
