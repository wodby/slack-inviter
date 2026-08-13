import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

test('development configuration can run without Turnstile', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    SLACK_TEAM: 'example-workspace',
    SLACK_TOKEN: 'legacy-test-token',
  });

  assert.equal(config.community.name, 'Slack Community');
  assert.equal(config.publicUrl, 'http://localhost:3000');
  assert.equal(config.turnstile.enabled, false);
  assert.equal(config.turnstile.siteKey, '');
  assert.equal(config.port, 3000);
  assert.equal(config.trustProxy, false);
});

test('production configuration requires a public URL', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        SLACK_TEAM: 'example-workspace',
        SLACK_TOKEN: 'legacy-test-token',
      }),
    /PUBLIC_URL is required/,
  );
});

test('production configuration can run without optional Turnstile credentials', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://community.example.com',
    SLACK_TEAM: 'example-workspace',
    SLACK_TOKEN: 'legacy-test-token',
  });

  assert.equal(config.turnstile.enabled, false);
  assert.equal(config.turnstile.secretKey, '');
  assert.equal(config.turnstile.siteKey, '');
});

test('Turnstile credentials must be configured together', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        PUBLIC_URL: 'https://community.example.com',
        SLACK_TEAM: 'example-workspace',
        SLACK_TOKEN: 'legacy-test-token',
        TURNSTILE_SITE_KEY: 'site',
      }),
    /must be configured together/,
  );
});

test('production configuration renders custom community values', () => {
  const config = loadConfig({
    COMMUNITY_DESCRIPTION: 'A place for builders.',
    COMMUNITY_HEADLINE: 'Build better, together.',
    COMMUNITY_LOGO_URL: 'https://cdn.example.com/community.svg',
    COMMUNITY_NAME: 'Example Community',
    PUBLIC_URL: 'https://community.example.com',
    SOCIAL_IMAGE_URL: '/preview.png',
    NODE_ENV: 'production',
    SLACK_TEAM: 'example-workspace',
    SLACK_TOKEN: 'legacy-test-token',
    TRUST_PROXY: 'true',
    TURNSTILE_SECRET_KEY: 'secret',
    TURNSTILE_SITE_KEY: 'site',
  });

  assert.equal(config.community.name, 'Example Community');
  assert.equal(config.community.headline, 'Build better, together.');
  assert.equal(config.community.logoUrl, 'https://cdn.example.com/community.svg');
  assert.equal(config.publicUrl, 'https://community.example.com');
  assert.equal(config.socialImageUrl, 'https://community.example.com/preview.png');
  assert.equal(config.trustProxy, true);
  assert.equal(config.turnstile.enabled, true);
});

test('unsafe community URLs are rejected', () => {
  assert.throws(
    () =>
      loadConfig({
        COMMUNITY_LOGO_URL: 'javascript:alert(1)',
        NODE_ENV: 'development',
        SLACK_TEAM: 'example-workspace',
        SLACK_TOKEN: 'legacy-test-token',
      }),
    /COMMUNITY_LOGO_URL must/,
  );
});
