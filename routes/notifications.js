// Notifications controller: the member's inbox of follows, helpful votes, replies to their reviews, moderators'
// decisions and security alerts.
const express = require('express');
const { countUnreadNotifications, listNotifications, markNotificationsRead } = require('../database/notifications');
const { requireLogin } = require('../lib/auth');
const { describeNotification, groupByDay } = require('../lib/notifications');
const { LOGIN_ATTEMPTS } = require('../lib/security');

const router = express.Router();

// Opening the inbox marks everything in it as seen, like a view counter: a second visit changes nothing,
// and the items that were new on this visit keep their "New" tag until the next one.
router.get('/notifications', requireLogin('Log in to see your notifications.'), (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const items = listNotifications(userId).map((row) => describeNotification(row));
    const unread = countUnreadNotifications(userId);
    if (unread > 0) markNotificationsRead(userId);
    // The header is rendered after this, so its bell already shows the inbox as read.
    res.locals.unreadNotifications = 0;
    return res.render('notifications', {
      title: 'Notifications',
      days: groupByDay(items),
      unread,
      total: items.length,
      loginAttempts: LOGIN_ATTEMPTS,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
