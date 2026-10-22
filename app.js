// Settings from .env (README, "Settings"). Quiet, so the server's only startup line is the address to open.
require('dotenv').config({ quiet: true });

const path = require('node:path');
const compression = require('compression');
const express = require('express');
const session = require('express-session');
const homeRoutes = require('./routes/home');
const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');
const gameRoutes = require('./routes/games');
const libraryRoutes = require('./routes/library');
const profileRoutes = require('./routes/profile');
const communityRoutes = require('./routes/community');
const discoverRoutes = require('./routes/discover');
const apiRoutes = require('./routes/api');
const notificationRoutes = require('./routes/notifications');
const accountRoutes = require('./routes/account');
const passwordResetRoutes = require('./routes/password-reset');
const moderationRoutes = require('./routes/moderation');
const reviewRoutes = require('./routes/reviews');
const versusRoutes = require('./routes/versus');
const tierRoutes = require('./routes/tiers');
const devRoutes = require('./routes/dev');
const { version } = require('./package.json');
const { checkDatabase, closeDatabase, findGameBySlug, findUserById } = require('./database/database');
const { countOpenReports } = require('./database/moderation');
const { hasDemoCommunity } = require('./database/community');
const { countUnreadNotifications } = require('./database/notifications');
const { SqliteSessionStore } = require('./database/session-store');
const { SESSION_LIFETIME } = require('./lib/auth');
const { assetUrl, coverAttributes, previewAttributes, thumb } = require('./lib/assets');
const { mailboxEnabled } = require('./lib/mailer');
const { badgeLabel } = require('./lib/notifications');
const { createCoverCache } = require('./lib/cover-cache');
const { coverUrlsFor } = require('./lib/steam-media');
const { placeholderCoverSvg } = require('./lib/placeholder-cover');
const { securityHeaders, verifySameOrigin } = require('./lib/security');
const { RULES_PATH, announceSpeculationRules, serveSpeculationRules } = require('./lib/speculation');
const { formatDate, initial, isoTime } = require('./lib/text');
const { hueFor, icon, plural, starString, statusMeta } = require('./lib/view-helpers');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
// TRUST_PROXY=1 is for running behind one reverse proxy that provides HTTPS: Express then reads the visitor's
// protocol and address from the proxy's X-Forwarded-* headers, so the Secure session cookie is sent and the
// login limiter counts visitors instead of the proxy. It is off by default because, without a proxy in front,
// anyone could write those headers.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.initial = initial;
app.locals.formatDate = formatDate;
app.locals.isoTime = isoTime;
app.locals.icon = icon;
app.locals.hueFor = hueFor;
app.locals.plural = plural;
app.locals.starString = starString;
app.locals.statusMeta = statusMeta;
app.locals.assetUrl = assetUrl;
app.locals.coverAttributes = coverAttributes;
app.locals.previewAttributes = previewAttributes;
app.locals.thumb = thumb;
app.locals.badgeLabel = badgeLabel;

app.use(securityHeaders);
// gzip for HTML, CSS, JavaScript and JSON (images and fonts are already compressed).
app.use(compression());
// Instant page changes: pages announce which links the browser may fetch early (lib/speculation.js).
app.use(announceSpeculationRules);
app.get(RULES_PATH, serveSpeculationRules);

// For uptime monitors and load balancers: 200 while the database answers, 503 when it does not. It comes before
// the session middleware, so checking it never creates a session.
app.get('/health', (req, res) => {
  const databaseOk = checkDatabase();
  res.set('Cache-Control', 'no-store');
  res.status(databaseOk ? 200 : 503).json({
    status: databaseOk ? 'ok' : 'unavailable',
    version,
    uptimeSeconds: Math.round(process.uptime()),
    database: databaseOk ? 'ok' : 'unavailable',
  });
});

// Defaults first: the error page needs these even if the body parser or the session fails.
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.currentPath = req.path;
  res.locals.notice = null;
  res.locals.unreadNotifications = 0;
  res.locals.isAdmin = false;
  res.locals.openReports = 0;
  res.locals.demoCommunity = hasDemoCommunity();
  // "Log in" and "Sign up" links bring the visitor back to the page they were reading.
  const staysHome = req.method !== 'GET' || ['/', '/login', '/register'].includes(req.path) || req.originalUrl.length > 180;
  res.locals.loginQuery = staysHome ? '' : `?next=${encodeURIComponent(req.originalUrl)}`;
  next();
});

app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Express 5 leaves req.body undefined for non-form requests, and repeated fields (a=1&a=2) arrive as arrays.
app.use((req, res, next) => {
  req.body = req.body || {};
  for (const [key, value] of Object.entries(req.body)) {
    if (Array.isArray(value) && key !== 'favoriteGenres') {
      req.body[key] = value[0];
    }
  }
  next();
});

