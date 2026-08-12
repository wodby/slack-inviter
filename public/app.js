const turnstileScriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const config = window.SLACK_INVITER_CONFIG ?? {};
const form = document.querySelector('[data-invite-form]');
const emailInput = form.querySelector('input[name="email"]');
const message = form.querySelector('[data-invite-message]');
const submitButton = form.querySelector('[data-submit]');
const submitLabel = form.querySelector('[data-submit-label]');
const turnstileContainer = form.querySelector('[data-turnstile]');

let turnstileToken = '';
let widgetId;
let submitting = false;

function setMessage(text, state = '') {
  message.textContent = text;
  message.dataset.state = state;
}

function setPending(pending) {
  submitButton.disabled = pending;
  submitLabel.textContent = pending ? 'Sending invite…' : 'Get my invite';
}

function loadTurnstile() {
  if (window.turnstile) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = turnstileScriptUrl;
    script.async = true;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.head.append(script);
  });
}

async function prepareTurnstile() {
  if (!config.turnstileSiteKey) {
    submitButton.disabled = false;
    turnstileContainer.hidden = true;
    return;
  }

  try {
    await loadTurnstile();
    widgetId = window.turnstile.render(turnstileContainer, {
      action: 'invite',
      callback(token) {
        turnstileToken = token;
        setPending(false);
        setMessage('');
      },
      'error-callback'() {
        turnstileToken = '';
        submitButton.disabled = true;
        setMessage('Verification could not load. Please refresh and try again.', 'error');
      },
      'expired-callback'() {
        turnstileToken = '';
        submitButton.disabled = true;
        window.turnstile.reset(widgetId);
      },
      sitekey: config.turnstileSiteKey,
      size: 'flexible',
      theme: 'light',
    });
  } catch {
    setMessage('Verification could not load. Please refresh and try again.', 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');

  if (submitting) {
    return;
  }

  if (!emailInput.reportValidity()) {
    return;
  }

  if (config.turnstileSiteKey && !turnstileToken) {
    setMessage('Complete the verification and try again.', 'error');
    return;
  }

  submitting = true;
  setPending(true);

  try {
    const response = await fetch('/api/invitations', {
      body: JSON.stringify({
        email: emailInput.value,
        turnstileToken,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'The invitation could not be sent.');
    }

    form.dataset.state = 'success';
    emailInput.disabled = true;
    submitLabel.textContent = 'Invite requested';
    setMessage(result.message, 'success');

    if (result.redirectUrl) {
      window.setTimeout(() => window.location.assign(result.redirectUrl), 1200);
    }
  } catch (error) {
    submitting = false;
    setMessage(error.message || 'The invitation could not be sent.', 'error');

    if (config.turnstileSiteKey && widgetId !== undefined) {
      turnstileToken = '';
      window.turnstile.reset(widgetId);
    } else {
      setPending(false);
    }
  }
});

prepareTurnstile();
