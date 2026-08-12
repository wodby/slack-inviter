import assert from 'node:assert/strict';
import test from 'node:test';

import { getInviteState } from '../public/invite-state.js';

const now = Date.parse('2026-08-12T12:00:00Z');

test('returns active when expiry is more than seven days away', () => {
  assert.equal(getInviteState('2026-08-20T12:00:01Z', now), 'active');
});

test('returns expiring during the final seven days', () => {
  assert.equal(getInviteState('2026-08-19T12:00:00Z', now), 'expiring');
});

test('returns expired at the expiry timestamp', () => {
  assert.equal(getInviteState('2026-08-12T12:00:00Z', now), 'expired');
});

test('returns unavailable for missing or invalid configuration', () => {
  assert.equal(getInviteState('', now), 'unavailable');
  assert.equal(getInviteState('not-a-date', now), 'unavailable');
});