// Stylesheets and the script are linked with a version in the URL (lib/assets.js) and fonts never change,
// so browsers may keep them for a year; images are revalidated daily.
const publicDirectory = path.join(__dirname, 'public');
const LONG_LIVED_FOLDERS = new Set(['css', 'js', 'fonts']);
app.use(express.static(publicDirectory, {
  setHeaders(res, filePath) {
    const folder = path.relative(publicDirectory, filePath).split(path.sep)[0];
    res.set('Cache-Control', LONG_LIVED_FOLDERS.has(folder) ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
  },
}));

// A cover that is not shipped with the project: first the copy cached in data/covers, then (once) Steam's own
// cover, saved for next time; only when neither exists a generated poster is drawn.
const coverCache = createCoverCache();
app.get('/images/covers/:file', async (req, res, next) => {
  try {
    const slug = path.parse(req.params.file).name;
    const game = findGameBySlug(null, slug);
    if (!game) return next();
    const cached = await coverCache.get(game.slug, coverUrlsFor(game));
    if (cached) {
      return res.type('image/jpeg').set('Cache-Control', 'public, max-age=86400').sendFile(cached);
    }
    return res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(placeholderCoverSvg(game));
  } catch (error) {
    return next(error);
  }
});

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when NODE_ENV is production.');
}

// Sessions live in the SQLite database (database/session-store.js), so a restart does not sign anyone out.
// `rolling` renews the cookie on every response, so a sign-in ends after a day without visits (30 days with
// "Keep me signed in"), not a day after logging in.
app.use(
  session({
    name: 'checkpoint.sid',
    secret: process.env.SESSION_SECRET || 'checkpoint-development-secret-change-before-deployment',
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_LIFETIME,
    },
  }),
);

app.use((req, res, next) => {
  // A deleted account is signed out everywhere, and a name changed on another device shows up here too. The
  // administrator role is read here on every request and never kept in the session, so taking it away works at once.
  req.isAdmin = false;
  if (req.session.user) {
    const member = findUserById(req.session.user.id);
    if (!member) delete req.session.user;
    else {
      if (member.name !== req.session.user.name) req.session.user.name = member.name;
      req.isAdmin = member.role === 'admin';
    }
  }
  res.locals.currentUser = req.session.user || null;
  res.locals.notice = req.session.notice || null;
  delete req.session.notice;
  if (req.session.user) {
    res.locals.unreadNotifications = countUnreadNotifications(req.session.user.id);
    res.locals.isAdmin = req.isAdmin;
    if (req.isAdmin) res.locals.openReports = countOpenReports();
    // Pages with a member's private data are never stored by the browser or a proxy, so "Back" after
    // logging out cannot show them again.
    res.set('Cache-Control', 'no-store');
  }
  next();
});

app.use(verifySameOrigin);

app.use(homeRoutes);
app.use(authRoutes);
app.use(onboardingRoutes);
app.use(passwordResetRoutes);
app.use(gameRoutes);
app.use(libraryRoutes);
app.use(profileRoutes);
app.use(reviewRoutes);
app.use(versusRoutes);
app.use(tierRoutes);
app.use(communityRoutes);
app.use(moderationRoutes);
app.use(discoverRoutes);
app.use(notificationRoutes);
app.use(accountRoutes);
app.use(apiRoutes);
// The development mailbox (password reset emails) does not exist in production.
if (mailboxEnabled()) app.use(devRoutes);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Page not found' });
});

app.use((error, req, res, next) => {
  if (!(error.status >= 400 && error.status < 500)) console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  // Client errors (413 body too large, 400 bad URL, 403 blocked request) keep their status; everything else is a 500.
  const status = error.status >= 400 && error.status < 500 ? error.status : 500;
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: status === 500 ? 'Something went wrong' : error.message });
  }
  return res.status(status).render('error', {
    title: 'Something went wrong',
    status,
    message: status === 403 ? 'This request was blocked to protect your account. Please try again from the Checkpoint page.' : null,
  });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Checkpoint is running at http://localhost:${server.address().port}`);
  });

  // Ctrl+C, or a stop from the host (SIGTERM, as Docker and most hosting platforms send): no new connections,
  // the requests already running finish, then the database is closed so SQLite folds its write-ahead log back
  // into the database file. If requests are still running after 10 seconds, the process stops anyway.
  let stopping = false;
  const shutDown = (signal) => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      closeDatabase();
      console.log('Checkpoint stopped.');
    });
    console.log(`${signal} received: finishing the requests already running, then stopping.`);
    setTimeout(() => {
      console.error('Requests were still running after 10 seconds; stopping anyway.');
      process.exit(1);
    }, 10_000).unref();
  };
  process.on('SIGTERM', () => shutDown('SIGTERM'));
  process.on('SIGINT', () => shutDown('SIGINT'));
}

module.exports = app;
