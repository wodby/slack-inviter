const sevenDaysInMilliseconds = 7 * 24 * 60 * 60 * 1000;

/**
 * Return the user-facing state for a Slack invitation expiry timestamp.
 */
export function getInviteState(expiresAt, now = Date.now()) {
  if (typeof expiresAt !== 'string' || expiresAt.length === 0) {
    return 'unavailable';
  }

  const expiry = Date.parse(expiresAt);

  if (!Number.isFinite(expiry)) {
    return 'unavailable';
  }

  if (now >= expiry) {
    return 'expired';
  }

  if (expiry - now <= sevenDaysInMilliseconds) {
    return 'expiring';
  }

  return 'active';
}
