// The "Recent security activity" list on the account page (lib/security-activity.js).
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { SECURITY_EVENTS, describeSecurityEvent } = require('../../lib/security-activity');
const { LOGIN_ATTEMPTS } = require('../../lib/security');

// Noon in Riyadh on 14 October 2026; stored times are UTC.
const now = Date.parse('2026-10-14T09:00:00Z');
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

describe('describeSecurityEvent', () => {
  it('describes a wrong password as a warning, with the browser and the time', () => {
    assert.deepEqual(describeSecurityEvent({ id: 5, type: 'sign_in_failed', user_agent: FIREFOX_LINUX, created_at: '2026-10-14 08:55:00' }, now), {
      id: 5,
      type: 'sign_in_failed',
      icon: 'alert',
      label: 'Wrong password entered',
      warning: true,
      device: 'Firefox on Linux',
      mobile: false,
      time: '5 min ago',
      datetime: '2026-10-14T08:55:00.000Z',
    });
  });

  it('marks phones, so the list can show a phone icon', () => {
    const event = describeSecurityEvent({ id: 6, type: 'sign_in', user_agent: SAFARI_IPHONE, created_at: '2026-10-13 06:00:00' }, now);
    assert.equal(event.device, 'Safari on iPhone');
    assert.equal(event.mobile, true);
    assert.equal(event.warning, false);
    assert.equal(event.time, 'yesterday');
  });

  it('names the lockout with the real number of attempts', () => {
    assert.equal(describeSecurityEvent({ id: 7, type: 'locked', user_agent: '' }, now).label, `Sign-ins paused after ${LOGIN_ATTEMPTS} wrong passwords`);
  });

  it('falls back for unknown events and browsers', () => {
    const event = describeSecurityEvent({ id: 8, type: 'mystery', user_agent: '', created_at: null }, now);
    assert.equal(event.icon, 'shield');
    assert.equal(event.label, 'Account activity');
    assert.equal(event.warning, false);
    assert.equal(event.device, 'Unknown browser');
    assert.equal(event.time, 'recently');
    assert.equal(event.datetime, '');
  });
});

describe('SECURITY_EVENTS', () => {
  it('warns only about what a member should recognise as their own doing', () => {
    const warnings = Object.keys(SECURITY_EVENTS).filter((type) => SECURITY_EVENTS[type].warning);
    assert.deepEqual(warnings, ['sign_in_failed', 'locked', 'reset_requested']);
  });
});
