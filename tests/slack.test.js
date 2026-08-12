import assert from 'node:assert/strict';
import test from 'node:test';

import { inviteToSlack, SlackInviteError } from '../src/slack.js';

test('Slack invitation uses the legacy Slackin-compatible request', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { options, url };
    return Response.json({ ok: true });
  };

  const result = await inviteToSlack({
    email: 'person@example.com',
    fetchImpl,
    team: 'example-workspace',
    token: 'legacy-secret-token',
  });

  assert.deepEqual(result, { status: 'invited' });
  assert.equal(
    request.url,
    'https://example-workspace.slack.com/api/users.admin.invite',
  );
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body.get('email'), 'person@example.com');
  assert.equal(request.options.body.get('token'), 'legacy-secret-token');
});

test('Slack invitation treats existing invitations and members as success states', async () => {
  const alreadyInvited = await inviteToSlack({
    email: 'person@example.com',
    fetchImpl: async () => Response.json({ error: 'already_invited', ok: false }),
    team: 'example-workspace',
    token: 'token',
  });
  const alreadyMember = await inviteToSlack({
    email: 'person@example.com',
    fetchImpl: async () => Response.json({ error: 'already_in_team', ok: false }),
    team: 'example-workspace',
    token: 'token',
  });

  assert.equal(alreadyInvited.status, 'already_invited');
  assert.equal(alreadyMember.status, 'already_member');
});

test('Slack invitation returns a typed error without exposing the token', async () => {
  await assert.rejects(
    inviteToSlack({
      email: 'person@example.com',
      fetchImpl: async () => Response.json({ error: 'invalid_auth', ok: false }),
      team: 'example-workspace',
      token: 'legacy-secret-token',
    }),
    (error) => error instanceof SlackInviteError && error.code === 'invalid_auth',
  );
});
