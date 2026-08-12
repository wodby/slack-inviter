import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

test('development configuration can run without Turnstile', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    SLACK_TEAM: 'wodby',
    SLACK_TOKEN: 'legacy-test-token',
  });

  assert.equal(config.turnstile.required, false);
  assert.equal(config.turnstile.siteKey, '');
  assert.equal(config.port, 3000);
  assert.equal(config.trustProxy, false);
});

test('production configuration requires both Turnstile keys', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        SLACK_TEAM: 'wodby',
        SLACK_TOKEN: 'legacy-test-token',
      }),
    /Turnstile credentials are required/,
  );
});

test('Wodby configuration trusts its route proxy by default', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    SLACK_TEAM: 'wodby',
    SLACK_TOKEN: 'legacy-test-token',
    TURNSTILE_SECRET_KEY: 'secret',
    TURNSTILE_SITE_KEY: 'site',
    WODBY_APP_SERVICE_NAME: 'node',
  });

  assert.equal(config.trustProxy, true);
});
