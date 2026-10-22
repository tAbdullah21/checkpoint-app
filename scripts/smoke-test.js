const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabasePath = path.join(os.tmpdir(), `checkpoint-smoke-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDatabasePath;
// The checks use plain HTTP, so production settings from a developer's .env must not apply here.
process.env.NODE_ENV = 'test';
process.env.TRUST_PROXY = '';
process.env.CATALOG_EXTENDED = '0';
process.env.COVER_FETCH = '0';

const app = require('../app');
const { closeDatabase } = require('../database/database');

let baseUrl = process.env.TEST_BASE_URL || '';
let server;

// The account the checks sign up with and use from then on.
const uniqueEmail = `smoke-${Date.now()}@checkpoint.test`;
const password = 'Checkpoint123';

let cookie = '';
let passed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }

  passed += 1;
  console.log(`PASS ${message}`);
}

function updateCookie(response) {
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) {
    headers.cookie = cookie;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    ...options,
    headers,
  });
  updateCookie(response);
  return response;
}

function formBody(values) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      value.forEach((item) => parameters.append(key, item));
    } else {
      parameters.append(key, value);
    }
  }
  return parameters.toString();
}

function cleanUp() {
  if (server) {
    server.close();
  }

  closeDatabase();
  for (const file of [testDatabasePath, `${testDatabasePath}-shm`, `${testDatabasePath}-wal`]) {
    fs.rmSync(file, { force: true });
  }
}

// Starts Checkpoint on a free port, unless TEST_BASE_URL names a server that is already running.
async function startServer() {
  if (baseUrl) return;
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
}

// What a guest sees: the home page, the catalogue and its search, a game page, and no reviews without an account.
async function checkGuestPages() {
  let response = await request('/');
  let body = await response.text();
  assert(response.status === 200, 'homepage responds with status 200');
  assert(body.includes('Keep track of the games you play'), 'homepage renders the Checkpoint introduction');
  assert(body.includes('Elden Ring'), 'homepage renders real game titles');
  assert(body.includes('EA Sports FC 27'), 'homepage renders EA Sports FC 27');
  assert(body.includes('Kingdom Come: Deliverance II'), 'homepage renders Kingdom Come: Deliverance II');
  assert(body.includes('Resident Evil Requiem'), 'homepage renders recent 2026 games');
  assert(body.includes('Fresh checkpoints'), 'homepage includes a new releases section');
  assert(body.includes('Big names, great reviews'), 'homepage includes a popular games section');
  assert(body.includes('/games/ea-sports-fc-27'), 'homepage game posters link to detail pages');
  assert(body.includes('Recently reviewed'), 'homepage renders recent reviews');
  assert(body.includes('Lists worth saving'), 'homepage renders community lists');

  response = await request('/games');
  body = await response.text();
  assert(response.status === 200, 'game catalogue responds with status 200');
  assert(body.includes('Find your next game'), 'game catalogue renders working search controls');
  assert((body.match(/class="game-card"/g) || []).length === 60, 'game catalogue renders all sixty games');
  assert(body.includes('All genres'), 'game catalogue includes genre filtering');

  response = await request('/games?query=FC+27');
  body = await response.text();
  assert(response.status === 200, 'title search responds with status 200');
  assert(body.includes('EA Sports FC 27'), 'title search finds a matching game');
  assert(!body.includes('Elden Ring cover'), 'title search removes nonmatching games');

  response = await request('/games?genre=Survival+Horror');
  body = await response.text();
  assert(body.includes('Resident Evil Requiem'), 'genre filter finds matching games');
  assert(!body.includes('EA Sports FC 27 cover'), 'genre filter removes games from other genres');

  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
  assert(response.status === 200, 'game detail page responds with status 200');
  assert(body.includes('Continue Henry'), 'game detail page renders a real description');
  assert(body.includes('Available platforms'), 'game detail page labels platform availability');
  assert(body.includes('PlayStation'), 'game detail page renders platform branding');
  assert(body.includes('What members think'), 'game detail page renders its review section');
  assert(body.includes('Log in to review'), 'guest game page offers a review login action');

  response = await request('/games/kingdom-come-deliverance-2/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ rating: '5', reviewText: 'Guest review should not be saved.' }),
  });
  assert(response.status === 302, 'review creation redirects guests');
  assert(response.headers.get('location') === '/login', 'guest review redirect targets login');
}

// The design system in the stylesheets.
function checkStyles() {
  const styles = ['base', 'layout', 'components', 'pages']
    .map((name) => fs.readFileSync(path.join(__dirname, '..', 'public', 'css', `${name}.css`), 'utf8'))
    .join('\n');
  assert(styles.includes('--mint: #3ef0b1'), 'the design system defines the mint brand color');
  assert(styles.includes('--cyan: #22d3ee'), 'the design system defines the cyan brand color');
  assert(/\.spotlight\s*\{[^}]*overflow:\s*hidden/s.test(styles), 'featured artwork stays inside its panel');
  assert(/\.list-card-stage img\s*\{[^}]*aspect-ratio:\s*2 \/ 3/s.test(styles), 'list posters keep their correct aspect ratio');
  assert(styles.includes('.profile-dropdown'), 'profile menu styles are included');
  assert(/\.favorite-slot img\s*\{[^}]*object-fit:\s*cover/s.test(styles), 'profile posters keep their correct aspect ratio');
  assert(/\.board\s*\{[^}]*align-items:\s*start/s.test(styles), 'library board columns hug their cards instead of stretching');
  assert(styles.includes('.compare-hero'), 'compare tastes styles are included');
  assert(styles.includes('.game-hero'), 'game detail layout styles are included');
  assert(styles.includes('.filter-bar'), 'search interface styles are included');
  assert(styles.includes('.star-input'), 'interactive rating styles are included');
  assert(!styles.includes('cdn.jsdelivr'), 'styles do not depend on a CDN');
}

// Every stylesheet, font, script and image the pages load, and the platform logos.
async function checkAssets() {
  for (const asset of [
    '/css/base.css',
    '/css/layout.css',
    '/css/components.css',
    '/css/pages.css',
    '/fonts/inter-latin-wght.woff2',
    '/fonts/space-grotesk-latin-wght.woff2',
    '/js/main.js',
    '/images/checkpoint-mark.svg',
    '/images/covers/elden-ring.jpg',
    '/images/covers/cyberpunk-2077.jpg',
    '/images/covers/red-dead-redemption-2.jpg',
    '/images/covers/forza-horizon-5.jpg',
    '/images/covers/baldurs-gate-3.jpg',
    '/images/covers/subnautica.jpg',
    '/images/covers/ea-sports-fc-27.webp',
    '/images/covers/kingdom-come-deliverance-2.jpg',
    '/images/covers/clair-obscur-expedition-33.jpg',
    '/images/covers/monster-hunter-wilds.jpg',
    '/images/covers/split-fiction.jpg',
    '/images/covers/doom-the-dark-ages.jpg',
    '/images/covers/assassins-creed-shadows.jpg',
    '/images/covers/battlefield-6.png',
    '/images/covers/resident-evil-requiem.jpg',
    '/images/covers/death-stranding-2.jpg',
    '/images/platforms/steam.svg',
    '/images/platforms/playstation.svg',
    '/images/platforms/xbox.svg',
  ]) {
    const response = await request(asset);
    assert(response.status === 200, `${asset} loads successfully`);
  }

  const steamLogo = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'platforms', 'steam.svg'), 'utf8');
  const playStationLogo = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'platforms', 'playstation.svg'), 'utf8');
  const xboxLogo = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'platforms', 'xbox.svg'), 'utf8');
  assert(steamLogo.includes('<title>Steam</title>'), 'Steam uses the recognizable platform brand mark');
  assert(playStationLogo.includes('<title>PlayStation</title>'), 'PlayStation uses the recognizable platform brand mark');
  assert(xboxLogo.includes('<title>Xbox</title>'), 'Xbox uses the recognizable platform brand mark');
}

// Member pages send guests to the login page.
async function checkGuestRedirects() {
  let response = await request('/profile');
  assert(response.status === 302, 'profile redirects guests to login');
  assert(response.headers.get('location') === '/login', 'guest profile redirect targets login');

  response = await request('/tiers');
  assert(response.status === 302 && response.headers.get('location') === '/login', 'the tier list asks guests to log in');

  response = await request('/library');
  assert(response.status === 302, 'library redirects guests to login');
  assert(response.headers.get('location') === '/login', 'guest library redirect targets login');
}

// 3.8: Versus and the instant-navigation rules.
async function checkVersion38() {
  let response = await request('/versus?a=elden&b=hades');
  assert(response.status === 302 && response.headers.get('location') === '/versus?a=elden-ring&b=hades', 'Versus turns typed names into addresses');
  response = await request('/versus?a=elden-ring&b=hades');
  const body = await response.text();
  assert(response.status === 200 && body.includes('versus-verdict'), 'Versus compares two games with a verdict');
  response = await request('/speculation-rules.json');
  assert(response.headers.get('content-type').startsWith('application/speculationrules+json'), 'the speculation rules are served with their media type');
}

// Signing up (with the mistakes the form must catch), logging out and logging in again.
async function checkSignUpAndLogIn() {
  let response = await request('/register');
  let body = await response.text();
  assert(response.status === 200, 'registration page responds with status 200');
  assert(body.includes('Join Checkpoint'), 'registration form renders');

  response = await request('/register', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      name: 'A',
      email: 'invalid-email',
      password: 'short',
      confirmPassword: 'different',
    }),
  });
  body = await response.text();
  assert(response.status === 422, 'invalid registration is rejected');
  assert(body.includes('Enter a valid email address'), 'registration errors are shown');

  response = await request('/register', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      name: 'Prototype Tester',
      email: uniqueEmail,
      password,
      confirmPassword: password,
    }),
  });
  assert(response.status === 302, 'valid registration redirects');
  assert(response.headers.get('location') === '/welcome?next=%2Flibrary', 'valid registration offers setup while preserving the requested page');

  response = await request('/library');
  body = await response.text();
  assert(response.status === 200, 'the new member can open their library straight away');
  assert(body.includes('Welcome to Checkpoint, Prototype'), 'new members are welcomed by name');

  response = await request('/logout', { method: 'POST' });
  assert(response.status === 302, 'logging out redirects');

  response = await request('/register', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      name: 'Duplicate Tester',
      email: uniqueEmail,
      password,
      confirmPassword: password,
    }),
  });
  body = await response.text();
  assert(response.status === 422, 'duplicate email is rejected');
  assert(body.includes('already exists'), 'duplicate email error is shown');

  response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ email: uniqueEmail, password: 'Incorrect123' }),
  });
  body = await response.text();
  assert(response.status === 401, 'incorrect password is rejected');
  assert(body.includes('email or password is incorrect'), 'login error is shown');

  response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ email: uniqueEmail, password }),
  });
  assert(response.status === 302, 'correct login redirects');
  assert(response.headers.get('location') === '/', 'correct login redirects to homepage');

  response = await request('/');
  body = await response.text();
  assert(response.status === 200, 'authenticated homepage responds with status 200');
  assert(body.includes('Welcome back, Prototype'), 'authenticated session displays the user name');
  assert(body.includes('View profile'), 'authenticated navigation includes the profile menu');
  assert(body.includes('/library/elden-ring/add'), 'authenticated homepage includes working library actions');
  assert(body.includes('Continue playing'), 'authenticated homepage includes a continue-playing section');
  assert(!body.includes(uniqueEmail), 'authenticated account menu does not expose the email address');
}

// Writing, editing and rating a review, and saving a game to the library from its page.
async function checkReviews() {
  let response = await request('/games/kingdom-come-deliverance-2');
  let body = await response.text();
  assert(body.includes('How was the game?'), 'authenticated game page renders the review composer');
  assert(body.includes('Add to your library'), 'authenticated game page renders library controls');

  response = await request('/games/kingdom-come-deliverance-2/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ rating: '8', reviewText: 'Invalid rating.' }),
  });
  assert(response.status === 302, 'invalid review rating redirects safely');

  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
  assert(body.includes('Choose a rating from 0.5 to 5 stars in half-star steps'), 'invalid review rating shows feedback');

  response = await request('/games/kingdom-come-deliverance-2/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      rating: '5',
      reviewText: 'A grounded medieval adventure with memorable quests and satisfying exploration.',
    }),
  });
  assert(response.status === 302, 'valid review creation redirects');
  assert(response.headers.get('location') === '/games/kingdom-come-deliverance-2#reviews', 'new review returns to the game review section');

  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
  assert(body.includes('A grounded medieval adventure'), 'published review appears on the game page');
  assert(body.includes('Update your thoughts'), 'published review becomes editable by its author');
  assert(body.includes('1 member rating'), 'member rating count updates after review creation');

  response = await request('/');
  body = await response.text();
  assert(body.includes('A grounded medieval adventure'), 'new member review appears on the homepage feed');

  response = await request('/games/kingdom-come-deliverance-2/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      rating: '4',
      reviewText: 'Updated after more playtime. The world and quests remain the strongest parts.',
    }),
  });
  assert(response.status === 302, 'existing review can be updated');

  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
  assert(body.includes('Updated after more playtime'), 'updated review text appears on the game page');

  response = await request('/library/kingdom-come-deliverance-2/add', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ status: 'playing', returnTo: '/games/kingdom-come-deliverance-2' }),
  });
  assert(response.status === 302, 'game detail library control saves a game');
  assert(response.headers.get('location') === '/games/kingdom-come-deliverance-2', 'game detail library control returns to its page');

  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
  assert(body.includes('In your library'), 'game detail page reflects saved library status');
}

// The profile page and the profile editor, with its validation.
async function checkProfile() {
  let response = await request('/profile');
  let body = await response.text();
  assert(response.status === 200, 'profile page responds for authenticated users');
  assert(body.includes('Prototype Tester'), 'profile page displays the member name');
  assert(body.includes('Edit profile'), 'profile page includes an edit action');
  assert(body.includes('No gaming accounts shared'), 'empty gaming accounts use a clear empty state');
  assert(!body.includes(uniqueEmail), 'profile does not expose the private email address');

  response = await request('/profile/edit');
  body = await response.text();
  assert(response.status === 200, 'profile editor responds for authenticated users');
  assert(body.includes('Gaming accounts'), 'profile editor includes gaming account fields');
  assert(body.includes('Xbox'), 'profile editor includes Xbox support');
  assert(body.includes('Favorite genres'), 'profile editor includes favorite genre choices');
  assert(body.includes('Preferred platform'), 'profile editor includes a preferred platform choice');

  response = await request('/profile/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      name: 'A',
      bio: 'x'.repeat(281),
      steamId: '',
      psnId: '',
      xboxId: '',
      preferredPlatform: '',
    }),
  });
  body = await response.text();
  assert(response.status === 422, 'invalid profile update is rejected');
  assert(body.includes('Bio must be 280 characters or fewer'), 'profile validation errors are shown');

  response = await request('/profile/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      name: 'Updated Tester',
      bio: 'I enjoy action RPGs, exploration, and difficult boss fights.',
      steamId: 'CheckpointPlayer',
      psnId: 'Checkpoint_PS',
      xboxId: 'CheckpointXbox',
      steamVisible: 'on',
      xboxVisible: 'on',
      preferredPlatform: 'steam',
      favoriteGenres: ['Action', 'RPG', 'Adventure'],
    }),
  });
  assert(response.status === 302, 'valid profile update redirects');
  assert(response.headers.get('location') === '/profile', 'valid profile update redirects to the profile');

  response = await request('/profile');
  body = await response.text();
  assert(response.status === 200, 'updated profile page responds with status 200');
  assert(body.includes('Updated Tester'), 'updated profile displays the new name');
  assert(body.includes('I enjoy action RPGs'), 'updated profile displays the bio');
  assert(body.includes('CheckpointPlayer'), 'updated profile displays the Steam ID');
  assert(body.includes('CheckpointXbox'), 'updated profile displays the Xbox gamertag');
  assert(!body.includes('Checkpoint_PS'), 'hidden PlayStation ID does not appear on the profile');
  assert(body.includes('PC / Steam'), 'updated profile displays the preferred platform');
  assert(body.includes('Adventure'), 'updated profile displays favorite genres');
  assert(!body.includes(uniqueEmail), 'updated profile continues to keep email private');
}

// Library statuses and the pages they show up on.
async function checkLibrary() {
  let body;
  let response = await request('/library/elden-ring/add', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ status: 'want_to_play', returnTo: '/' }),
  });
  assert(response.status === 302, 'homepage library action redirects after saving');
  assert(response.headers.get('location') === '/', 'homepage library action returns to the homepage');

  response = await request('/');
  body = await response.text();
  assert(body.includes('Want to Play'), 'homepage shows the saved game status');

  response = await request('/library');
  body = await response.text();
  assert(response.status === 200, 'library page responds for authenticated users');
  assert(body.includes('Library board'), 'library page renders its management board');
  assert(body.includes('Elden Ring'), 'library page displays the saved game');
  assert(body.includes('profile favorites'), 'library page supports profile favorites');

  response = await request('/library/elden-ring/update', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ status: 'playing', isFavorite: 'on' }),
  });
  assert(response.status === 302, 'library status update redirects');
  assert(response.headers.get('location') === '/library', 'library status update returns to the library');

  response = await request('/profile');
  body = await response.text();
  assert(body.includes('Top 4 favorites'), 'favorite games appear on the profile');
  assert(body.includes('Currently playing'), 'playing games appear in the current activity section');
  assert(body.includes('Elden Ring'), 'profile library displays the saved game');

  response = await request('/library/cyberpunk-2077/add', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ status: 'completed', returnTo: '/library' }),
  });
  assert(response.status === 302, 'a second game can be added with a chosen status');

  response = await request('/library');
  body = await response.text();
  assert(body.includes('Cyberpunk 2077'), 'second saved game appears in the library');
  assert(body.includes('Completed'), 'completed status is available in the library');

  response = await request('/library/cyberpunk-2077/remove', { method: 'POST' });
  assert(response.status === 302, 'library game removal redirects');

  response = await request('/library');
  body = await response.text();
  assert(!body.includes('action="/library/cyberpunk-2077/update"'), 'removed game leaves the managed library list');

  response = await request('/games/elden-ring');
  body = await response.text();
  assert(body.includes("Who's playing"), "game page lists the members who track the game");
  assert(body.includes('class="player-row" href="/profile"'), 'the viewer appears first in who is playing');

  response = await request('/');
  body = await response.text();
  assert(body.includes('Welcome back, Updated'), 'profile name update refreshes the session navigation');
}

// Checkpoint 2.3: replies, notifications, ranked list order and the account page.
async function checkVersion23() {
  let response = await request('/games/kingdom-come-deliverance-2');
  let body = await response.text();
  const reviewId = body.match(/id="review-(\d+)"/)?.[1];
  assert(Boolean(reviewId), 'the review has an anchor for replies');

  response = await request(`/reviews/${reviewId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ body: 'Thanks for reading my review!' }),
  });
  assert(/#comment-\d+$/.test(response.headers.get('location') || ''), 'a reply links straight to itself');

  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
  assert(body.includes('Thanks for reading my review!'), 'the reply appears under the review');
  assert(body.includes('class="reply-tag">Reviewer'), 'the review author is tagged in their own thread');

  response = await request('/notifications');
  body = await response.text();
  assert(response.status === 200 && body.includes('<h1>Notifications</h1>'), 'the notifications inbox opens');
  assert(body.includes('No notifications yet'), 'answering your own review is not a notification');

  response = await request('/lists', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ title: 'Smoke ranking', description: '', game: 'elden-ring' }),
  });
  const listPath = response.headers.get('location') || '';
  assert(/^\/lists\/\d+$/.test(listPath), 'a ranked list is created');
  await request(`${listPath}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ slug: 'subnautica' }),
  });
  response = await request(`${listPath}/items/subnautica/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: formBody({ direction: 'up' }),
  });
  const moved = await response.json();
  assert(moved.ok && moved.position === 1 && moved.total === 2, 'a game moves up in a ranked list');

  response = await request(listPath);
  body = await response.text();
  assert(body.indexOf('id="rank-subnautica"') < body.indexOf('id="rank-elden-ring"'), 'the new order is saved');

  response = await request('/account');
  body = await response.text();
  assert(response.status === 200 && body.includes('This device'), 'the account page lists this browser');

  response = await request('/account/password', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ currentPassword: 'not-my-password1', newPassword: 'Another2026', confirmPassword: 'Another2026' }),
  });
  assert(response.status === 422, 'a password change needs the current password');

  response = await request('/account/export');
  const exported = await response.json();
  assert(exported.format === 'checkpoint-account-export/3' && exported.lists.length === 1, 'the data export downloads as JSON');
  assert(!/"password(_?hash)?"/i.test(JSON.stringify(exported)) && !JSON.stringify(exported).includes('$2b$'), 'the export never contains the password or its hash');
  assert(exported.securityActivity.some((event) => event.event === 'account_created'), 'the export includes the security activity');
  return reviewId;
}

