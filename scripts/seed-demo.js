/*
 * Demo community for presentations and testing.
 *
 *   npm run seed:demo              add the demo members (skipped if they already exist)
 *   npm run seed:demo -- --reset   delete and recreate them, so "2 hours ago" is fresh again
 *   npm run seed:demo -- --remove  delete them and everything they created
 *
 * Demo members use @demo.checkpoint.local email addresses and the password below; Maha is a moderator.
 * Real accounts are never changed: removing the demo data only deletes users with that email domain (their
 * library, reviews, replies, follows, likes, lists, activity, notifications, reports and security activity are
 * removed with them by ON DELETE CASCADE) and the moderation decisions about them.
 */
// The same settings as the server (DATABASE_PATH in .env), so the script changes the database the site uses.
require('dotenv').config({ quiet: true });
const { db, closeDatabase } = require('../database/database');
require('../database/community'); // creates the community tables if this is a fresh database
require('../database/notifications'); // the notifications table
require('../database/moderation'); // reports and the moderation log
require('../database/security'); // security activity
require('../database/review-details'); // aspect scores, hours, platform and spoiler warnings on reviews
require('../database/tiers'); // tier lists
const { hashPassword } = require('../lib/auth');

const DEMO_DOMAIN = 'demo.checkpoint.local';
const DEMO_PASSWORD = 'Checkpoint2026';

// Browsers for the demo security activity (the account page shows them as "Chrome on Windows" and so on).
const BROWSERS = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
};

// Timestamps in the same UTC "YYYY-MM-DD HH:MM:SS" format as SQLite's CURRENT_TIMESTAMP.
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

