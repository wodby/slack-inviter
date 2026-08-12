#!/usr/bin/env bash

set -eu

invite_url=${SLACK_INVITE_URL:-}
invite_expires_at=${SLACK_INVITE_EXPIRES_AT:-}

if ! printf '%s' "$invite_url" | grep -Eq '^https://join\.slack\.com/t/[A-Za-z0-9_-]+/shared_invite/[A-Za-z0-9_-]+$'; then
  echo >&2 'SLACK_INVITE_URL must be a Slack shared invitation URL.'
  exit 1
fi

if ! printf '%s' "$invite_expires_at" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
  echo >&2 'SLACK_INVITE_EXPIRES_AT must be a UTC timestamp such as 2026-09-11T23:59:59Z.'
  exit 1
fi

umask 022
gotpl /etc/gotpl/slack-config.js.tmpl > /var/www/html/config.js
