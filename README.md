# Slack Inviter

A small, customizable invitation page for public Slack communities. It accepts
an email address, optionally verifies the visitor with Cloudflare Turnstile,
applies local request limits, and asks Slack to send the invitation. Slack
credentials stay entirely on the server.

The page ships with neutral community copy. Names, descriptions, links, logos,
and social metadata are supplied through runtime variables, so deployments do
not need to fork or edit the source.

## Important Slack compatibility note

This project calls the undocumented `users.admin.invite` endpoint used by
[Slackin Extended](https://github.com/emedvedev/slackin-extended). It requires
an existing legacy administrator API token from a working Slackin installation.

Slack stopped issuing new legacy test tokens in 2020 and may remove this
endpoint at any time. A newly created Slack app token will not make this method
supported. Slack's documented [`admin.users.invite`](https://docs.slack.dev/reference/methods/admin.users.invite/)
method is available only to Enterprise Grid organizations.

Use this project only when migrating a working Slackin installation whose
legacy admin token is still active. If you do not already have that token, the
supported alternatives are a 30-day shared invitation link or Enterprise Grid.

## Runtime configuration

### Community page

| Variable | Required | Description |
| --- | --- | --- |
| `PUBLIC_URL` | Production | Public origin, such as `https://community.example.com`. |
| `COMMUNITY_NAME` | No | Community name; defaults to `Slack Community`. |
| `COMMUNITY_HEADLINE` | No | Main page headline. |
| `COMMUNITY_DESCRIPTION` | No | Intro copy and metadata description. |
| `COMMUNITY_WEBSITE_URL` | No | Website linked from the page header. |
| `COMMUNITY_LOGO_URL` | No | HTTPS or root-relative logo URL. A generated initial is used when omitted. |
| `COMMUNITY_SUPPORT_URL` | No | Adds a Support link to the footer. |
| `COMMUNITY_PRIVACY_URL` | No | Adds a Privacy link to the footer. |
| `SOCIAL_IMAGE_URL` | No | HTTPS or root-relative social image; defaults to `/og.png`. |

### Slack and abuse protection

| Variable | Required | Description |
| --- | --- | --- |
| `SLACK_TEAM` | Yes | Workspace subdomain, such as `example` for `example.slack.com`. |
| `SLACK_TOKEN` | Yes, secret | Existing legacy administrator API token from the working Slackin deployment. Slack no longer issues these tokens. |
| `TURNSTILE_SITE_KEY` | No | Public Cloudflare Turnstile widget key. Configure it with the secret key to enable verification. |
| `TURNSTILE_SECRET_KEY` | No, secret | Server-side Turnstile validation key. Configure it with the site key. |
| `TURNSTILE_EXPECTED_HOSTNAME` | Recommended with Turnstile | Siteverify must return this exact public hostname. |
| `NODE_PORT` | No | HTTP port; defaults to `3000`. `PORT` is also accepted. |
| `NODE_HOST` | No | Listen address; defaults to `0.0.0.0`. |
| `TRUST_PROXY` | No | Trust the first `X-Forwarded-For` address; defaults to `false`. |
| `RATE_LIMIT_IP_MAX` | No | Requests per IP window; defaults to `10`. |
| `RATE_LIMIT_IP_WINDOW_SECONDS` | No | IP window; defaults to one hour. |
| `RATE_LIMIT_EMAIL_MAX` | No | Verified requests per email window; defaults to `3`. |
| `RATE_LIMIT_EMAIL_WINDOW_SECONDS` | No | Email window; defaults to one day. |

The application refuses to start without `PUBLIC_URL` unless `NODE_ENV` is
explicitly `development` or `test`. Turnstile is disabled when both keys are
omitted, while configuring only one key is rejected. Only the Turnstile site
key is sent to browsers. The Slack token and Turnstile secret must be stored as
secret runtime variables.

For recommended abuse protection, create a free Managed Turnstile widget,
allow the production hostname, and copy its site and secret keys into the
variables above. See the
[Turnstile setup guide](https://developers.cloudflare.com/turnstile/get-started/).

## Local development

Node.js 22 or newer is required. There are no application dependencies.

```sh
cp .env.example .env
npm ci
npm run dev
```

The example file uses Cloudflare's always-pass test keys. Replace the Slack
values with a non-production test workspace before submitting the form. Run
all offline checks with:

```sh
npm run check
```

## Deployment

The Dockerfile defaults to the official Node.js image:

```sh
docker build -t slack-inviter .
docker run --rm --env-file .env -p 3000:3000 slack-inviter
```

The included `.wodby/pipeline.yml` provides a native Wodby CI workflow for the
[Slack Inviter stack](https://github.com/wodby/stack-slack-inviter). Start from
that stack and boilerplate, attach the required Slack legacy API token
integration and, optionally, a Cloudflare integration with its Turnstile kind
selected. Set the workspace and community settings, and verify `/.healthz`
before switching traffic. The stack intentionally keeps one replica and the
service enables trusted proxy handling for the Wodby route gateway.

The built-in rate limiter is intentionally local to one process. A
multi-replica deployment should replace it with a shared limiter at the gateway
or in a datastore.

## Security and privacy

- Submitted email addresses are forwarded to Slack and are never persisted or
  logged by this application.
- The rate limiter stores only a SHA-256 digest of each normalized email in
  process memory.
- Turnstile tokens are validated server-side and are single-use.
- JSON-only form submission and same-origin browser policy reduce cross-site
  request abuse.
- Runtime text and links are validated and safely escaped before rendering.
- Security headers are applied to every response.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

Slack is a trademark of Salesforce, Inc. This project is not affiliated with
or endorsed by Slack or Salesforce.

## License

MIT
