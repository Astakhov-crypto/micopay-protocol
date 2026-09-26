// Check helper for Micopay/micopay-protocol#394 (cross-env).
// It lives only on a throwaway branch of the contributor's fork and is not part of the PR.
//
//   node .github/ci394/run16.mjs <before|after> <nodb|db>
//   node .github/ci394/run16.mjs report
//
// before: micopay/backend/package.json is temporarily replaced by its version at BASE_SHA
// after:  the branch's own package.json (the PR change)
// nodb:   all 16 scripts, no database reachable (the in-memory fallback)
// db:     the scripts whose tests refuse the in-memory store, against a fresh migrated PostgreSQL
//
// Every script is started with `npm run <name>` through the platform's default shell,
// so on Windows npm runs the script with cmd.exe (script-shell is not configured).

import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const BACKEND = path.resolve(process.env.BACKEND_DIR || 'micopay/backend');
const OUT = path.resolve(process.env.RESULTS_DIR || 'ci394-results');
const BASE_SHA = process.env.BASE_SHA || '';
const OS = process.env.RUNNER_OS || process.platform;

const SCRIPTS = [
  'test:challenge', 'test:trade-auth', 'test:refund', 'test:discovery',
  'test:trade-flow', 'test:didit-sim', 'test:didit-webhook', 'test:cancel-policy',
  'test:refund-eligibility', 'test:meeting-point', 'test:kyc-ledger', 'test:initiator',
  'test:cash-handoff', 'test:trade-asset', 'test:trade-asset-pg', 'test:provider-inbox',
];
// Tests that print "NO VERIFICADO ... PostgreSQL real" and exit 1 on the in-memory store.
const PG_SCRIPTS = ['test:meeting-point', 'test:kyc-ledger', 'test:initiator', 'test:trade-asset-pg'];

const NOT_RECOGNIZED = /is not recognized as an internal or external command|no se reconoce como un comando/i;

function classify(code, out) {
  if (NOT_RECOGNIZED.test(out)) return 'not-recognized';
  if (code === 0) return 'passed';
  if (/NO VERIFICADO/.test(out) && /PostgreSQL/.test(out)) return 'needs-postgres';
  return 'failed';
}