const members = [
  {
    key: 'lina',
    name: 'Lina Al-Harbi',
    joinedDaysAgo: 300,
    bio: 'Lore hunter and achievement completionist. If the map is full of question marks, I am in.',
    steamId: 'LinaPlays',
    platform: 'steam',
    genres: 'RPG,Adventure',
    library: [
      ['elden-ring', 'completed', true, 480, 430],
      ['baldurs-gate-3', 'completed', true, 460, 300],
      ['the-witcher-3-wild-hunt', 'completed', true, 470],
      ['cyberpunk-2077', 'played', false, 260, 160],
      ['clair-obscur-expedition-33', 'playing', false, 120, 2],
      ['kingdom-come-deliverance-2', 'want_to_play', false, 26],
    ],
    reviews: [
      ['elden-ring', 5, 'Every time I thought I had seen everything, the map opened up again. Brutal, fair and unforgettable.', 428],
      ['baldurs-gate-3', 5, 'The most reactive RPG I have ever played. My second run felt like a completely different story.', 298],
      ['cyberpunk-2077', 4, 'Night City is incredible now and the side jobs are great writing. A few rough edges remain, but it is easy to recommend.', 158],
      ['clair-obscur-expedition-33', 5, 'Turn-based combat that keeps you on your toes with parries and dodges. The soundtrack alone deserves an award.', 1.5],
    ],
  },
  {
    key: 'omar',
    name: 'Omar Al-Qahtani',
    joinedDaysAgo: 240,
    bio: 'Cinematic action fan and photo mode addict.',
    psnId: 'OmarQ_PS',
    platform: 'playstation',
    genres: 'Action,Adventure',
    library: [
      ['god-of-war-ragnarok', 'completed', true, 500, 410],
      ['ghost-of-tsushima', 'completed', true, 400, 330],
      ['marvels-spider-man-2', 'completed', false, 320, 210],
      ['elden-ring', 'played', false, 200, 140],
      ['sekiro-shadows-die-twice', 'playing', false, 70],
      ['death-stranding-2', 'want_to_play', false, 12],
    ],
    reviews: [
      ['god-of-war-ragnarok', 5, 'Kratos and Atreus carry every scene. The final boss fights feel like the end of a movie trilogy.', 408],
      ['ghost-of-tsushima', 5, 'Following the wind to the next objective never gets old, and every standoff is pure tension.', 328],
      ['elden-ring', 5, 'I bounced off it twice before it clicked. Now I understand the hype completely.', 138],
      ['sekiro-shadows-die-twice', 4, 'Took me three evenings to beat the first real boss, and it felt amazing when the deflections finally clicked.', 5],
    ],
  },
  {
    key: 'noura',
    name: 'Nora Al Zahrani',
    joinedDaysAgo: 180,
    bio: 'Co-op nights with my sister and cozy games on the weekend.',
    steamId: 'NouraD',
    platform: 'steam',
    genres: 'Indie,Simulation,Adventure',
    library: [
      ['it-takes-two', 'completed', true, 420, 380],
      ['split-fiction', 'completed', true, 300, 250],
      ['stardew-valley', 'playing', true, 240],
      ['baldurs-gate-3', 'played', false, 220, 110],
      ['monster-hunter-wilds', 'playing', false, 60],
      ['hollow-knight-silksong', 'want_to_play', false, 7],
    ],
    reviews: [
      ['it-takes-two', 5, 'The best co-op game I have played. You genuinely need each other to get through it.', 378],
      ['split-fiction', 5, 'Every chapter throws a new idea at you. We laughed through the whole thing and finished it in one weekend.', 248],
      ['baldurs-gate-3', 5, 'We played it in co-op and spent an hour arguing about one dialogue choice. Perfect.', 108],
      ['stardew-valley', 5, 'My comfort game. One more day always turns into ten.', 30],
    ],
  },
  {
    key: 'faisal',
    name: 'Faisal Al-Otaibi',
    joinedDaysAgo: 150,
    bio: 'Competitive shooters, Friday football and fast cars.',
    xboxId: 'FaisalOT',
    platform: 'xbox',
    genres: 'Action,Sports,Racing',
    library: [
      ['grand-theft-auto-v', 'completed', false, 490, 470],
      ['forza-horizon-5', 'played', true, 350, 280],
      ['doom-the-dark-ages', 'completed', false, 230, 190],
      ['battlefield-6', 'playing', true, 100],
      ['ea-sports-fc-27', 'playing', false, 48],
    ],
    reviews: [
      ['forza-horizon-5', 4, 'Mexico is gorgeous and there is always something to do. The perfect game to relax after work.', 278],
      ['doom-the-dark-ages', 4, 'Heavier and slower than Eternal, but the shield bash is so satisfying. Great soundtrack as always.', 188],
      ['battlefield-6', 5, 'Destruction is back and the big maps finally feel like Battlefield again. Squad play is where it shines.', 52],
      ['ea-sports-fc-27', 3, 'Fun with friends, but it still feels very close to last year’s game.', 9],
    ],
  },
  {
    key: 'reem',
    name: 'Reem Al-Zahrani',
    joinedDaysAgo: 120,
    bio: 'Horror fan who plays with headphones on and the lights off.',
    psnId: 'ReemZ',
    platform: 'playstation',
    genres: 'Horror,Adventure',
    library: [
      ['resident-evil-4', 'completed', true, 450, 360],
      ['subnautica', 'completed', false, 340, 230],
      ['death-stranding-2', 'played', false, 180, 90],
      ['resident-evil-requiem', 'playing', true, 40],
    ],
    reviews: [
      ['resident-evil-4', 5, 'The village is still one of the best openings in gaming, and the remake nails the pacing.', 358],
      ['subnautica', 5, 'I am more scared of the deep ocean in this game than of most horror games.', 228],
      ['resident-evil-requiem', 4, 'Genuinely scary. I had to take breaks between chapters, and resource management is tight in the best way.', 3],
    ],
  },
  {
    key: 'khalid',
    name: 'Khalid Al-Ghamdi',
    joinedDaysAgo: 90,
    bio: 'Open-world explorer. I ignore the main story for the first forty hours.',
    steamId: 'KhalidG',
    xboxId: 'KhalidG',
    platform: 'steam',
    genres: 'Action,RPG,Adventure',
    library: [
      ['red-dead-redemption-2', 'completed', true, 495, 400],
      ['grand-theft-auto-v', 'completed', false, 480, 440],
      ['elden-ring', 'completed', true, 380, 270],
      ['cyberpunk-2077', 'completed', false, 260, 170],
      ['kingdom-come-deliverance-2', 'playing', false, 80],
      ['assassins-creed-shadows', 'want_to_play', false, 16],
    ],
    reviews: [
      ['red-dead-redemption-2', 5, 'Arthur’s story stayed with me for weeks. Nothing else has a world this alive.', 398],
      ['grand-theft-auto-v', 4, 'Still fun after all these years. The heists are the highlight.', 438],
      ['elden-ring', 5, 'Open world done right: no checklist, just curiosity.', 268],
      ['kingdom-come-deliverance-2', 5, 'Hard at first, but nothing compares to how grounded it feels. The sword fights are so good.', 0.6],
    ],
  },
  {
    // A private profile: hidden from Members and the activity feed, to show the privacy setting.
    key: 'sara',
    name: 'Sara Al-Mutairi',
    joinedDaysAgo: 45,
    bio: 'Story-first RPG player.',
    platform: 'playstation',
    genres: 'RPG',
    isPrivate: true,
    library: [
      ['clair-obscur-expedition-33', 'completed', true, 300, 150],
      ['baldurs-gate-3', 'playing', false, 90],
    ],
    reviews: [
      ['clair-obscur-expedition-33', 5, 'Beautiful from start to finish, and the ending made me cry.', 148],
    ],
  },
  {
    // The moderator: `npm run admin -- grant` gives a real account the same role.
    key: 'maha',
    name: 'Maha Al-Shehri',
    joinedDaysAgo: 330,
    bio: 'Community moderator. Puzzle games and cozy indies when the queue is empty.',
    steamId: 'MahaModerates',
    platform: 'steam',
    genres: 'Puzzle,Indie',
    role: 'admin',
    library: [
      ['stardew-valley', 'completed', true, 520, 400],
      ['hollow-knight-silksong', 'playing', false, 30],
    ],
    reviews: [
      ['stardew-valley', 5, 'Calm, kind and endlessly replayable. The best thing to play after a long day.', 398],
    ],
  },
  {
    // A spam account, so the moderation queue has something to decide on.
    key: 'turki',
    name: 'Turki Deals',
    joinedDaysAgo: 3,
    bio: 'Cheap keys and coins. Message me.',
    platform: 'xbox',
    genres: 'Action',
    library: [
      ['grand-theft-auto-v', 'played', false, 50],
    ],
    reviews: [
      ['grand-theft-auto-v', 5, 'Cheap GTA money and game keys at my store. Fast delivery, message me for the link!', 22],
    ],
  },
];

