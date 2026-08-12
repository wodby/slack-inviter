import { getInviteState } from './invite-state.js';

const joinLink = document.querySelector('[data-join-link]');
const inviteMessage = document.querySelector('[data-invite-message]');
const config = window.WODBY_SLACK_CONFIG ?? {};
const state = getInviteState(config.inviteExpiresAt);

document.documentElement.dataset.inviteState = state;

if (state === 'expired' || state === 'unavailable') {
  joinLink.removeAttribute('href');
  joinLink.setAttribute('aria-disabled', 'true');
  joinLink.querySelector('[data-join-label]').textContent =
    'Invite link is being renewed';

  inviteMessage.hidden = false;
  inviteMessage.textContent =
    state === 'expired'
      ? 'The current invite has expired. We are refreshing it—please check back soon.'
      : 'Invitations are temporarily unavailable. Please check back soon.';
}
