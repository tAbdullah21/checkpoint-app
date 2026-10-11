const express = require('express');
const { findUserById, listUserLibrary, updateUserProfile } = require('../database/database');

const router = express.Router();

const genreOptions = [
  'Action',
  'Adventure',
  'RPG',
  'Strategy',
  'Racing',
  'Sports',
  'Simulation',
  'Horror',
  'Indie',
];
const platformOptions = {
  steam: 'PC / Steam',
  playstation: 'PlayStation',
  xbox: 'Xbox',
};
const libraryStatusLabels = {
  want_to_play: 'Want to Play',
  playing: 'Playing',
  played: 'Played',
  completed: 'Completed',
};

function requireAuthentication(req, res, next) {
  if (req.session.user) {
    return next();
  }

  req.session.notice = {
    type: 'info',
    message: 'Log in to view your profile.',
  };
  return res.redirect('/login');
}

function formatJoinedDate(value) {
  const timestamp = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function splitGenres(value = '') {
  return value.split(',').map((genre) => genre.trim()).filter(Boolean);
}

function profileValues(user) {
  return {
    name: user.name,
    bio: user.bio || '',
    steamId: user.steam_id || '',
    psnId: user.psn_id || '',
    xboxId: user.xbox_id || '',
    steamVisible: Boolean(user.steam_visible),
    psnVisible: Boolean(user.psn_visible),
    xboxVisible: Boolean(user.xbox_visible),
    preferredPlatform: user.preferred_platform || '',
    favoriteGenres: splitGenres(user.favorite_genres),
  };
}

function normalizeGenres(value) {
  const submittedGenres = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(submittedGenres.filter((genre) => genreOptions.includes(genre)))];
}

function validateProfile({
  name,
  bio,
  steamId,
  psnId,
  xboxId,
  preferredPlatform,
  favoriteGenres,
}) {
  const errors = [];

  if (name.length < 2 || name.length > 60) {
    errors.push('Display name must be between 2 and 60 characters.');
  }

  if (bio.length > 280) {
    errors.push('Bio must be 280 characters or fewer.');
  }

  if (steamId.length > 64) {
    errors.push('Steam username or ID must be 64 characters or fewer.');
  }

  if (psnId.length > 32) {
    errors.push('PlayStation Network ID must be 32 characters or fewer.');
  }

  if (xboxId.length > 32) {
    errors.push('Xbox gamertag must be 32 characters or fewer.');
  }

  if (preferredPlatform && !Object.hasOwn(platformOptions, preferredPlatform)) {
    errors.push('Choose a valid preferred platform.');
  }

  if (favoriteGenres.length > 5) {
    errors.push('Choose up to five favorite genres.');
  }

  return errors;
}

function visibleGamingAccounts(user) {
  return [
    {
      name: 'Steam',
      slug: 'steam',
      id: user.steam_id,
      visible: user.steam_visible,
      logo: '/images/platforms/steam.svg',
    },
    {
      name: 'PlayStation Network',
      slug: 'playstation',
      id: user.psn_id,
      visible: user.psn_visible,
      logo: '/images/platforms/playstation.svg',
    },
    {
      name: 'Xbox',
      slug: 'xbox',
      id: user.xbox_id,
      visible: user.xbox_visible,
      logo: '/images/platforms/xbox.svg',
    },
  ].filter((account) => account.id && account.visible);
}

router.use('/profile', requireAuthentication);

router.get('/profile', (req, res, next) => {
  try {
    const user = findUserById(req.session.user.id);

    if (!user) {
      return res.status(404).render('404', { title: 'Profile not found' });
    }

    const libraryEntries = listUserLibrary(user.id);
    const favoriteGames = libraryEntries.filter((game) => game.is_favorite).slice(0, 4);
    const playingGames = libraryEntries.filter((game) => game.status === 'playing');

    return res.render('profile', {
      title: `${user.name}'s profile`,
      user,
      joinedDate: formatJoinedDate(user.created_at),
      visibleAccounts: visibleGamingAccounts(user),
      preferredPlatformLabel: platformOptions[user.preferred_platform] || 'Not selected',
      favoriteGenres: splitGenres(user.favorite_genres),
      libraryEntries,
      favoriteGames,
      playingGames,
      libraryStatusLabels,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/profile/edit', (req, res, next) => {
  try {
    const user = findUserById(req.session.user.id);

    if (!user) {
      return res.status(404).render('404', { title: 'Profile not found' });
    }

    return res.render('edit-profile', {
      title: 'Edit profile',
      errors: [],
      values: profileValues(user),
      genreOptions,
      platformOptions,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/profile/edit', (req, res, next) => {
  const name = (req.body.name || '').trim().replace(/\s+/g, ' ');
  const bio = (req.body.bio || '').trim();
  const steamId = (req.body.steamId || '').trim();
  const psnId = (req.body.psnId || '').trim();
  const xboxId = (req.body.xboxId || '').trim();
  const preferredPlatform = (req.body.preferredPlatform || '').trim();
  const favoriteGenres = normalizeGenres(req.body.favoriteGenres);
  const values = {
    name,
    bio,
    steamId,
    psnId,
    xboxId,
    steamVisible: req.body.steamVisible === 'on',
    psnVisible: req.body.psnVisible === 'on',
    xboxVisible: req.body.xboxVisible === 'on',
    preferredPlatform,
    favoriteGenres,
  };
  const errors = validateProfile(values);

  if (errors.length > 0) {
    return res.status(422).render('edit-profile', {
      title: 'Edit profile',
      errors,
      values,
      genreOptions,
      platformOptions,
    });
  }

  try {
    const user = updateUserProfile({
      id: req.session.user.id,
      ...values,
      favoriteGenres: favoriteGenres.join(','),
    });

    if (!user) {
      return res.status(404).render('404', { title: 'Profile not found' });
    }

    req.session.user.name = user.name;
    req.session.notice = {
      type: 'success',
      message: 'Your profile has been updated.',
    };

    return req.session.save((error) => {
      if (error) {
        return next(error);
      }

      return res.redirect('/profile');
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
