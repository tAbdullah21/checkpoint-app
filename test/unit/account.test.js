const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const bcrypt = require('bcryptjs');
const { EXPORT_FORMAT, buildAccountExport, exportFileName } = require('../../lib/account-export');
const {
  BCRYPT_ROUNDS,
  PASSWORD_MAX_BYTES,
  UNKNOWN_USER_HASH,
  hashPassword,
  passwordErrors,
  passwordMatches,
} = require('../../lib/auth');
const { describeDevice } = require('../../lib/devices');

describe('password rules', () => {
  it('accepts 8+ characters with a letter and a number', () => {
    assert.deepEqual(passwordErrors('Checkpoint2026', 'Checkpoint2026'), []);
    assert.deepEqual(passwordErrors('كلمةسر2026x', 'كلمةسر2026x'), [], 'any alphabet works next to a Latin letter');
  });

  it('accepts Arabic-only letters with digits (defect 1 in 2.4)', () => {
    // In 2.4 this fails because /[A-Za-z]/ only matches Latin letters.
    // In 3.0 \\p{L}/u matches any Unicode letter.
    assert.deepEqual(passwordErrors('كلمةالسر2026', 'كلمةالسر2026'), []);
    assert.deepEqual(passwordErrors('رمزعبور2026', 'رمزعبور2026'), []);
    assert.deepEqual(passwordErrors('سري12345', 'سري12345'), []);
  });

  it('rejects emoji-only passwords that are too short in code points (defect 2 in 2.4)', () => {
    // In 2.4, '😀😀😀a1'.length === 8 (UTF-16 units) so it passes.
    // In 3.0, characterLength counts code points: 5, so it's correctly rejected.
    assert.deepEqual(passwordErrors('😀😀😀a1', '😀😀😀a1'), ['Password must contain at least 8 characters, including a letter and a number.']);
    // But emoji + real letters + digits works when code points >= 8
    assert.deepEqual(passwordErrors('😀😀😀كلمة123', '😀😀😀كلمة123'), []);
  });

  it('explains what is missing', () => {
    assert.match(passwordErrors('short1', 'short1')[0], /at least 8 characters/);
    assert.match(passwordErrors('onlyletters', 'onlyletters')[0], /a letter and a number/);
    assert.match(passwordErrors('12345678', '12345678')[0], /a letter and a number/);
    assert.deepEqual(passwordErrors('Checkpoint2026', 'Checkpoint2027'), ['Passwords do not match.']);
  });

  it(`refuses passwords longer than bcrypt can use (${PASSWORD_MAX_BYTES} bytes)`, () => {
    const longest = `A1${'x'.repeat(PASSWORD_MAX_BYTES - 2)}`;
    assert.deepEqual(passwordErrors(longest, longest), []);
    assert.match(passwordErrors(`${longest}x`, `${longest}x`)[0], /72 bytes or fewer \(about 72 English or 36 Arabic letters\)/);
    const arabic = `A1${'ك'.repeat(40)}`; // 42 characters but 82 bytes
    assert.match(passwordErrors(arabic, arabic)[0], /72 bytes or fewer \(about 72 English or 36 Arabic letters\)/);
  });
});

// Basis path testing (TESTING.md, "Test design"): passwordErrors has five decisions, so its cyclomatic
// complexity is 6 and six paths cover every branch. Each path below changes one decision of the first.
describe('passwordErrors: the six basis paths', () => {
  const RULE = 'Password must contain at least 8 characters, including a letter and a number.';
  const TOO_LONG = 'Password must be 72 bytes or fewer (about 72 English or 36 Arabic letters).';
  const paths = [
    ['P1: a valid password, typed twice', 'Checkpoint1', 'Checkpoint1', []],
    ['P2: shorter than 8 characters', 'Ab1', 'Ab1', [RULE]],
    ['P3: no letter', '12345678', '12345678', [RULE]],
    ['P4: no number', 'abcdefgh', 'abcdefgh', [RULE]],
    ['P5: longer than 72 bytes', `A1${'x'.repeat(71)}`, `A1${'x'.repeat(71)}`, [TOO_LONG]],
    ['P6: the confirmation differs', 'Checkpoint1', 'Checkpoint2', ['Passwords do not match.']],
  ];
  for (const [name, password, confirmation, expected] of paths) {
    it(name, () => assert.deepEqual(passwordErrors(password, confirmation), expected));
  }
});

describe('password hashing', () => {
  it(`stores bcrypt hashes with ${BCRYPT_ROUNDS} rounds and checks them`, async () => {
    const hash = await hashPassword('Checkpoint2026');
    assert.match(hash, new RegExp(`^\\$2[aby]\\$${BCRYPT_ROUNDS}\\$`));
    assert.equal(await passwordMatches('Checkpoint2026', hash), true);
    assert.equal(await passwordMatches('checkpoint2026', hash), false);
  });

  it('spends the same bcrypt work on unknown emails as on wrong passwords, and never accepts them', async () => {
    assert.equal(bcrypt.getRounds(UNKNOWN_USER_HASH), BCRYPT_ROUNDS);
    assert.equal(await passwordMatches('anything', null), false);
    assert.equal(await passwordMatches('', undefined), false);
  });
});

describe('describeDevice', () => {
  const cases = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Chrome on Windows', false],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'Edge on Windows', false],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', 'Safari on macOS', false],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', 'Safari on iPhone', true],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1', 'Chrome on iPhone', true],
    ['Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36', 'Samsung Internet on Android', true],
    ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Firefox on Linux', false],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Chrome on ChromeOS', false],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/122.0.0.0', 'Opera on Windows', false],
  ];

  for (const [userAgent, label, mobile] of cases) {
    it(label, () => {
      const device = describeDevice(userAgent);
      assert.equal(device.label, label);
      assert.equal(device.mobile, mobile);
    });
  }

  it('says so when it cannot tell', () => {
    assert.equal(describeDevice('').label, 'Unknown browser');
    assert.equal(describeDevice('curl/8.5.0').label, 'Unknown browser');
    assert.equal(describeDevice(undefined).label, 'Unknown browser');
    assert.equal(describeDevice('SomethingNew (Windows NT 10.0)').label, 'A browser on Windows');
  });
});

