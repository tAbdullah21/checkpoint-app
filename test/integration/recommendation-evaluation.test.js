const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

const databaseFile = useTemporaryDatabase('recommendation-evaluation');
let app;
let userId;

before(async () => {
  app = await startApp();
  const participant = app.client();
  await participant.register({ name: 'Evaluation Participant', email: 'participant@checkpoint.test' });
  const { db } = require('../../database/database');
  userId = db.prepare("SELECT id FROM users WHERE email = 'participant@checkpoint.test'").get().id;
});
after(() => app.close());

function exportFor(id) {
  return spawnSync(process.execPath, ['scripts/evaluate-recommendations.js', 'export', 'P01', String(id)], {
    cwd: path.join(__dirname, '../..'), env: { ...process.env, DATABASE_PATH: databaseFile }, encoding: 'utf8',
  });
}

describe('evaluation exports through the CLI', () => {
  it('requires a prepared participant and then freezes real recommendations with unanswered scores', () => {
    assert.notEqual(exportFor(userId).status, 0);
    const { db } = require('../../database/database');
    db.prepare("UPDATE users SET favorite_genres='RPG,Adventure' WHERE id=?").run(userId);
    for (const slug of ['elden-ring', 'cyberpunk-2077', 'baldurs-gate-3']) {
      db.prepare("INSERT INTO reviews(user_id,game_id,rating,review_text) SELECT ?,id,5,'Participant setup fixture' FROM games WHERE slug=?").run(userId, slug);
    }
    const result = exportFor(userId);
    assert.equal(result.status, 0, result.stderr);
    const snapshot = JSON.parse(result.stdout);
    assert.equal(snapshot.picks.length, 5);
    assert.ok(snapshot.picks.every((pick) => pick.usefulness === null));
    assert.ok(snapshot.picks.every((pick) => !['elden-ring', 'cyberpunk-2077', 'baldurs-gate-3'].includes(pick.slug)));
    const { summarize } = require('../../scripts/evaluate-recommendations');
    assert.equal(summarize([snapshot]).status, 'pending_human_feedback');
  });

  it('refuses a demo-domain account even when it has ratings', () => {
    const { db } = require('../../database/database');
    db.prepare("UPDATE users SET email='participant@demo.checkpoint.local' WHERE id=?").run(userId);
    assert.notEqual(exportFor(userId).status, 0);
  });
});
