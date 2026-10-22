const express = require('express');
const { findUserById, updateUserProfile } = require('../database/database');
const { requireLogin } = require('../lib/auth');
const { memberPage } = require('../lib/member-page');
const { characterLength } = require('../lib/text');

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
    profilePublic: user.profile_public === undefined ? true : Boolean(user.profile_public),
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

  if (characterLength(name) < 2 || characterLength(name) > 60) {
    errors.push('Display name must be between 2 and 60 characters.');
  }

  if (characterLength(bio) > 280) {
    errors.push('Bio must be 280 characters or fewer.');
  }

  if (characterLength(steamId) > 64) {
    errors.push('Steam username or ID must be 64 characters or fewer.');
  }

  if (characterLength(psnId) > 32) {
    errors.push('PlayStation Network ID must be 32 characters or fewer.');
  }

  if (characterLength(xboxId) > 32) {
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

router.use('/profile', requireLogin('Log in to view your profile.'));

// Your own player page: the same template as /members/:id, seen as the owner.
router.get('/profile', (req, res, next) => {
  try {
    const page = memberPage(req.session.user.id, req.session.user.id);

    if (!page) {
      return res.status(404).render('404', { title: 'Profile not found' });
    }

    return res.render('member', page);
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
    profilePublic: req.body.profilePublic === 'on',
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
