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

function text(env, name, fallback, maximumLength) {
  const value = env[name]?.trim() || fallback;

  if (value.length > maximumLength) {
    throw new Error(`${name} must not exceed ${maximumLength} characters`);
  }

  return value;
}

function absoluteUrl(env, name, { fallback = '', originOnly = false, required = false } = {}) {
  const value = env[name]?.trim() || fallback;

  if (!value) {
    if (required) {
      throw new Error(`${name} is required`);
    }

    return '';
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`);
  }

  if (originOnly && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
    throw new Error(`${name} must contain only a URL origin`);
  }

  return originOnly ? parsed.origin : parsed.href;
}

function imageUrl(env, name) {
  const value = env[name]?.trim() || '';

  if (!value) {
    return '';
  }

  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }

  const parsed = absoluteUrl(env, name);

  if (!parsed.startsWith('https://')) {
    throw new Error(`${name} must use HTTPS or be a root-relative path`);
  }

  return parsed;
}

/**
 * Load and validate all runtime configuration before the server starts.
 */
export function loadConfig(env = process.env) {
  const slackTeam = required(env, 'SLACK_TEAM');
  const slackToken = required(env, 'SLACK_TOKEN');
  const port = integer({ ...env, NODE_PORT: env.NODE_PORT || env.PORT }, 'NODE_PORT', 3000, {
    maximum: 65_535,
  });
  const isDevelopment = ['development', 'test'].includes(env.NODE_ENV);
  const publicUrl = absoluteUrl(env, 'PUBLIC_URL', {
    fallback: isDevelopment ? `http://localhost:${port}` : '',
    originOnly: true,
    required: !isDevelopment,
  });
  const configuredSocialImageUrl = imageUrl(env, 'SOCIAL_IMAGE_URL');
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim() ?? '';
  const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? '';
  const turnstileRequired = !isDevelopment;

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
    port,
    community: Object.freeze({
      description: text(
        env,
        'COMMUNITY_DESCRIPTION',
        'Join the community to ask questions, exchange ideas, and connect with people on Slack.',
        300,
      ),
      headline: text(
        env,
        'COMMUNITY_HEADLINE',
        'Meet, share, and solve it together.',
        160,
      ),
      logoUrl: imageUrl(env, 'COMMUNITY_LOGO_URL'),
      name: text(env, 'COMMUNITY_NAME', 'Slack Community', 80),
      privacyUrl: absoluteUrl(env, 'COMMUNITY_PRIVACY_URL'),
      supportUrl: absoluteUrl(env, 'COMMUNITY_SUPPORT_URL'),
      websiteUrl: absoluteUrl(env, 'COMMUNITY_WEBSITE_URL'),
    }),
    publicUrl,
    socialImageUrl: new URL(configuredSocialImageUrl || '/og.png', publicUrl).href,
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
    trustProxy: boolean(env, 'TRUST_PROXY', false),
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
