import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const silentLogger = { error() {}, info() {} };

function testConfig(overrides = {}) {
  return loadConfig({
    COMMUNITY_DESCRIPTION: 'A welcoming place for builders.',
    COMMUNITY_HEADLINE: 'Meet and build together.',
    COMMUNITY_LOGO_URL: 'https://cdn.example.com/community.svg',
    COMMUNITY_NAME: 'Example Community',
    COMMUNITY_WEBSITE_URL: 'https://example.com',
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://community.example.com',
    RATE_LIMIT_EMAIL_MAX: '2',
    RATE_LIMIT_IP_MAX: '2',
    SLACK_TEAM: 'example-workspace',
    SLACK_TOKEN: 'legacy-server-secret',
    TURNSTILE_EXPECTED_HOSTNAME: 'community.example.com',
    TURNSTILE_SECRET_KEY: 'turnstile-server-secret',
    TURNSTILE_SITE_KEY: 'turnstile-public-site-key',
    ...overrides,
  });
}

async function startApp(t, options) {
  const server = createServer(createApp(options));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('page and browser configuration never expose server secrets', async (t) => {
  const baseUrl = await startApp(t, {
    config: testConfig(),
    fetchImpl: async () => {
      throw new Error('No upstream request expected');
    },
    logger: silentLogger,
  });

  const pageResponse = await fetch(`${baseUrl}/`);
  const configResponse = await fetch(`${baseUrl}/config.js`);
  const page = await pageResponse.text();
  const clientConfig = await configResponse.text();

  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(pageResponse.headers.get('content-security-policy'), /https:\/\/cdn\.example\.com/);
  assert.match(page, /Get my invite/);
  assert.match(page, /Example Community/);
  assert.match(page, /https:\/\/cdn\.example\.com\/community\.svg/);
  assert.match(page, /Meet and build together\./);
  assert.match(page, /https:\/\/example-workspace\.slack\.com\//);
  assert.match(page, /https:\/\/community\.example\.com\/og\.png/);
  assert.doesNotMatch(page, />Wodby</i);
  assert.match(clientConfig, /turnstile-public-site-key/);
  assert.doesNotMatch(clientConfig, /legacy-server-secret/);
  assert.doesNotMatch(clientConfig, /turnstile-server-secret/);
});

test('runtime community text is escaped without reprocessing template markers', async (t) => {
  const baseUrl = await startApp(t, {
    config: testConfig({
      COMMUNITY_LOGO_URL: '',
      COMMUNITY_NAME: '{{FOOTER_NAV}}<script>alert(1)</script>',
    }),
    fetchImpl: async () => {
      throw new Error('No upstream request expected');
    },
    logger: silentLogger,
  });
  const page = await (await fetch(`${baseUrl}/`)).text();

  assert.match(page, /\{\{FOOTER_NAV\}\}&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
});

test('valid invitation verifies Turnstile before contacting Slack', async (t) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ options, url });

    if (url.includes('/turnstile/')) {
      return Response.json({
        action: 'invite',
        hostname: 'community.example.com',
        success: true,
      });
    }

    return Response.json({ ok: true });
  };
  const baseUrl = await startApp(t, {
    config: testConfig(),
    fetchImpl,
    logger: silentLogger,
  });
  const response = await fetch(`${baseUrl}/api/invitations`, {
    body: JSON.stringify({
      email: 'Person@Example.com',
      turnstileToken: 'verified-token',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.message, 'Invite sent. Check your inbox to join the workspace.');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /turnstile/);
  assert.match(calls[1].url, /users\.admin\.invite/);
  assert.equal(calls[1].options.body.get('email'), 'person@example.com');
});

test('invalid email never reaches Turnstile or Slack', async (t) => {
  let upstreamCalls = 0;
  const baseUrl = await startApp(t, {
    config: testConfig(),
    fetchImpl: async () => {
      upstreamCalls += 1;
      return Response.json({ success: true });
    },
    logger: silentLogger,
  });
  const response = await fetch(`${baseUrl}/api/invitations`, {
    body: JSON.stringify({ email: 'not-an-email', turnstileToken: 'token' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
});

test('non-object JSON is rejected without an upstream request', async (t) => {
  let upstreamCalls = 0;
  const baseUrl = await startApp(t, {
    config: testConfig(),
    fetchImpl: async () => {
      upstreamCalls += 1;
      return Response.json({ success: true });
    },
    logger: silentLogger,
  });
  const response = await fetch(`${baseUrl}/api/invitations`, {
    body: 'null',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
});

test('IP limiter rejects excess attempts with Retry-After', async (t) => {
  const baseUrl = await startApp(t, {
    config: testConfig({ RATE_LIMIT_IP_MAX: '1' }),
    fetchImpl: async (url) =>
      url.includes('/turnstile/')
        ? Response.json({
            action: 'invite',
            hostname: 'community.example.com',
            success: true,
          })
        : Response.json({ ok: true }),
    logger: silentLogger,
  });
  const request = () =>
    fetch(`${baseUrl}/api/invitations`, {
      body: JSON.stringify({ email: 'person@example.com', turnstileToken: 'token' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

  assert.equal((await request()).status, 200);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
