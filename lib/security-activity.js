// The "Recent security activity" list on the account page: what happened, in which browser, and when.
// Pure functions, unit tested in test/unit/security-activity.test.js.
const { describeDevice } = require('./devices');
const { LOGIN_ATTEMPTS } = require('./security');
const { isoTime, relativeTime } = require('./text');

// `warning` marks events the member should recognise; if they do not, someone else may know their password.
const EVENTS = {
  account_created: { icon: 'user', label: 'Account created', warning: false },
  sign_in: { icon: 'check', label: 'Signed in', warning: false },
  sign_in_failed: { icon: 'alert', label: 'Wrong password entered', warning: true },
  locked: { icon: 'lock', label: `Sign-ins paused after ${LOGIN_ATTEMPTS} wrong passwords`, warning: true },
  password_changed: { icon: 'key', label: 'Password changed', warning: false },
  reset_requested: { icon: 'mail', label: 'Password reset link requested', warning: true },
  password_reset: { icon: 'key', label: 'Password reset with an email link', warning: false },
  signed_out_others: { icon: 'logout', label: 'Signed out of the other devices', warning: false },
};

function describeSecurityEvent(row, now = Date.now()) {
  const event = EVENTS[row.type] || { icon: 'shield', label: 'Account activity', warning: false };
  const device = describeDevice(row.user_agent);
  return {
    id: row.id,
    type: row.type,
    icon: event.icon,
    label: event.label,
    warning: event.warning,
    device: device.label,
    mobile: device.mobile,
    time: relativeTime(row.created_at, now),
    datetime: isoTime(row.created_at),
  };
}

module.exports = { SECURITY_EVENTS: EVENTS, describeSecurityEvent };