// [follower, followed, hours ago]
const follows = [
  ['omar', 'lina', 410], ['noura', 'lina', 350], ['khalid', 'lina', 300], ['lina', 'khalid', 290],
  ['reem', 'omar', 250], ['faisal', 'khalid', 200], ['khalid', 'omar', 180], ['lina', 'noura', 120],
  ['noura', 'reem', 100], ['omar', 'reem', 60], ['faisal', 'omar', 30], ['reem', 'lina', 4], ['sara', 'lina', 20],
];

// [who likes, review author, game, hours ago]
const likes = [
  ['omar', 'lina', 'elden-ring', 300], ['noura', 'lina', 'elden-ring', 200], ['khalid', 'lina', 'elden-ring', 30],
  ['reem', 'lina', 'elden-ring', 3], ['lina', 'khalid', 'red-dead-redemption-2', 280], ['faisal', 'khalid', 'red-dead-redemption-2', 150],
  ['omar', 'khalid', 'red-dead-redemption-2', 12], ['lina', 'omar', 'god-of-war-ragnarok', 302], ['reem', 'omar', 'god-of-war-ragnarok', 240],
  ['faisal', 'omar', 'god-of-war-ragnarok', 25], ['lina', 'noura', 'split-fiction', 140], ['khalid', 'noura', 'split-fiction', 8],
  ['omar', 'reem', 'resident-evil-4', 90], ['noura', 'reem', 'resident-evil-4', 14], ['khalid', 'faisal', 'battlefield-6', 18],
  ['noura', 'lina', 'baldurs-gate-3', 16], ['lina', 'noura', 'baldurs-gate-3', 100], ['faisal', 'khalid', 'elden-ring', 60],
  ['reem', 'khalid', 'elden-ring', 2], ['lina', 'sara', 'clair-obscur-expedition-33', 70],
];

