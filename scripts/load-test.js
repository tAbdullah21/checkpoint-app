/*
 * Load test for NFR-14: many members browsing at the same time.
 *
 *   npm run load-test                                  25 members for 20 seconds
 *   npm run load-test -- --members=50 --seconds=30     more members, for longer
 *   npm run load-test -- --p95=500                     another goal, in milliseconds
 *
 * The script copies nothing and changes nothing of yours: it creates a throwaway database with the demo
 * community, starts Checkpoint on a free port with it, signs in the members, and lets each of them open pages
 * one after another without pausing (catalogue, game pages, For You, library, activity, profiles, Versus, tier
 * lists, the search API) and sometimes mark a review as helpful. The server runs as it would on a host: NODE_ENV=production behind
 * an HTTPS proxy (TRUST_PROXY=1, each member with their own address). Then the script prints the response times
 * per page and checks the goal: 95% of requests answered within 300 ms, and none failing. The exit code is 1 when
 * the goal is missed, so the check can run in a pipeline. Sign-ins are timed separately, because bcrypt makes
 * them slow on purpose.
 */
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const GOAL = { percentile: 95, milliseconds: 300 };
const OPTIONS = { members: 25, seconds: 20, p95: GOAL.milliseconds };
const DEMO_PASSWORD = 'Checkpoint2026';
const root = path.join(__dirname, '..');

// "--members=50" style options; anything else is a mistake worth pointing out.
function readOptions(argv) {
  const options = { ...OPTIONS };
  for (const argument of argv) {
    if (argument === '--') continue;
    const match = argument.match(/^--(members|seconds|p95)=(\d+)$/);
    if (!match || Number(match[2]) < 1) throw new Error(`Unknown option "${argument}". Use --members=N, --seconds=N and --p95=MS.`);
    options[match[1]] = Number(match[2]);
  }
  return options;
}

// The nearest-rank percentile of sorted numbers: the smallest value that at least p% of the values do not exceed.
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarize(times) {
  const sorted = [...times].sort((first, second) => first - second);
  return {
    count: sorted.length,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) || 0,
  };
}

// The pages a member opens, with how often each is picked. Paths can depend on the demo data.
function pageMix({ slugs, memberIds, reviewIds }) {
  const pick = (values) => values[Math.floor(Math.random() * values.length)];
  return [
    { name: 'Dashboard', weight: 3, path: () => '/' },
    { name: 'Game catalogue', weight: 3, path: () => '/games' },
    { name: 'Catalogue search', weight: 1, path: () => '/games?query=the&sort=rating' },
    { name: 'Game page', weight: 4, path: () => `/games/${pick(slugs)}` },
    { name: 'For You', weight: 2, path: () => '/for-you' },
    { name: 'Library', weight: 2, path: () => '/library' },
    { name: 'Activity', weight: 2, path: () => '/activity' },
    { name: 'Members', weight: 1, path: () => '/members' },
    { name: 'Player page', weight: 2, path: () => `/members/${pick(memberIds)}` },
    { name: 'Lists', weight: 1, path: () => '/lists' },
    { name: 'Notifications', weight: 1, path: () => '/notifications' },
    { name: 'Wrapped', weight: 1, path: () => '/wrapped' },
    { name: 'Versus', weight: 1, path: () => `/versus?a=${pick(slugs)}&b=${pick(slugs)}` },
    { name: 'Tier list', weight: 1, path: () => '/tiers' },
    { name: 'Search API', weight: 1, path: () => '/api/search?q=el' },
    { name: 'Helpful vote', weight: 1, method: 'POST', expect: 302, path: () => `/reviews/${pick(reviewIds)}/like` },
  ];
}

function weightedPicker(pages) {
  const total = pages.reduce((sum, page) => sum + page.weight, 0);
  return () => {
    let ticket = Math.random() * total;
    for (const page of pages) {
      ticket -= page.weight;
      if (ticket < 0) return page;
    }
    return pages.at(-1);
  };
}

function startServer(databaseFile) {
  const child = spawn(process.execPath, ['app.js'], {
    cwd: root,
    env: { ...process.env, PORT: '0', DATABASE_PATH: databaseFile, NODE_ENV: 'production', SESSION_SECRET: crypto.randomBytes(32).toString('hex'), TRUST_PROXY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/running at http:\/\/localhost:(\d+)/);
      if (match) resolve({ child, baseUrl: `http://127.0.0.1:${match[1]}`, errors: () => errors });
    });
    child.once('exit', (code) => reject(new Error(`Checkpoint stopped before it was ready (exit code ${code}). ${errors}`)));
  });
}

async function signIn(baseUrl, email, proxy) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { ...proxy, 'content-type': 'application/x-www-form-urlencoded', origin: baseUrl },
    body: new URLSearchParams({ email, password: DEMO_PASSWORD }).toString(),
  });
  await response.arrayBuffer();
  const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
  if (response.status !== 302 || !cookie) throw new Error(`Signing in as ${email} failed (${response.status}).`);
  return { cookie, proxy, time: performance.now() - started };
}

