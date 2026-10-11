const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabasePath = path.join(os.tmpdir(), `checkpoint-smoke-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDatabasePath;

const app = require('../app');
const { closeDatabase } = require('../database/database');

let baseUrl = process.env.TEST_BASE_URL || '';
let server;

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

async function run() {
  if (!baseUrl) {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  const uniqueEmail = `smoke-${Date.now()}@checkpoint.test`;
  const password = 'Checkpoint123';

  let response = await request('/');
  let body = await response.text();
  assert(response.status === 200, 'homepage responds with status 200');
  assert(body.includes('Keep track of the games you play'), 'homepage renders the Checkpoint introduction');
  assert(body.includes('Elden Ring'), 'homepage renders real game titles');
  assert(body.includes('EA Sports FC 27'), 'homepage renders EA Sports FC 27');
  assert(body.includes('Kingdom Come: Deliverance II'), 'homepage renders Kingdom Come: Deliverance II');
  assert(body.includes('Resident Evil Requiem'), 'homepage renders recent 2026 games');
  assert(body.includes('Fresh checkpoints'), 'homepage includes a new releases section');
  assert(body.includes('Highly rated by players'), 'homepage includes a popular games section');
  assert(body.includes('/games/ea-sports-fc-27'), 'homepage game posters link to detail pages');
  assert(body.includes('Recently reviewed'), 'homepage renders recent reviews');
  assert(body.includes('Lists worth saving'), 'homepage renders community lists');

  response = await request('/games');
  body = await response.text();
  assert(response.status === 200, 'game catalogue responds with status 200');
  assert(body.includes('Find your next game'), 'game catalogue renders working search controls');
  assert((body.match(/class="game-card reveal"/g) || []).length === 16, 'game catalogue renders all sixteen games');
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

  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');
  assert(styles.includes('--green: #5ee7a4'), 'homepage uses the green theme color');
  assert(styles.includes('--blue: #7dd3fc'), 'homepage uses the light-blue theme color');
  assert(/\.weekly-pick\s*\{[^}]*overflow:\s*hidden/s.test(styles), 'featured artwork stays inside its panel');
  assert(/\.list-posters img\s*\{[^}]*height:\s*auto/s.test(styles), 'list posters keep their correct aspect ratio');
  assert(styles.includes('.profile-dropdown'), 'profile menu styles are included');
  assert(/\.profile-game img\s*\{[^}]*height:\s*auto/s.test(styles), 'profile posters keep their correct aspect ratio');
  assert(styles.includes('.game-hero'), 'game detail layout styles are included');
  assert(styles.includes('.catalogue-search'), 'search interface styles are included');
  assert(styles.includes('.rating-choices'), 'interactive rating styles are included');

  for (const asset of [
    '/css/styles.css',
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
    response = await request(asset);
    assert(response.status === 200, `${asset} loads successfully`);
  }

  const steamLogo = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'platforms', 'steam.svg'), 'utf8');
  const playStationLogo = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'platforms', 'playstation.svg'), 'utf8');
  const xboxLogo = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', 'platforms', 'xbox.svg'), 'utf8');
  assert(steamLogo.includes('<title>Steam</title>'), 'Steam uses the recognizable platform brand mark');
  assert(playStationLogo.includes('<title>PlayStation</title>'), 'PlayStation uses the recognizable platform brand mark');
  assert(xboxLogo.includes('<title>Xbox</title>'), 'Xbox uses the recognizable platform brand mark');

  response = await request('/profile');
  assert(response.status === 302, 'profile redirects guests to login');
  assert(response.headers.get('location') === '/login', 'guest profile redirect targets login');

  response = await request('/library');
  assert(response.status === 302, 'library redirects guests to login');
  assert(response.headers.get('location') === '/login', 'guest library redirect targets login');

  response = await request('/register');
  body = await response.text();
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
  assert(response.headers.get('location') === '/login', 'valid registration redirects to login');

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

  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
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
  assert(body.includes('Choose a rating from 1 to 5 stars'), 'invalid review rating shows feedback');

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

  response = await request('/profile');
  body = await response.text();
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

  response = await request('/library/elden-ring/add', {
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
  assert(body.includes('Manage your games'), 'library page renders its management tools');
  assert(body.includes('Elden Ring'), 'library page displays the saved game');
  assert(body.includes('Profile favorite'), 'library page supports profile favorites');

  response = await request('/library/elden-ring/update', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ status: 'playing', isFavorite: 'on' }),
  });
  assert(response.status === 302, 'library status update redirects');
  assert(response.headers.get('location') === '/library', 'library status update returns to the library');

  response = await request('/profile');
  body = await response.text();
  assert(body.includes('Favorite games'), 'favorite games appear on the profile');
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

  response = await request('/');
  body = await response.text();
  assert(body.includes('Welcome back, Updated'), 'profile name update refreshes the session navigation');

  response = await request('/games/kingdom-come-deliverance-2/review/delete', { method: 'POST' });
  assert(response.status === 302, 'review deletion redirects');
  assert(response.headers.get('location') === '/games/kingdom-come-deliverance-2#reviews', 'review deletion returns to the game review section');

  response = await request('/games/kingdom-come-deliverance-2');
  body = await response.text();
  assert(!body.includes('Updated after more playtime'), 'deleted review leaves the game page');
  assert(body.includes('Be the first to review'), 'review page restores its empty state after deletion');

  response = await request('/logout', { method: 'POST' });
  assert(response.status === 302, 'logout redirects');
  assert(response.headers.get('location') === '/', 'logout redirects to homepage');

  response = await request('/');
  body = await response.text();
  assert(!body.includes('Welcome back, Updated'), 'logout removes the authenticated session');

  response = await request('/route-that-does-not-exist');
  body = await response.text();
  assert(response.status === 404, 'unknown routes return status 404');
  assert(body.includes('checkpoint has not been unlocked'), 'custom 404 page renders');

  console.log(`\n${passed} smoke checks passed.`);
  cleanUp();
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
  cleanUp();
});