// [who replies, review author, game, reply, hours ago]. A reply by the review's author shows a "Reviewer" tag.
const replies = [
  ['lina', 'omar', 'god-of-war-ragnarok', 'The father and son moments got me even more than the boss fights did.', 300],
  ['omar', 'lina', 'elden-ring', 'Which boss took you the longest? Malenia nearly broke me.', 96],
  ['lina', 'lina', 'elden-ring', 'Malenia, about forty tries. Worth every single one of them.', 95],
  ['reem', 'khalid', 'red-dead-redemption-2', 'Arthur’s story is the reason I finally finished it.', 50],
  ['faisal', 'noura', 'split-fiction', 'Booking this for the next game night with my brother.', 40],
  ['noura', 'noura', 'split-fiction', 'Play the side stories too. Some of the best ideas are hidden there.', 39],
  ['khalid', 'lina', 'elden-ring', 'Agreed. The first time the map opened up I just stopped and stared.', 26],
  ['sara', 'lina', 'baldurs-gate-3', 'My second run was nothing like my first one either. Karlach’s ending got me.', 6],
  ['noura', 'lina', 'clair-obscur-expedition-33', 'Okay, you convinced me. It just went on my wishlist.', 1],
  ['turki', 'reem', 'resident-evil-requiem', 'Anyone selling a used PS5? Message me, I pay cash.', 2.5],
];

// Open reports, waiting in Maha's moderation queue: [reporter, 'review' or 'reply', author, game, reason, note,
// hours ago]. A reply is found by its author and the game of the review it answers.
const openReports = [
  ['lina', 'review', 'turki', 'grand-theft-auto-v', 'spam', 'The same advert is on his profile too.', 20],
  ['omar', 'review', 'turki', 'grand-theft-auto-v', 'spam', '', 14],
  ['khalid', 'review', 'turki', 'grand-theft-auto-v', 'spam', '', 6],
  ['reem', 'reply', 'turki', 'resident-evil-requiem', 'off_topic', 'Nothing to do with the game.', 2],
];

// Decisions Maha already took, with the reports and notifications they produced.
const pastDecisions = {
  // Sara reported Faisal's review as off-topic; it follows the rules, so Maha kept it.
  kept: { reporter: 'sara', author: 'faisal', slug: 'ea-sports-fc-27', reason: 'off_topic', reportedHours: 80, decidedHours: 72 },
  // A spam reply under Lina's Elden Ring review, reported by Lina and removed.
  removed: {
    reporter: 'lina', author: 'turki', reviewAuthor: 'lina', slug: 'elden-ring', reason: 'spam',
    body: 'Cheap Elden Ring runes and rare items at my store, message me for the link!',
    postedHours: 40, reportedHours: 38, decidedHours: 30,
  },
};

// [member, event, browser, hours ago]. Lina's story: wrong passwords from an unknown browser paused sign-ins and
// alerted her, so she changed her password and signed out everywhere else. Everyone also has "Account created".
const securityEvents = [
  ['lina', 'sign_in_failed', 'firefoxLinux', 101], ['lina', 'sign_in_failed', 'firefoxLinux', 100.9],
  ['lina', 'sign_in_failed', 'firefoxLinux', 100.8], ['lina', 'sign_in_failed', 'firefoxLinux', 100.7],
  ['lina', 'sign_in_failed', 'firefoxLinux', 100.6], ['lina', 'locked', 'firefoxLinux', 100.6],
  ['lina', 'password_changed', 'chromeWindows', 99], ['lina', 'signed_out_others', 'chromeWindows', 99],
  ['lina', 'sign_in', 'chromeWindows', 30], ['lina', 'sign_in', 'safariIphone', 2],
  ['maha', 'sign_in', 'safariMac', 1],
];

// Notifications older than this were already opened by the demo member; newer ones show as unread.
const READ_AFTER_HOURS = 48;

