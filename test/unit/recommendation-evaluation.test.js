const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { FORMAT, summarize, validateSnapshot } = require('../../scripts/evaluate-recommendations');

function snapshot(id, scores = [4, 5, 4, 3, 2]) {
  return {
    format: FORMAT, appVersion: '3.8.1', participantId: `P${String(id).padStart(2, '0')}`, accountId: id, synthetic: false,
    picks: scores.map((usefulness, index) => ({ rank: index + 1, slug: `game-${index}`, title: `Game ${index}`, usefulness })),
  };
}

describe('human recommendation evaluation', () => {
  it('keeps missing feedback and small samples pending', () => {
    const pending = summarize([snapshot(1, [null, null, null, null, null])]);
    assert.equal(pending.status, 'pending_human_feedback');
    assert.equal(pending.usefulnessPercent, null);
    assert.equal(summarize([snapshot(1, [5, 5, 5, 5, 5])]).status, 'pending_human_feedback');
  });

  it('measures completed independent participants against the 70% boundary', () => {
    // Synthetic in-memory fixtures verify arithmetic only; these are never acceptance results.
    const values = Array.from({ length: 10 }, (_, index) => snapshot(index + 1, index < 5 ? [4, 4, 4, 4, 3] : [4, 4, 4, 3, 3]));
    assert.equal(summarize(values).usefulnessPercent, 70);
    assert.equal(summarize(values).status, 'target_met');
    values[0].picks[0].usefulness = 3;
    assert.equal(summarize(values).status, 'target_not_met');
  });

  it('refuses duplicate participants, synthetic submissions and malformed scores', () => {
    assert.throws(() => summarize([snapshot(1), snapshot(1)]), /only once/);
    assert.throws(() => validateSnapshot({ ...snapshot(1), synthetic: true }), /Synthetic/);
    assert.throws(() => validateSnapshot(snapshot(1, [4, 5, 6, 3, 2])), /Usefulness/);
    const repeated = snapshot(1); repeated.picks[1].slug = repeated.picks[0].slug;
    assert.throws(() => validateSnapshot(repeated), /Repeated/);
  });

  it('does not accept a partial response as a final result or mix app versions', () => {
    const values = Array.from({ length: 10 }, (_, index) => snapshot(index + 1));
    values[0].picks[0].usefulness = null;
    assert.equal(summarize(values).status, 'pending_human_feedback');
    values[0].appVersion = '0.9.0';
    assert.throws(() => summarize(values), /mix app versions/);
  });
});
