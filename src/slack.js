export class SlackInviteError extends Error {
  constructor(code, options = {}) {
    super(code, options);
    this.code = code;
  }
}

/**
 * Send an invitation through the legacy endpoint used by Slackin.
 *
 * Slack no longer documents this endpoint. Keeping this call isolated makes
 * the compatibility boundary explicit and easy to replace if Slack removes it.
 */
export async function inviteToSlack({ email, fetchImpl = globalThis.fetch, team, token }) {
  const body = new URLSearchParams({ email, token });
  let response;

  try {
    response = await fetchImpl(`https://${team}.slack.com/api/users.admin.invite`, {
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new SlackInviteError('network_error', { cause: error });
  }

  if (!response.ok) {
    throw new SlackInviteError(response.status === 429 ? 'ratelimited' : 'http_error');
  }

  let result;

  try {
    result = await response.json();
  } catch (error) {
    throw new SlackInviteError('invalid_response', { cause: error });
  }

  if (result.ok === true) {
    return { status: 'invited' };
  }

  if (result.error === 'already_invited') {
    return { status: 'already_invited' };
  }

  if (result.error === 'already_in_team') {
    return { status: 'already_member' };
  }

  throw new SlackInviteError(result.error || 'unknown_error');
}