// [owner, title, description, games, hours ago]
const lists = [
  ['lina', 'Worlds worth getting lost in', 'Huge maps, real secrets and no hand-holding.',
    ['elden-ring', 'the-witcher-3-wild-hunt', 'red-dead-redemption-2', 'baldurs-gate-3', 'kingdom-come-deliverance-2'], 200],
  ['noura', 'Best co-op nights', 'Grab a friend. These are better together.',
    ['split-fiction', 'it-takes-two', 'monster-hunter-wilds', 'stardew-valley', 'baldurs-gate-3'], 150],
  ['omar', 'Samurai and shinobi', 'Steel, honor and perfectly timed parries.',
    ['ghost-of-tsushima', 'sekiro-shadows-die-twice', 'assassins-creed-shadows'], 90],
  ['reem', 'Play with the lights off', 'Games that made me check behind the sofa.',
    ['resident-evil-4', 'resident-evil-requiem', 'subnautica'], 40],
  ['faisal', 'Weekend adrenaline', 'Fast, loud and competitive.',
    ['battlefield-6', 'doom-the-dark-ages', 'forza-horizon-5', 'ea-sports-fc-27'], 20],
  ['khalid', 'Stories that stayed with me', 'Games I still think about months later.',
    ['red-dead-redemption-2', 'the-witcher-3-wild-hunt', 'cyberpunk-2077', 'god-of-war-ragnarok'], 1],
];

