import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { RateLimiter } from './rate-limit.js';
import { inviteToSlack, SlackInviteError } from './slack.js';
import { TurnstileServiceError, verifyTurnstile } from './turnstile.js';

const maximumBodyBytes = 8 * 1024;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const contentSecurityPolicy = [
  "base-uri 'none'",
  "connect-src 'self'",
  "default-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'frame-src https://challenges.cloudflare.com',
  "img-src 'self' data:",
  'script-src \'self\' https://challenges.cloudflare.com',
  "style-src 'self'",
].join('; ');

const staticFiles = new Map(
  [
    ['/', 'index.html', 'text/html; charset=utf-8', 'no-store'],
    ['/index.html', 'index.html', 'text/html; charset=utf-8', 'no-store'],
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8', 'public, max-age=300'],
    ['/styles.css', 'styles.css', 'text/css; charset=utf-8', 'public, max-age=300'],
    ['/og.png', 'og.png', 'image/png', 'public, max-age=86400'],
    ['/robots.txt', 'robots.txt', 'text/plain; charset=utf-8', 'public, max-age=86400'],
    ['/assets/slack.svg', 'assets/slack.svg', 'image/svg+xml', 'public, max-age=86400'],
    ['/assets/wodby.svg', 'assets/wodby.svg', 'image/svg+xml', 'public, max-age=86400'],
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

function applySecurityHeaders(response) {
  response.setHeader('content-security-policy', contentSecurityPolicy);
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

  return async function app(request, response) {
    applySecurityHeaders(response);

    try {
      const url = new URL(request.url, 'http://localhost');

      if (request.method === 'GET' || request.method === 'HEAD') {
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
