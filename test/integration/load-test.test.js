// The load test script (NFR-14, `npm run load-test`): its statistics, its options, and one short run with a
// few members, which must finish without a failed request and leave no database behind.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { OPTIONS, percentile, readOptions, summarize } = require('../../scripts/load-test');

describe('load test statistics', () => {
  it('uses the nearest-rank percentile', () => {
    const sorted = Array.from({ length: 20 }, (_, index) => index + 1);
    assert.equal(percentile(sorted, 50), 10);
    assert.equal(percentile(sorted, 95), 19);
    assert.equal(percentile(sorted, 99), 20);
    assert.equal(percentile([7], 95), 7);
    assert.equal(percentile([], 95), 0);
  });

  it('sums up response times in any order', () => {
    assert.deepEqual(summarize([30, 10, 20]), { count: 3, median: 20, p95: 30, p99: 30, max: 30 });
  });

  it('reads its options and refuses unknown ones', () => {
    assert.deepEqual(readOptions([]), OPTIONS);
    assert.deepEqual(readOptions(['--', '--members=50', '--seconds=5', '--p95=400']), { members: 50, seconds: 5, p95: 400 });
    assert.throws(() => readOptions(['--users=5']), /Unknown option "--users=5"/);
    assert.throws(() => readOptions(['--members=0']), /Unknown option/);
  });
});

describe('a short run', () => {
  it('serves every request of three members for a second, then cleans up', async () => {
    const leftovers = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('checkpoint-load-'));
    const before = leftovers();
    // A generous goal: this run checks that nothing fails, not how fast this computer is.
    const child = spawn(process.execPath, ['scripts/load-test.js', '--members=3', '--seconds=1', '--p95=10000'], {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const code = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(code, 0, output);
    assert.match(output, /^All requests\s+[\d,]+ /m);
    assert.match(output, /Goal \(NFR-14\): 95% of requests within 10000 ms and none failing: met \(p95 \d+ ms, 0 failed\)\./);
    assert.deepEqual(leftovers(), before, 'the throwaway database is deleted');
  });
});