// Checkpoint 2.4: the health check, reports and moderation, and the password reset email. The moderator role and
// the development mailbox are only checked on the server this script starts itself.
async function checkVersion24(reviewId) {
  let body;
  const local = !process.env.TEST_BASE_URL;
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  let response = await request('/health');
  const health = await response.json();
  assert(response.status === 200 && health.status === 'ok' && health.database === 'ok', 'the health check reports a working database');

  const memberCookie = cookie;
  cookie = '';
  const reporterEmail = `smoke-reporter-${Date.now()}@checkpoint.test`;
  await request('/register', { method: 'POST', headers: form, body: formBody({ name: 'Smoke Reporter', email: reporterEmail, password, confirmPassword: password }) });
  response = await request(`/reviews/${reviewId}/report`, { method: 'POST', headers: form, body: formBody({ reason: 'spam', note: 'Smoke test report' }) });
  assert(response.status === 302 && (response.headers.get('location') || '').endsWith(`#review-${reviewId}`), 'another member can report the review');
  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
  assert(body.includes('Thanks for the report.'), 'the reporter is told that a moderator will decide');
  response = await request('/moderation');
  assert(response.status === 403, 'the moderation queue is closed to members without the role');

  if (local) {
    require('../database/moderation').setRoleByEmail(reporterEmail, 'admin');
    response = await request('/moderation');
    body = await response.text();
    assert(response.status === 200 && body.includes('Smoke test report'), 'a moderator sees the report and its note in the queue');
    response = await request(`/moderation/review/${reviewId}/keep`, { method: 'POST' });
    assert(response.status === 302 && response.headers.get('location') === '/moderation', 'the moderator keeps the review');
    response = await request('/moderation/log');
    body = await response.text();
    assert(body.includes('Kept a review'), 'the decision is written to the moderation log');
    response = await request('/notifications');
    body = await response.text();
    assert(body.includes('was checked by a moderator and stays up.'), 'the reporter is told the decision');
  }
  await request('/logout', { method: 'POST' });

  response = await request('/forgot-password', { method: 'POST', headers: form, body: formBody({ email: uniqueEmail }) });
  assert(response.status === 302 && response.headers.get('location') === '/forgot-password/sent', 'a password reset link can be requested');
  if (local) {
    response = await request('/dev/mailbox');
    body = await response.text();
    assert(body.includes('Reset your Checkpoint password') && /\/reset-password\/[A-Za-z0-9_-]{43}/.test(body), 'the reset email with its link reaches the development mailbox');
  }
  cookie = memberCookie;
}

