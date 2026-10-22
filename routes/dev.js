// Development tools. app.js mounts this router only when NODE_ENV is not production, and its pages answer only
// requests from this computer, because the mailbox shows working password reset links.
const express = require('express');
const { listMailbox } = require('../lib/mailer');
const { isoTime, relativeTime } = require('../lib/text');

const router = express.Router();
// The socket's own address, not req.ip: with TRUST_PROXY=1, req.ip comes from a header anyone can write.
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

router.use('/dev', (req, res, next) => {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress)) return res.status(404).render('404', { title: 'Page not found' });
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
  return next();
});

// Every email Checkpoint would have sent since the server started, newest first.
router.get('/dev/mailbox', (req, res) => {
  const messages = listMailbox().map((message) => ({
    ...message,
    lines: message.text.split('\n').map((line) => ({ text: line, link: /^https?:\/\/\S+$/.test(line) })),
    time: relativeTime(message.sentAt),
    datetime: isoTime(message.sentAt),
  }));
  res.render('mailbox', { title: 'Development mailbox', messages });
});

module.exports = router;
