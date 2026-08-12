const slackTeamPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function required(env, name) {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function integer(env, name, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];

  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }

  return value;
}

function boolean(env, name, fallback) {
  const raw = env[name];

  if (raw === undefined || raw === '') {
    return fallback;
  }

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

/**
 * Load and validate all runtime configuration before the server starts.
 */
export function loadConfig(env = process.env) {
  const slackTeam = required(env, 'SLACK_TEAM');
  const slackToken = required(env, 'SLACK_TOKEN');
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim() ?? '';
  const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? '';
  const turnstileRequired = !['development', 'test'].includes(env.NODE_ENV);

  if (!slackTeamPattern.test(slackTeam)) {
    throw new Error('SLACK_TEAM must be a valid Slack workspace subdomain');
  }

  if ((turnstileSiteKey && !turnstileSecretKey) || (!turnstileSiteKey && turnstileSecretKey)) {
    throw new Error('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be configured together');
  }

  if (turnstileRequired && !turnstileSiteKey) {
    throw new Error('Turnstile credentials are required in production');
  }

  return Object.freeze({
    host: env.NODE_HOST?.trim() || '0.0.0.0',
    port: integer({ ...env, NODE_PORT: env.NODE_PORT || env.PORT }, 'NODE_PORT', 3000, {
      maximum: 65_535,
    }),
    slack: Object.freeze({
      team: slackTeam,
      token: slackToken,
    }),
    turnstile: Object.freeze({
      expectedHostname: env.TURNSTILE_EXPECTED_HOSTNAME?.trim() || '',
      required: turnstileRequired,
      secretKey: turnstileSecretKey,
      siteKey: turnstileSiteKey,
    }),
    trustProxy: boolean(env, 'TRUST_PROXY', Boolean(env.WODBY_APP_SERVICE_NAME)),
    rateLimit: Object.freeze({
      email: Object.freeze({
        maximum: integer(env, 'RATE_LIMIT_EMAIL_MAX', 3),
        windowMs: integer(env, 'RATE_LIMIT_EMAIL_WINDOW_SECONDS', 86_400) * 1000,
      }),
      ip: Object.freeze({
        maximum: integer(env, 'RATE_LIMIT_IP_MAX', 10),
        windowMs: integer(env, 'RATE_LIMIT_IP_WINDOW_SECONDS', 3_600) * 1000,
      }),
    }),
  });
}
