import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { RateLimiter } from './rate-limit.js';
import { inviteToSlack, SlackInviteError } from './slack.js';
import { TurnstileServiceError, verifyTurnstile } from './turnstile.js';

const maximumBodyBytes = 8 * 1024;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pageTemplate = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const staticFiles = new Map(
  [
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8', 'public, max-age=300'],
    ['/styles.css', 'styles.css', 'text/css; charset=utf-8', 'public, max-age=300'],
    ['/og.png', 'og.png', 'image/png', 'public, max-age=86400'],
    ['/robots.txt', 'robots.txt', 'text/plain; charset=utf-8', 'public, max-age=86400'],
    ['/assets/slack.svg', 'assets/slack.svg', 'image/svg+xml', 'public, max-age=86400'],
  ].map(([route, file, contentType, cacheControl]) => [
    route,
    {
      body: readFileSync(new URL(`../public/${file}`, import.meta.url)),
      cacheControl,
      contentType,
    },
  ]),
);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function contentSecurityPolicy(config) {
  const imageSources = ["'self'", 'data:'];

  if (config.community.logoUrl.startsWith('https://')) {
    imageSources.push(new URL(config.community.logoUrl).origin);
  }

  return [
    "base-uri 'none'",
    "connect-src 'self'",
    "default-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'frame-src https://challenges.cloudflare.com',
    `img-src ${imageSources.join(' ')}`,
    'script-src \'self\' https://challenges.cloudflare.com',
    "style-src 'self'",
  ].join('; ');
}

function communityMark(config, className = '') {
  const cssClass = className ? ` ${className}` : '';

  if (config.community.logoUrl) {
    return `<img class="community-logo${cssClass}" src="${escapeHtml(config.community.logoUrl)}" alt="">`;
  }

  const initial = Array.from(config.community.name)[0]?.toLocaleUpperCase() || 'C';
  return `<span class="community-monogram${cssClass}" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function brandElement(config) {
  const contents = `${communityMark(config, 'brand-mark')}<span>${escapeHtml(config.community.name)}</span>`;

  if (config.community.websiteUrl) {
    return `<a class="brand" href="${escapeHtml(config.community.websiteUrl)}" aria-label="${escapeHtml(config.community.name)} home">${contents}</a>`;
  }

  return `<span class="brand">${contents}</span>`;
}

function footerNav(config) {
  const links = [];

  if (config.community.supportUrl) {
    links.push(`<a href="${escapeHtml(config.community.supportUrl)}">Support</a>`);
  }

  if (config.community.privacyUrl) {
    links.push(`<a href="${escapeHtml(config.community.privacyUrl)}">Privacy</a>`);
  }

  if (links.length === 0) {
    return '';
  }

  return `<nav aria-label="Footer">${links.join('\n          ')}</nav>`;
}

function renderPage(config) {
  const pageTitle = `Join ${config.community.name} on Slack`;
  const replacements = {
    BRAND_ELEMENT: brandElement(config),
    COMMUNITY_DESCRIPTION: escapeHtml(config.community.description),
    COMMUNITY_HEADLINE: escapeHtml(config.community.headline),
    COMMUNITY_MARK: communityMark(config),
    COMMUNITY_NAME: escapeHtml(config.community.name),
    FOOTER_NAV: footerNav(config),
    PAGE_TITLE: escapeHtml(pageTitle),
    PUBLIC_URL: escapeHtml(config.publicUrl),
    SLACK_SIGN_IN_URL: escapeHtml(`https://${config.slack.team}.slack.com/`),
    SOCIAL_IMAGE_ALT: escapeHtml(`${pageTitle} — ${config.community.headline}`),
    SOCIAL_IMAGE_URL: escapeHtml(config.socialImageUrl),
  };

  return pageTemplate.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => replacements[name] ?? '');
}

