const express = require('express');
const bcrypt = require('bcryptjs');
const { createUser, findUserByEmail } = require('../database/database');

const router = express.Router();

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

function validateRegistration({ name, email, password, confirmPassword }) {
  const errors = [];

  if (name.length < 2 || name.length > 60) {
    errors.push('Name must be between 2 and 60 characters.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Enter a valid email address.');
  }

  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.push('Password must contain at least 8 characters, including a letter and a number.');
  }

  if (password !== confirmPassword) {
    errors.push('Passwords do not match.');
  }

  return errors;
}

function redirectAuthenticatedUser(req, res, next) {
  if (req.session.user) {
    return res.redirect('/');
  }

  return next();
}

router.get('/register', redirectAuthenticatedUser, (req, res) => {
  res.render('register', {
    title: 'Create your account',
    errors: [],
    values: { name: '', email: '' },
  });
});

router.post('/register', redirectAuthenticatedUser, async (req, res, next) => {
  const name = (req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = normalizeEmail(req.body.email);
  const password = req.body.password || '';
  const confirmPassword = req.body.confirmPassword || '';
  const errors = validateRegistration({ name, email, password, confirmPassword });

  if (findUserByEmail(email)) {
    errors.push('An account with this email already exists.');
  }

  if (errors.length > 0) {
    return res.status(422).render('register', {
      title: 'Create your account',
      errors,
      values: { name, email },
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    createUser({ name, email, passwordHash });
    req.session.notice = {
      type: 'success',
      message: 'Account created successfully. You can now log in.',
    };
    return res.redirect('/login');
  } catch (error) {
    if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(422).render('register', {
        title: 'Create your account',
        errors: ['An account with this email already exists.'],
        values: { name, email },
      });
    }

    return next(error);
  }
});

router.get('/login', redirectAuthenticatedUser, (req, res) => {
  res.render('login', {
    title: 'Welcome back',
    errors: [],
    values: { email: '' },
  });
});

router.post('/login', redirectAuthenticatedUser, async (req, res, next) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password || '';
  const user = findUserByEmail(email);
  const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!user || !passwordMatches) {
    return res.status(401).render('login', {
      title: 'Welcome back',
      errors: ['The email or password is incorrect.'],
      values: { email },
    });
  }

  return req.session.regenerate((error) => {
    if (error) {
      return next(error);
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
    };
    req.session.notice = {
      type: 'success',
      message: `Welcome back, ${user.name.split(' ')[0]}.`,
    };

    return req.session.save((saveError) => {
      if (saveError) {
        return next(saveError);
      }

      return res.redirect('/');
    });
  });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie('checkpoint.sid');
    return res.redirect('/');
  });
});

module.exports = router;
