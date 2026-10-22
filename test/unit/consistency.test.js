// Lists that live in two places stay in step. The database accepts a fixed set of values in its CHECK
// constraints (database/), and the services give each value its words and icon (lib/). If someone adds a kind of
// notification, a report reason or a security event on one side only, these tests fail before a member sees an
// empty sentence or the database refuses a row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, describe, it } = require('node:test');
const { useTemporaryDatabase } = require('../helpers');

const databaseFile = useTemporaryDatabase('consistency');
const { closeDatabase } = require('../../database/database');
const { MODERATION_ACTIONS, REPORT_REASON_VALUES } = require('../../database/moderation');
const { NOTIFICATION_TYPES } = require('../../database/notifications');
const { SECURITY_EVENT_TYPES } = require('../../database/security');
const { REPORT_REASONS, describeLogEntry } = require('../../lib/moderation');
const { KINDS } = require('../../lib/notifications');
const { SECURITY_EVENTS } = require('../../lib/security-activity');
const { ICON_NAMES, icon } = require('../../lib/view-helpers');

after(() => {
  closeDatabase();
  for (const file of [databaseFile, `${databaseFile}-shm`, `${databaseFile}-wal`]) fs.rmSync(file, { force: true });
});

describe('values stored in the database and described in lib/', () => {
  it('gives every notification type a sentence', () => {
    assert.deepEqual(Object.keys(KINDS), NOTIFICATION_TYPES);
  });

  it('gives every report reason a label and a hint', () => {
    assert.deepEqual(Object.keys(REPORT_REASONS), REPORT_REASON_VALUES);
    for (const reason of Object.values(REPORT_REASONS)) assert.ok(reason.label && reason.hint);
  });

  it('gives every security event a label', () => {
    assert.deepEqual(Object.keys(SECURITY_EVENTS), SECURITY_EVENT_TYPES);
  });

  it('gives every moderation decision a label for the log', () => {
    for (const action of MODERATION_ACTIONS) {
      assert.match(describeLogEntry({ action, report_count: 1 }).actionLabel, /^(Removed|Kept) a (review|reply)$/, action);
    }
  });
});

describe('icons', () => {
  it('draws every icon name in the SVG sprite, and nothing else', () => {
    const sprite = fs.readFileSync(path.join(__dirname, '..', '..', 'views', 'partials', 'icon-sprite.ejs'), 'utf8');
    const symbols = [...sprite.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...symbols].sort(), [...ICON_NAMES].sort());
  });

  it('uses only icons that exist for notifications and security events', () => {
    for (const { icon: name } of [...Object.values(KINDS), ...Object.values(SECURITY_EVENTS)]) {
      assert.doesNotThrow(() => icon(name), name);
    }
  });
});