// One member: open a page, wait for the whole answer, open the next one, until the time is up.
async function browse({ baseUrl, cookie, proxy, nextPage, until, results }) {
  while (performance.now() < until) {
    const page = nextPage();
    const method = page.method || 'GET';
    const started = performance.now();
    let ok;
    try {
      const response = await fetch(`${baseUrl}${page.path()}`, {
        method,
        redirect: 'manual',
        headers: method === 'POST' ? { ...proxy, cookie, origin: baseUrl, 'content-type': 'application/x-www-form-urlencoded' } : { ...proxy, cookie },
      });
      await response.arrayBuffer();
      ok = response.status === (page.expect || 200);
    } catch {
      // A refused or broken connection counts as a failed request.
      ok = false;
    }
    const entry = results.get(page.name) || { times: [], errors: 0 };
    entry.times.push(performance.now() - started);
    if (!ok) entry.errors += 1;
    results.set(page.name, entry);
  }
}

const formatMs = (value) => `${Math.round(value)} ms`;
const formatCount = (value) => value.toLocaleString('en-US');

function printTable(rows) {
  const header = ['Page', 'Requests', 'Median', 'p95', 'p99', 'Max', 'Errors'];
  const lines = [header, ...rows.map((row) => [row.name, formatCount(row.count), formatMs(row.median), formatMs(row.p95), formatMs(row.p99), formatMs(row.max), String(row.errors)])];
  const widths = header.map((_, column) => Math.max(...lines.map((line) => line[column].length)));
  for (const [index, line] of lines.entries()) {
    console.log(line.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('   '));
    if (index === 0 || index === lines.length - 2) console.log(widths.map((width) => '-'.repeat(width)).join('   '));
  }
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const databaseFile = path.join(os.tmpdir(), `checkpoint-load-${process.pid}-${Date.now()}.db`);
  const removeDatabase = () => {
    for (const file of [databaseFile, `${databaseFile}-shm`, `${databaseFile}-wal`]) fs.rmSync(file, { force: true, maxRetries: 5 });
  };
  let server;

  try {
    console.log(`Checkpoint load test: ${options.members} members browsing at the same time for ${options.seconds} seconds.`);
    console.log('It uses a throwaway copy of the demo community; your own data is not touched.\n');

    const seed = spawnSync(process.execPath, ['scripts/seed-demo.js'], { cwd: root, env: { ...process.env, DATABASE_PATH: databaseFile }, encoding: 'utf8' });
    if (seed.status !== 0) throw new Error(`The demo data could not be created: ${seed.stderr}`);
    const data = new DatabaseSync(databaseFile, { readOnly: true });
    const demo = {
      emails: data.prepare("SELECT email FROM users WHERE email LIKE '%@demo.checkpoint.local' ORDER BY id").all().map((row) => row.email),
      slugs: data.prepare('SELECT slug FROM games ORDER BY id').all().map((row) => row.slug),
      memberIds: data.prepare('SELECT id FROM users WHERE profile_public = 1 ORDER BY id').all().map((row) => row.id),
      reviewIds: data.prepare('SELECT id FROM reviews ORDER BY id').all().map((row) => row.id),
    };
    data.close();

    server = await startServer(databaseFile);
    const signIns = [];
    for (let index = 0; index < options.members; index += 1) {
      // Each member comes from their own address, through the HTTPS proxy a server runs behind.
      const proxy = { 'x-forwarded-proto': 'https', 'x-forwarded-for': `198.51.100.${index + 1}` };
      signIns.push(await signIn(server.baseUrl, demo.emails[index % demo.emails.length], proxy));
    }
    const signInTimes = summarize(signIns.map((entry) => entry.time));
    console.log(`Signed in ${options.members} members (bcrypt on purpose: median ${formatMs(signInTimes.median)} each).\n`);

    const results = new Map();
    const nextPage = weightedPicker(pageMix(demo));
    const started = performance.now();
    const until = started + options.seconds * 1000;
    await Promise.all(signIns.map(({ cookie, proxy }) => browse({ baseUrl: server.baseUrl, cookie, proxy, nextPage, until, results })));
    const elapsed = (performance.now() - started) / 1000;

    const rows = [...results.entries()]
      .map(([name, entry]) => ({ name, ...summarize(entry.times), errors: entry.errors }))
      .sort((first, second) => second.count - first.count);
    const allTimes = [...results.values()].flatMap((entry) => entry.times);
    const total = { name: 'All requests', ...summarize(allTimes), errors: rows.reduce((sum, row) => sum + row.errors, 0) };
    printTable([...rows, total]);

    const met = total.p95 <= options.p95 && total.errors === 0;
    console.log(`\nThroughput: ${formatCount(Math.round(total.count / elapsed))} requests per second.`);
    console.log(`Goal (NFR-14): ${GOAL.percentile}% of requests within ${options.p95} ms and none failing: ${met ? 'met' : 'NOT met'} (p${GOAL.percentile} ${formatMs(total.p95)}, ${total.errors} failed).`);
    if (server.errors()) console.log(`\nThe server wrote errors:\n${server.errors()}`);
    process.exitCode = met ? 0 : 1;
  } finally {
    if (server) {
      const stopped = new Promise((resolve) => server.child.once('exit', resolve));
      server.child.kill('SIGTERM');
      await stopped;
    }
    removeDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { GOAL, OPTIONS, percentile, readOptions, summarize };
