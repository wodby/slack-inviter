import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyTurnstile } from '../src/turnstile.js';

test('Turnstile sends the secret and validates action and hostname', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { options, url };
    return Response.json({
      action: 'invite',
      hostname: 'community.example.com',
      success: true,
    });
  };

  const result = await verifyTurnstile({
    expectedHostname: 'community.example.com',
    fetchImpl,
    remoteIp: '203.0.113.2',
    secretKey: 'turnstile-secret',
    token: 'turnstile-token',
  });

  assert.equal(result.success, true);
  assert.equal(
    request.url,
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  );
  assert.equal(request.options.body.get('secret'), 'turnstile-secret');
  assert.equal(request.options.body.get('response'), 'turnstile-token');
  assert.equal(request.options.body.get('remoteip'), '203.0.113.2');
});

test('Turnstile rejects a token from a different action', async () => {
  const result = await verifyTurnstile({
    fetchImpl: async () => Response.json({ action: 'login', success: true }),
    secretKey: 'turnstile-secret',
    token: 'turnstile-token',
  });

  assert.equal(result.success, false);
});
