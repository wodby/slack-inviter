import { randomUUID } from 'node:crypto';

const siteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export class TurnstileServiceError extends Error {}

/**
 * Validate a single-use Turnstile token with Cloudflare before inviting anyone.
 */
export async function verifyTurnstile({
  expectedAction = 'invite',
  expectedHostname = '',
  fetchImpl = globalThis.fetch,
  remoteIp = '',
  secretKey,
  token,
}) {
  if (!secretKey) {
    return { success: true, skipped: true };
  }

  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { success: false };
  }

  const body = new URLSearchParams({
    idempotency_key: randomUUID(),
    response: token,
    secret: secretKey,
  });

  if (remoteIp && remoteIp !== 'unknown') {
    body.set('remoteip', remoteIp);
  }

  try {
    const response = await fetchImpl(siteverifyUrl, {
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`Turnstile returned HTTP ${response.status}`);
    }

    const result = await response.json();
    const actionMatches = !expectedAction || result.action === expectedAction;
    const hostnameMatches = !expectedHostname || result.hostname === expectedHostname;

    return {
      success: result.success === true && actionMatches && hostnameMatches,
    };
  } catch (error) {
    throw new TurnstileServiceError('Turnstile verification is unavailable', { cause: error });
  }
}