function applySecurityHeaders(response, policy) {
  response.setHeader('content-security-policy', policy);
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  response.setHeader('cross-origin-resource-policy', 'same-origin');
  response.setHeader('permissions-policy', 'camera=(), geolocation=(), microphone=()');
  response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function sendJson(response, status, body, headers = {}) {
  send(response, status, JSON.stringify(body), {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
}

function clientIp(request, trustProxy) {
  if (trustProxy) {
    const forwardedFor = request.headers['x-forwarded-for'];

    if (typeof forwardedFor === 'string') {
      const firstAddress = forwardedFor.split(',', 1)[0].trim();

      if (firstAddress) {
        return firstAddress.slice(0, 128);
      }
    }
  }

  return request.socket.remoteAddress?.slice(0, 128) || 'unknown';
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const email = value.trim().toLowerCase();

  if (email.length > 254 || !emailPattern.test(email)) {
    return '';
  }

  return email;
}

function emailKey(email) {
  return createHash('sha256').update(email).digest('hex');
}

async function readJson(request) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();

  if (contentType !== 'application/json') {
    throw new HttpError(415, 'Send the request as JSON.');
  }

  const declaredLength = Number(request.headers['content-length'] || 0);

  if (declaredLength > maximumBodyBytes) {
    throw new HttpError(413, 'The request is too large.');
  }

  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    receivedBytes += chunk.length;

    if (receivedBytes > maximumBodyBytes) {
      throw new HttpError(413, 'The request is too large.');
    }

    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The request is not valid JSON.');
  }
}

function rateLimitResponse(response, result) {
  sendJson(
    response,
    429,
    { message: 'Too many invitation attempts. Please try again later.' },
    { 'retry-after': String(result.retryAfterSeconds) },
  );
}

function invitationResponse(response, status, slackTeam) {
  if (status === 'already_member') {
    sendJson(response, 200, {
      message: 'You already have access. Continue to Slack.',
      redirectUrl: `https://${slackTeam}.slack.com/`,
    });
    return;
  }

  if (status === 'already_invited') {
    sendJson(response, 200, {
      message: 'An invitation is already on its way. Check your inbox.',
    });
    return;
  }

  sendJson(response, 200, {
    message: 'Invite sent. Check your inbox to join the workspace.',
  });
}

/**
 * Create the HTTP request handler with injectable upstream calls for testing.
 */
export function createApp({ config, fetchImpl = globalThis.fetch, logger = console }) {
  const ipLimiter = new RateLimiter(config.rateLimit.ip);
  const emailLimiter = new RateLimiter(config.rateLimit.email);
  const policy = contentSecurityPolicy(config);
  const page = renderPage(config);

  return async function app(request, response) {
    applySecurityHeaders(response, policy);

    try {
      const url = new URL(request.url, 'http://localhost');

      if (request.method === 'GET' || request.method === 'HEAD') {
        if (url.pathname === '/' || url.pathname === '/index.html') {
          send(response, 200, request.method === 'HEAD' ? '' : page, {
            'cache-control': 'no-store',
            'content-type': 'text/html; charset=utf-8',
          });
          return;
        }

        if (url.pathname === '/healthz' || url.pathname === '/.healthz') {
          send(response, 200, request.method === 'HEAD' ? '' : 'ok\n', {
            'cache-control': 'no-store',
            'content-type': 'text/plain; charset=utf-8',
          });
          return;
        }

        if (url.pathname === '/config.js') {
          const clientConfig = JSON.stringify({
            turnstileSiteKey: config.turnstile.siteKey,
          }).replaceAll('<', '\\u003c');

          send(
            response,
            200,
            request.method === 'HEAD'
              ? ''
              : `window.SLACK_INVITER_CONFIG = Object.freeze(${clientConfig});\n`,
            {
              'cache-control': 'no-store',
              'content-type': 'text/javascript; charset=utf-8',
            },
          );
          return;
        }

        const file = staticFiles.get(url.pathname);

        if (file) {
          send(response, 200, request.method === 'HEAD' ? '' : file.body, {
            'cache-control': file.cacheControl,
            'content-type': file.contentType,
          });
          return;
        }
      }

      if (request.method !== 'POST' || url.pathname !== '/api/invitations') {
        sendJson(response, 404, { message: 'Not found.' });
        return;
      }

      const ip = clientIp(request, config.trustProxy);
      const ipLimit = ipLimiter.consume(ip);

      if (!ipLimit.allowed) {
        rateLimitResponse(response, ipLimit);
        return;
      }

      const body = await readJson(request);

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'The request must be a JSON object.');
      }

      const email = normalizeEmail(body.email);

      if (!email) {
        throw new HttpError(400, 'Enter a valid email address.');
      }

      const verification = await verifyTurnstile({
        expectedHostname: config.turnstile.expectedHostname,
        fetchImpl,
        remoteIp: ip,
        secretKey: config.turnstile.secretKey,
        token: body.turnstileToken,
      });

      if (!verification.success) {
        throw new HttpError(400, 'Complete the verification and try again.');
      }

      const emailLimit = emailLimiter.consume(emailKey(email));

      if (!emailLimit.allowed) {
        rateLimitResponse(response, emailLimit);
        return;
      }

      const result = await inviteToSlack({
        email,
        fetchImpl,
        team: config.slack.team,
        token: config.slack.token,
      });

      logger.info?.('Slack invitation request completed', { status: result.status });
      invitationResponse(response, result.status, config.slack.team);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { message: error.message });
        return;
      }

      if (error instanceof TurnstileServiceError) {
        logger.error?.('Turnstile verification failed', { cause: error.cause?.message });
        sendJson(response, 503, { message: 'Verification is temporarily unavailable.' });
        return;
      }

      if (error instanceof SlackInviteError) {
        logger.error?.('Slack invitation failed', { code: error.code });

        if (error.code === 'invalid_email') {
          sendJson(response, 400, { message: 'Enter a valid email address.' });
          return;
        }

        sendJson(response, 503, {
          message: 'Slack invitations are temporarily unavailable. Please try again later.',
        });
        return;
      }

      logger.error?.('Unexpected invitation error', { cause: error.message });
      sendJson(response, 500, { message: 'Something went wrong. Please try again.' });
    }
  };
}