function lines(out) {
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// The line that best names the failure, stripped of local paths.
function signature(out) {
  const ls = lines(out);
  const hit = ls.find((l) => NOT_RECOGNIZED.test(l))
    || ls.find((l) => /^(AssertionError|UpstreamError|TypeError|ReferenceError|Error\b|error:)/.test(l))
    || ls.find((l) => /✗/.test(l))
    || ls[ls.length - 1] || '';
  return hit.replace(/\s+at\s+.*$/, '').slice(0, 150);
}

// First line written by the test process itself (npm's banner lines start with ">").
function firstOwnLine(out) {
  const l = lines(out).find((x) => !x.startsWith('>'));
  return (l || '').slice(0, 120);
}

function sh(cmd, env) {
  const r = spawnSync(cmd, { cwd: BACKEND, env, shell: true, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const code = r.status !== null ? r.status : (r.error ? `error:${r.error.code}` : `signal:${r.signal}`);
  return { code, out };
}

async function freshDatabase(phase) {
  const req = createRequire(path.join(BACKEND, 'package.json'));
  const pg = req('pg');
  const admin = process.env.PG_ADMIN_URL;
  if (!admin) throw new Error('PG_ADMIN_URL is not set');
  const name = `micopay_ci_${phase}`;
  let lastErr;
  for (let i = 1; i <= 15; i++) {
    const c = new pg.Client({ connectionString: admin });
    try {
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name}`);
      await c.query(`CREATE DATABASE ${name}`);
      await c.end();
      const u = new URL(admin);
      u.pathname = `/${name}`;
      return u.toString();
    } catch (e) {
      lastErr = e;
      try { await c.end(); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function runPhase(phase, mode) {
  if (!['before', 'after'].includes(phase) || !['nodb', 'db'].includes(mode)) {
    throw new Error(`unknown phase/mode: ${phase} ${mode}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const pkgPath = path.join(BACKEND, 'package.json');
  const own = fs.readFileSync(pkgPath, 'utf8');
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const meta = {
    os: OS,
    phase,
    mode,
    node: process.version,
    npm: sh('npm -v', env).out.trim(),
    scriptShell: sh('npm config get script-shell', env).out.trim(),
    comspec: process.env.ComSpec || process.env.COMSPEC || '',
    baseSha: BASE_SHA,
  };
  let list = SCRIPTS;
  try {
    if (phase === 'before') {
      if (!BASE_SHA) throw new Error('BASE_SHA is not set');
      const base = execFileSync('git', ['show', `${BASE_SHA}:micopay/backend/package.json`], { cwd: BACKEND, encoding: 'utf8' });
      fs.writeFileSync(pkgPath, base);
    }
    const scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts;
    meta.crossEnvScripts = SCRIPTS.filter((s) => (scripts[s] || '').startsWith('cross-env ')).length;
    if (mode === 'db') {
      list = PG_SCRIPTS;
      env.DATABASE_URL = await freshDatabase(phase);
      const m = sh('npm run migrate', env);
      meta.migrate = { code: m.code, last: lines(m.out).slice(-1)[0] || '' };
      console.log(`::group::${OS} ${phase} ${mode}: npm run migrate (exit ${m.code})`);
      console.log(m.out);
      console.log('::endgroup::');
      if (m.code !== 0) throw new Error('migrate failed');
    }
    const only = (process.env.CI394_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (only.length) list = list.filter((s) => only.includes(s));
    const results = [];
    for (const s of list) {
      const t0 = Date.now();
      const { code, out } = sh(`npm run ${s}`, env);
      const r = { script: s, code, result: classify(code, out), sig: signature(out), first: firstOwnLine(out), seconds: Math.round((Date.now() - t0) / 1000) };
      results.push(r);
      console.log(`::group::${OS} ${phase} ${mode}: ${s} -> ${r.result} (exit ${code}, ${r.seconds}s)`);
      console.log(out);
      console.log('::endgroup::');
    }
    meta.results = results;
    fs.writeFileSync(path.join(OUT, `${OS}-${phase}-${mode}.json`), JSON.stringify(meta, null, 2));
    console.log(`${OS} ${phase} ${mode}: ` + results.map((r) => `${r.script}=${r.result}`).join(' '));
  } finally {
    fs.writeFileSync(pkgPath, own);
  }
}

function readAll(dir) {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) found.push(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

function cell(r) {
  if (!r) return 'not run';
  if (r.result === 'passed') return 'passed';
  if (r.result === 'needs-postgres') return 'needs PostgreSQL (refuses in-memory store)';
  if (r.result === 'not-recognized') return '**not recognized** by cmd.exe';
  return `failed: \`${r.sig.replace(/\|/g, '/').replace(/`/g, "'")}\``;
}

function report() {
  const runs = readAll(OUT);
  const get = (os, phase, mode) => runs.find((r) => r.os === os && r.phase === phase && r.mode === mode);
  const oses = ['Linux', 'Windows'];
  const out = [];
  out.push('## #394 cross-env: each script, before and after, Linux and Windows');
  out.push('');
  for (const os of oses) {
    const m = get(os, 'after', 'nodb') || get(os, 'before', 'nodb');
    if (m) out.push(`- ${os}: node ${m.node}, npm ${m.npm}, npm script-shell \`${m.scriptShell && m.scriptShell !== 'null' ? m.scriptShell : 'not set (default)'}\`${m.comspec ? `, ComSpec \`${m.comspec}\`` : ''}`);
  }
  out.push('');
  for (const mode of ['nodb', 'db']) {
    out.push(mode === 'nodb'
      ? '### No database reachable (in-memory fallback)'
      : '### Fresh migrated PostgreSQL (`npm run migrate`, then the script with `DATABASE_URL`)');
    out.push('');
    out.push('| Script | Linux before | Linux after | Windows before | Windows after |');
    out.push('|---|---|---|---|---|');
    const names = mode === 'nodb' ? SCRIPTS : PG_SCRIPTS;
    for (const s of names) {
      const row = [s];
      for (const os of oses) {
        for (const phase of ['before', 'after']) {
          const run = get(os, phase, mode);
          row.push(cell(run && run.results.find((r) => r.script === s)));
        }
      }
      out.push(`| \`${row[0]}\` | ${row.slice(1).join(' | ')} |`);
    }
    out.push('');
  }
  // Checks the acceptance criteria can be read from.
  const checks = [];
  for (const mode of ['nodb', 'db']) {
    const b = get('Linux', 'before', mode);
    const a = get('Linux', 'after', mode);
    if (b && a) {
      const diff = a.results.filter((r) => {
        const x = b.results.find((y) => y.script === r.script);
        return !x || x.result !== r.result || x.sig !== r.sig;
      });
      checks.push(`- Linux, ${mode}: ${diff.length === 0 ? 'same result and same failure line before and after for every script' : 'DIFFERENT: ' + diff.map((d) => d.script).join(', ')}`);
    }
    const wa = get('Windows', 'after', mode);
    if (wa) {
      const nr = wa.results.filter((r) => r.result === 'not-recognized');
      checks.push(`- Windows after, ${mode}: ${nr.length === 0 ? 'no "not recognized" error, every script started' : 'STILL NOT RECOGNIZED: ' + nr.map((d) => d.script).join(', ')}`);
    }
    const wb = get('Windows', 'before', mode);
    if (wb) {
      const nr = wb.results.filter((r) => r.result === 'not-recognized');
      checks.push(`- Windows before, ${mode}: ${nr.length}/${wb.results.length} scripts fail with "not recognized"`);
    }
  }
  for (const os of oses) {
    const a = get(os, 'after', 'nodb');
    if (a) checks.push(`- ${os}: ${a.crossEnvScripts}/16 scripts start with \`cross-env\` in the tested package.json`);
  }
  out.push('### Checks');
  out.push('');
  out.push(...checks);
  const md = out.join('\n') + '\n';
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
}

const [cmd, mode] = process.argv.slice(2);
if (cmd === 'report') report();
else await runPhase(cmd, mode);