// Deleting the review, logging out, and the pages for guests and unknown addresses.
async function checkDeletionAndLogOut() {
  let response = await request('/games/kingdom-come-deliverance-2/review/delete', { method: 'POST' });
  assert(response.status === 302, 'review deletion redirects');
  assert(response.headers.get('location') === '/games/kingdom-come-deliverance-2#reviews', 'review deletion returns to the game review section');

  response = await request('/games/kingdom-come-deliverance-2');
  let body = await response.text();
  assert(!body.includes('Updated after more playtime'), 'deleted review leaves the game page');
  assert(body.includes('Be the first to review'), 'review page restores its empty state after deletion');

  response = await request('/logout', { method: 'POST' });
  assert(response.status === 302, 'logout redirects');
  assert(response.headers.get('location') === '/', 'logout redirects to homepage');

  response = await request('/');
  body = await response.text();
  assert(!body.includes('Welcome back, Updated'), 'logout removes the authenticated session');

  response = await request('/members/1/compare');
  assert(response.status === 302 && response.headers.get('location') === '/login', 'compare tastes asks guests to log in');

  response = await request('/route-that-does-not-exist');
  body = await response.text();
  assert(response.status === 404, 'unknown routes return status 404');
  assert(body.includes('checkpoint has not been unlocked'), 'custom 404 page renders');
}

async function run() {
  await startServer();
  await checkGuestPages();
  checkStyles();
  await checkAssets();
  await checkGuestRedirects();
  await checkVersion38();
  await checkSignUpAndLogIn();
  await checkReviews();
  await checkProfile();
  await checkLibrary();
  const reviewId = await checkVersion23();
  await checkVersion24(reviewId);
  await checkDeletionAndLogOut();
  console.log(`\n${passed} smoke checks passed.`);
  cleanUp();
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
  cleanUp();
});
