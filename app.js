require('dotenv').config();

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/games');
const libraryRoutes = require('./routes/library');
const profileRoutes = require('./routes/profile');
const { listGamesForUser, listRecentReviews } = require('./database/database');

const app = express();
const PORT = process.env.PORT || 3000;

const libraryStatusLabels = {
  want_to_play: 'Want to Play',
  playing: 'Playing',
  played: 'Played',
  completed: 'Completed',
};

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    name: 'checkpoint.sid',
    secret: process.env.SESSION_SECRET || 'checkpoint-development-secret-change-before-deployment',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24,
    },
  }),
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.notice = req.session.notice || null;
  delete req.session.notice;
  next();
});

app.get('/', (req, res, next) => {
  try {
    const allGames = listGamesForUser(req.session.user?.id);
    const newReleases = allGames.slice(0, 6);
    const popularGames = [...allGames]
      .sort((first, second) => second.rating - first.rating || second.year - first.year)
      .slice(0, 6);
    const playingGames = req.session.user
      ? allGames.filter((game) => game.status === 'playing').slice(0, 6)
      : [];
    const recentReviews = listRecentReviews(3).map((review) => ({
      ...review,
      displayDate: new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${review.updated_at.replace(' ', 'T')}Z`)),
    }));

    return res.render('index', {
      title: 'Track, rate, and discover games',
      allGames,
      newReleases,
      popularGames,
      playingGames,
      recentReviews,
      libraryStatusLabels,
    });
  } catch (error) {
    return next(error);
  }
});

app.use(authRoutes);
app.use(gameRoutes);
app.use(libraryRoutes);
app.use(profileRoutes);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Page not found' });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).render('error', { title: 'Something went wrong' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Checkpoint is running at http://localhost:${PORT}`);
  });
}

module.exports = app;