function removeDemoData() {
  const demoMembers = `SELECT id FROM users WHERE email LIKE '%@${DEMO_DOMAIN}'`;
  db.exec('BEGIN');
  try {
    // Decisions about demo posts (or by the demo moderator) would otherwise stay behind without names.
    db.exec(`DELETE FROM moderation_log WHERE author_id IN (${demoMembers}) OR moderator_id IN (${demoMembers})`);
    const removed = Number(db.prepare('DELETE FROM users WHERE email LIKE ?').run(`%@${DEMO_DOMAIN}`).changes);
    db.exec('COMMIT');
    return removed;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function demoMemberCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM users WHERE email LIKE ?').get(`%@${DEMO_DOMAIN}`).count;
}

// The statements and lookups every step below uses. Members are found by their key ('lina'), games by slug.
function seedContext() {
  const gameIds = new Map(db.prepare('SELECT id, slug FROM games').all().map((game) => [game.slug, game.id]));
  const demo = {
    userIds: new Map(),
    commentIds: new Map(),
    insertUser: db.prepare(`
      INSERT INTO users (name, email, password_hash, bio, steam_id, psn_id, xbox_id, preferred_platform,
        favorite_genres, profile_public, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertLibrary: db.prepare(`
      INSERT INTO user_library (user_id, game_id, status, is_favorite, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertReview: db.prepare(`
      INSERT INTO reviews (user_id, game_id, rating, review_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertTier: db.prepare('INSERT OR REPLACE INTO tier_entries (user_id, game_id, tier, position) VALUES (?, ?, ?, ?)'),
    insertReviewDetails: db.prepare(`
      INSERT INTO review_details (review_id, spoiler, hours, platform, gameplay, story, visuals, audio, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertActivity: db.prepare(`
      INSERT INTO activities (user_id, type, game_id, target_user_id, list_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertFollow: db.prepare('INSERT INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)'),
    findReview: db.prepare('SELECT id FROM reviews WHERE user_id = ? AND game_id = ?'),
    insertLike: db.prepare('INSERT INTO review_likes (user_id, review_id, created_at) VALUES (?, ?, ?)'),
    insertComment: db.prepare('INSERT INTO review_comments (review_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'),
    insertNotification: db.prepare(`
      INSERT INTO notifications (user_id, actor_id, type, key, review_id, comment_id, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertList: db.prepare('INSERT INTO game_lists (user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    insertListItem: db.prepare('INSERT INTO game_list_items (list_id, game_id, position, added_at) VALUES (?, ?, ?, ?)'),
    setRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
    insertReport: db.prepare(`
      INSERT INTO reports (reporter_id, review_id, comment_id, reason, note, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertDecision: db.prepare(`
      INSERT INTO moderation_log (moderator_id, action, author_id, game_id, reason, content, report_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertCheckpointMessage: db.prepare(`
      INSERT INTO notifications (user_id, type, key, game_id, detail, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertSecurityEvent: db.prepare('INSERT INTO security_events (user_id, type, user_agent, created_at) VALUES (?, ?, ?, ?)'),
  };

  demo.gameId = (slug) => {
    if (!gameIds.has(slug)) throw new Error(`Unknown game in demo data: ${slug}`);
    return gameIds.get(slug);
  };
  demo.reviewId = (author, slug) => {
    const review = demo.findReview.get(demo.userIds.get(author), demo.gameId(slug));
    if (!review) throw new Error(`Demo data likes or replies to a review that does not exist: ${author} on ${slug}`);
    return review.id;
  };
  // The same notification the app creates for a live follow, vote or reply (see routes/community.js).
  demo.notify = (recipient, actor, type, key, hours, review = null, comment = null) => {
    if (recipient === actor) return;
    const readAt = hours > READ_AFTER_HOURS ? hoursAgo(hours - 1) : null;
    demo.insertNotification.run(demo.userIds.get(recipient), demo.userIds.get(actor), type, key, review, comment, readAt, hoursAgo(hours));
  };
  // A message from Checkpoint itself (database/notifications.js, notifyFromCheckpoint).
  demo.notifyFromCheckpoint = (recipient, type, key, slug, detail, hours) => {
    const readAt = hours > READ_AFTER_HOURS ? hoursAgo(hours - 1) : null;
    demo.insertCheckpointMessage.run(demo.userIds.get(recipient), type, key, slug ? demo.gameId(slug) : null, detail, readAt, hoursAgo(hours));
  };
  return demo;
}

function addLibrary(demo, userId, library) {
  for (const [slug, status, isFavorite, addedHours, finishedHours] of library) {
    // A game added earlier and finished later starts on the wishlist (or as "playing") in the feed.
    const firstStatus = finishedHours === undefined ? status : status === 'completed' ? 'playing' : 'want_to_play';
    const updatedHours = finishedHours ?? addedHours;
    demo.insertLibrary.run(userId, demo.gameId(slug), status, isFavorite ? 1 : 0, hoursAgo(addedHours), hoursAgo(updatedHours));
    demo.insertActivity.run(userId, 'library_add', demo.gameId(slug), null, null, firstStatus, hoursAgo(addedHours));
    if (finishedHours !== undefined) {
      demo.insertActivity.run(userId, 'status_change', demo.gameId(slug), null, null, status, hoursAgo(finishedHours));
    }
  }
}

// Details on some demo reviews (3.8): platform, hours played, spoiler warning and aspect scores
// [gameplay, story, visuals, audio, value], written to fit each review's text. SYNTHETIC demo data like the rest.
const reviewDetails = {
  'lina:elden-ring': { platform: 'pc', hours: 140, aspects: [5, 4, 5, 5, 5] },
  'lina:baldurs-gate-3': { platform: 'pc', hours: 210, aspects: [5, 5, 4, 5, 5] },
  'lina:cyberpunk-2077': { platform: 'pc', hours: 85, aspects: [4, 5, 5, 4, 4] },
  'lina:clair-obscur-expedition-33': { platform: 'pc', hours: 12, aspects: [5, 5, 5, 5, 4] },
  'omar:god-of-war-ragnarok': { platform: 'playstation', hours: 45, spoiler: true, aspects: [5, 5, 5, 5, 4] },
  'omar:ghost-of-tsushima': { platform: 'playstation', hours: 60, aspects: [5, 4, 5, 5, 5] },
  'omar:sekiro-shadows-die-twice': { platform: 'playstation', hours: 30, aspects: [5, 3, 4, 4, 4] },
  'noura:it-takes-two': { platform: 'playstation', hours: 14, aspects: [5, 4, 5, 4, 5] },
  'noura:split-fiction': { platform: 'pc', hours: 16, aspects: [5, 4, 5, 4, 4] },
  'noura:stardew-valley': { platform: 'switch', hours: 300, aspects: [5, 3, 4, 5, 5] },
  'faisal:forza-horizon-5': { platform: 'xbox', hours: 90, aspects: [4, 2, 5, 5, 4] },
  'faisal:battlefield-6': { platform: 'pc', hours: 70, aspects: [5, 2, 5, 5, 4] },
  'faisal:ea-sports-fc-27': { platform: 'playstation', hours: 120, aspects: [3, 1, 4, 3, 2] },
  'reem:resident-evil-4': { platform: 'pc', hours: 20, aspects: [5, 4, 5, 5, 5] },
  'reem:resident-evil-requiem': { platform: 'pc', hours: 11, spoiler: true, aspects: [4, 4, 5, 5, 4] },
  'khalid:red-dead-redemption-2': { platform: 'xbox', hours: 110, spoiler: true, aspects: [4, 5, 5, 5, 5] },
  'khalid:kingdom-come-deliverance-2': { platform: 'pc', hours: 95, aspects: [4, 5, 5, 4, 5] },
  'sara:clair-obscur-expedition-33': { spoiler: true, hours: 35, aspects: [5, 5, 5, 5, 5] },
};
const ASPECT_ORDER = ['gameplay', 'story', 'visuals', 'audio', 'value'];

// A member with their account activity, library and reviews.
function addMember(demo, member, passwordHash) {
  const userId = Number(demo.insertUser.run(
    member.name,
    `${member.key}@${DEMO_DOMAIN}`,
    passwordHash,
    member.bio,
    member.steamId || '',
    member.psnId || '',
    member.xboxId || '',
    member.platform || '',
    member.genres || '',
    member.isPrivate ? 0 : 1,
    hoursAgo(member.joinedDaysAgo * 24),
  ).lastInsertRowid);
  demo.userIds.set(member.key, userId);
  if (member.role) demo.setRole.run(member.role, userId);
  demo.insertSecurityEvent.run(userId, 'account_created', BROWSERS.chromeWindows, hoursAgo(member.joinedDaysAgo * 24));
  addLibrary(demo, userId, member.library);

  for (const [slug, rating, text, hours] of member.reviews) {
    const reviewId = Number(demo.insertReview.run(userId, demo.gameId(slug), rating, text, hoursAgo(hours), hoursAgo(hours)).lastInsertRowid);
    const details = reviewDetails[`${member.key}:${slug}`];
    if (details) {
      demo.insertReviewDetails.run(reviewId, details.spoiler ? 1 : 0, details.hours ?? null, details.platform || '',
        ...ASPECT_ORDER.map((key, index) => details.aspects?.[index] ?? null));
    }
    demo.insertActivity.run(userId, 'review', demo.gameId(slug), null, null, String(rating), hoursAgo(hours));
  }

  // A tier list from the member's own star ratings (5 stars = S … 1 star = D), so the tier pages have something to
  // show. SYNTHETIC like the ratings it is made from.
  const positions = {};
  for (const [slug, rating] of member.reviews) {
    const tier = ['d', 'c', 'b', 'a', 's'][rating - 1];
    positions[tier] = (positions[tier] ?? -1) + 1;
    demo.insertTier.run(userId, demo.gameId(slug), tier, positions[tier]);
  }
}

// Follows, helpful votes and replies, each with the notification it sends.
function addCommunity(demo) {
  const { userIds } = demo;
  for (const [follower, followed, hours] of follows) {
    demo.insertFollow.run(userIds.get(follower), userIds.get(followed), hoursAgo(hours));
    demo.insertActivity.run(userIds.get(follower), 'follow', null, userIds.get(followed), null, '', hoursAgo(hours));
    demo.notify(followed, follower, 'follow', `follow:${userIds.get(follower)}`, hours);
  }

  for (const [liker, author, slug, hours] of likes) {
    const review = demo.reviewId(author, slug);
    demo.insertLike.run(userIds.get(liker), review, hoursAgo(hours));
    demo.notify(author, liker, 'review_like', `like:${review}:${userIds.get(liker)}`, hours, review);
  }

  for (const [replier, author, slug, body, hours] of replies) {
    const review = demo.reviewId(author, slug);
    const comment = Number(demo.insertComment.run(review, userIds.get(replier), body, hoursAgo(hours)).lastInsertRowid);
    demo.commentIds.set(`${replier}:${slug}`, comment);
    demo.notify(author, replier, 'review_comment', `comment:${comment}`, hours, review, comment);
  }
}

// The open reports in the moderation queue, and two decisions Maha already took.
function addModeration(demo) {
  const { userIds, gameId, notifyFromCheckpoint } = demo;
  for (const [reporter, kind, author, slug, reason, note, hours] of openReports) {
    const review = kind === 'review' ? demo.reviewId(author, slug) : null;
    const comment = kind === 'reply' ? demo.commentIds.get(`${author}:${slug}`) : null;
    if (!review && !comment) throw new Error(`Demo data reports a post that does not exist: ${author} on ${slug}`);
    demo.insertReport.run(userIds.get(reporter), review, comment, reason, note, 'open', hoursAgo(hours), null);
  }

  const moderator = userIds.get('maha');
  const { kept, removed } = pastDecisions;
  const keptReview = demo.reviewId(kept.author, kept.slug);
  demo.insertReport.run(userIds.get(kept.reporter), keptReview, null, kept.reason, '', 'kept', hoursAgo(kept.reportedHours), hoursAgo(kept.decidedHours));
  const keptText = members.find((member) => member.key === kept.author).reviews.find((review) => review[0] === kept.slug)[2];
  demo.insertDecision.run(moderator, 'keep_review', userIds.get(kept.author), gameId(kept.slug), '', keptText, 1, hoursAgo(kept.decidedHours));
  notifyFromCheckpoint(kept.reporter, 'report_resolved', `report:review:${keptReview}`, kept.slug, 'review:kept', kept.decidedHours);

  // The removed reply existed once: it is written, then deleted the way the moderation queue deletes it.
  const spamReply = Number(demo.insertComment.run(demo.reviewId(removed.reviewAuthor, removed.slug), userIds.get(removed.author), removed.body, hoursAgo(removed.postedHours)).lastInsertRowid);
  db.prepare('DELETE FROM review_comments WHERE id = ?').run(spamReply);
  demo.insertDecision.run(moderator, 'remove_reply', userIds.get(removed.author), gameId(removed.slug), removed.reason, removed.body, 1, hoursAgo(removed.decidedHours));
  notifyFromCheckpoint(removed.author, 'content_removed', `removed:reply:${spamReply}`, removed.slug, `reply:${removed.reason}`, removed.decidedHours);
  notifyFromCheckpoint(removed.reporter, 'report_resolved', `report:reply:${spamReply}`, removed.slug, 'reply:removed', removed.decidedHours);
}

function addSecurityActivity(demo) {
  for (const [member, type, browser, hours] of securityEvents) {
    demo.insertSecurityEvent.run(demo.userIds.get(member), type, BROWSERS[browser], hoursAgo(hours));
  }
  demo.notifyFromCheckpoint('lina', 'security', 'security:locked', null, 'locked', 100.6);
}

function addLists(demo) {
  for (const [owner, title, description, slugs, hours] of lists) {
    const ownerId = demo.userIds.get(owner);
    const listId = Number(demo.insertList.run(ownerId, title, description, hoursAgo(hours), hoursAgo(hours)).lastInsertRowid);
    slugs.forEach((slug, position) => demo.insertListItem.run(listId, demo.gameId(slug), position, hoursAgo(hours)));
    demo.insertActivity.run(ownerId, 'list_create', null, null, listId, '', hoursAgo(hours));
  }
}

// Everything in one transaction: a mistake in the demo data leaves the database as it was.
async function seed() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const demo = seedContext();
  db.exec('BEGIN');
  try {
    for (const member of members) addMember(demo, member, passwordHash);
    addCommunity(demo);
    addModeration(demo);
    addSecurityActivity(demo);
    addLists(demo);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return demo.userIds.size;
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--remove')) {
    const removed = removeDemoData();
    console.log(removed ? `Removed ${removed} demo members and everything they created.` : 'No demo data to remove.');
    return;
  }

  if (demoMemberCount() > 0) {
    if (!args.has('--reset')) {
      console.log('Demo members already exist. Run "npm run seed:demo -- --reset" to recreate them with fresh times.');
      return;
    }
    removeDemoData();
  }

  const created = await seed();
  console.log(`Created ${created} demo members with libraries, reviews, tier lists, replies, follows, likes, lists, activity, notifications, reports and security activity.`);
  console.log(`Log in as lina@${DEMO_DOMAIN} (or omar, noura, faisal, reem, khalid, sara, turki) with the password ${DEMO_PASSWORD}`);
  console.log(`Log in as maha@${DEMO_DOMAIN} to moderate: the queue at /moderation has reports waiting.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
