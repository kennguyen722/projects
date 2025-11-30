#!/usr/bin/env node
/* Cross-platform demo seeder: seeds events into ingestion-service and opens the dashboard. */
const { spawn } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { count: 200, ingestUrl: process.env.INGEST_URL || 'http://localhost:3001/ingest', bringup: false, open: true, maxSkewSeconds: 600, sampleOnly: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--count' && args[i+1]) { opts.count = parseInt(args[++i], 10) || opts.count; }
    else if (a === '--ingest' && args[i+1]) { opts.ingestUrl = args[++i]; }
    else if (a === '--bringup') { opts.bringup = true; }
    else if (a === '--no-open') { opts.open = false; }
    else if (a === '--max-skew' && args[i+1]) { opts.maxSkewSeconds = parseInt(args[++i], 10) || opts.maxSkewSeconds; }
    else if (a === '--sample-only') { opts.sampleOnly = true; }
  }
  return opts;
}

function sh(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', cwd });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}

async function bringUpStack(rootDir) {
  const infraDir = join(rootDir, 'infra');
  if (!existsSync(infraDir)) return;
  try {
    await sh('docker', ['compose', 'up', '-d'], infraDir);
  } catch (e) {
    console.warn('[demo] Unable to bring up stack automatically:', e.message);
  }
}

async function waitReachable(url, timeoutMs = 60000) {
  const began = Date.now();
  while (Date.now() - began < timeoutMs) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      await fetch(url, { method: 'GET', signal: ctrl.signal }).catch(() => {});
      clearTimeout(t);
      return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
}

function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeEvent(maxSkewSeconds) {
  const levels = ['debug','info','warn','error'];
  const sources = ['frontend','api','payments','search','auth'];
  const messages = [
    'User signed in','User signed out','Created order','Processed payment','Search query slow',
    'Cache miss','Cache hit','DB timeout','DB connection reset','Rate limit exceeded',
    'Feature flag toggled','Background job started','Background job completed','Webhook delivered','Webhook retry'
  ];
  const now = new Date();
  const skew = Math.floor(Math.random() * maxSkewSeconds);
  const ts = new Date(now.getTime() - skew * 1000).toISOString();
  const r = Math.floor(Math.random() * 100);
  const lvl = r < 5 ? 'error' : r < 20 ? 'warn' : r < 80 ? 'info' : 'debug';
  return {
    source: randomItem(sources),
    level: lvl,
    message: randomItem(messages),
    timestamp: ts,
    context: { requestId: crypto.randomUUID(), region: randomItem(['us-east','us-west','eu-central']) }
  };
}

async function postJson(url, obj) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  if (!res.ok && res.status !== 202) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${txt}`);
  }
}

async function openBrowser(url) {
  const plat = process.platform;
  const cmd = plat === 'win32' ? 'cmd' : plat === 'darwin' ? 'open' : 'xdg-open';
  const args = plat === 'win32' ? ['/c', 'start', '', url] : [url];
  try { await sh(cmd, args, process.cwd()); } catch (_) {}
}

async function seedFromSample(rootDir, ingestUrl) {
  const path = join(rootDir, 'scripts', 'sample-events.jsonl');
  if (!existsSync(path)) return false;
  const data = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  let sent = 0;
  for (const line of data) {
    try { await postJson(ingestUrl, JSON.parse(line)); sent++; if (sent % 20 === 0) console.log(`[demo] Seeded ${sent} events...`); } catch (e) { console.warn('[demo] seed error:', e.message); }
  }
  console.log(`[demo] Done. Seeded ${sent} sample events.`);
  return true;
}

async function main() {
  const opts = parseArgs();
  const rootDir = __dirname.includes('scripts') ? join(__dirname, '..') : process.cwd();
  if (opts.bringup) await bringUpStack(rootDir);
  await waitReachable(opts.ingestUrl, 30000);

  // Try sample first
  const usedSample = await seedFromSample(rootDir, opts.ingestUrl);
  if (!usedSample && !opts.sampleOnly) {
    console.log(`[demo] Generating ${opts.count} synthetic events...`);
    for (let i = 1; i <= opts.count; i++) {
      try { await postJson(opts.ingestUrl, makeEvent(opts.maxSkewSeconds)); } catch (e) { console.warn('[demo] seed error:', e.message); }
      if (i % 20 === 0) console.log(`[demo] Seeded ${i} events...`);
    }
    console.log('[demo] Done seeding synthetic events.');
  } else if (!usedSample && opts.sampleOnly) {
    console.warn('[demo] --sample-only specified but sample-events.jsonl not found. No events seeded.');
  }

  if (opts.open) await openBrowser('http://localhost:5173');
}

main().catch(e => { console.error('[demo] Failed:', e); process.exit(1); });