describe('account export', () => {
  const rows = {
    account: {
      id: 3, name: 'Lina Al-Harbi', email: 'lina@example.com', bio: 'Lore hunter', steam_id: 'LinaPlays', psn_id: '', xbox_id: '',
      steam_visible: 1, psn_visible: 0, xbox_visible: 1, preferred_platform: 'steam', favorite_genres: 'RPG,Adventure',
      profile_public: 1, created_at: '2025-12-20 10:00:00', password_hash: '$2b$10$shouldNeverAppear',
    },
    library: [{ slug: 'elden-ring', title: 'Elden Ring', status: 'completed', is_favorite: 1, added_at: '2026-01-02 10:00:00', updated_at: '2026-02-01 10:00:00' }],
    reviews: [{ id: 12, slug: 'elden-ring', title: 'Elden Ring', rating: 5, review_text: 'Brutal and fair.', created_at: '2026-02-01 10:00:00', updated_at: '2026-02-01 10:00:00', helpful_votes: 4 }],
    replies: [{ body: 'Malenia, forty tries.', created_at: '2026-02-02 10:00:00', slug: 'elden-ring', title: 'Elden Ring', review_id: 12 }],
    votes: [{ slug: 'it-takes-two', title: 'It Takes Two', review_id: 30, created_at: '2026-03-01 10:00:00' }],
    lists: [{ id: 5, title: 'Worlds worth getting lost in', description: 'Huge maps.', created_at: '2026-04-01 10:00:00', updated_at: '2026-04-02 10:00:00' }],
    listItems: [{ list_id: 5, slug: 'elden-ring' }, { list_id: 5, slug: 'the-witcher-3-wild-hunt' }],
    following: [{ id: 8, name: 'Omar', profile_public: 1, created_at: '2026-05-01 10:00:00' }, { id: 9, name: 'Sara', profile_public: 0, created_at: '2026-05-02 10:00:00' }],
    followerCount: 3,
    activity: [{ type: 'review', detail: '5', created_at: '2026-02-01 10:00:00', slug: 'elden-ring', list_title: null }],
    securityEvents: [{
      type: 'password_changed',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      created_at: '2026-06-01 10:00:00',
    }],
    reports: [{
      kind: 'reply', review_id: null, comment_id: 44, slug: 'elden-ring', reason: 'spam', note: '', status: 'kept',
      created_at: '2026-07-01 10:00:00', resolved_at: '2026-07-02 10:00:00',
    }],
    moderation: [{ action: 'remove_review', reason: 'spoilers', content: 'The ending is a twist.', created_at: '2026-08-01 10:00:00', title: 'Elden Ring' }],
  };
  const file = buildAccountExport(rows, new Date('2026-10-16T12:00:00Z'));
  // Every key in the file, at any depth.
  const keys = (value) => (value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => [...(Array.isArray(value) ? [] : [key]), ...keys(child)])
    : []);

  it('names the format and the export time', () => {
    assert.equal(file.format, EXPORT_FORMAT);
    assert.equal(file.exportedAt, '2026-10-16T12:00:00.000Z');
    assert.equal(exportFileName(new Date('2026-10-16T12:00:00Z')), 'checkpoint-data-2026-10-16.json');
  });

  it('uses readable values and ISO 8601 dates', () => {
    assert.deepEqual(file.account.favoriteGenres, ['RPG', 'Adventure']);
    assert.equal(file.account.memberSince, '2025-12-20T10:00:00.000Z');
    assert.deepEqual(file.account.gamingAccounts.playstation, { id: '', shownOnProfile: false });
    assert.equal(file.library[0].status, 'Completed');
    assert.equal(file.library[0].favorite, true);
    assert.equal(file.reviews[0].link, '/games/elden-ring#review-12');
    assert.equal(file.replies[0].onReview, '/games/elden-ring#review-12');
    assert.deepEqual(file.lists[0].games, ['elden-ring', 'the-witcher-3-wild-hunt']);
    assert.equal(file.followerCount, 3);
  });

  it('includes security activity, reports and moderation decisions', () => {
    assert.deepEqual(file.securityActivity, [{
      event: 'password_changed',
      browser: 'Chrome on Windows',
      userAgent: rows.securityEvents[0].user_agent,
      at: '2026-06-01T10:00:00.000Z',
    }]);
    assert.deepEqual(file.reportsMade, [{
      about: 'reply', link: '/games/elden-ring#comment-44', reason: 'spam', note: null, status: 'kept',
      reported: '2026-07-01T10:00:00.000Z', decided: '2026-07-02T10:00:00.000Z',
    }]);
    assert.deepEqual(file.moderationOfYourPosts, [{
      decision: 'removed', post: 'review', game: 'Elden Ring', reason: 'spoilers', text: 'The ending is a twist.', decided: '2026-08-01T10:00:00.000Z',
    }]);
  });

  it('keeps private members, reporters and moderators anonymous and never includes the password hash', () => {
    assert.deepEqual(file.following.map((member) => member.name), ['Omar', 'Private member']);
    assert.ok(!JSON.stringify(file).includes('shouldNeverAppear'));
    assert.deepEqual(keys(file).filter((key) => /password|hash|token|reporter|moderator/i.test(key)), []);
  });
});
