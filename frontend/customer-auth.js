(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const backdrop = $('#account-backdrop');
  const form = $('#account-form');
  const message = $('#account-message');
  const title = $('#account-title');
  const submit = $('#account-submit');
  const switcher = $('#account-switch');
  const nameField = $('#account-name-field');
  const nameInput = $('#account-name');
  const emailInput = $('#account-email');
  const passwordInput = $('#account-password');
  const accountButton = $('#account-link');
  let mode = 'signin';
  let customer = null;
  let token = null;

  function showMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle('is-error', error);
    message.classList.remove('hidden');
  }
  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    title.textContent = signup ? 'Create your account.' : 'Welcome back.';
    $('#account-intro').textContent = signup ? 'A better rotation starts here.' : 'Sign in to your BF SHOES account.';
    nameField.classList.toggle('hidden', !signup);
    nameInput.required = signup;
    passwordInput.autocomplete = signup ? 'new-password' : 'current-password';
    submit.textContent = signup ? 'Create account' : 'Sign in';
    switcher.textContent = signup ? 'Already have an account? Sign in' : 'New to BF SHOES? Create an account';
    message.classList.add('hidden');
  }
  function open() {
    backdrop.classList.add('visible');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('locked');
    if (customer) renderAccount();
    else setMode('signin');
    setTimeout(() => (customer ? $('#account-signout') : emailInput).focus(), 50);
  }
  function close() {
    backdrop.classList.remove('visible');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('locked');
  }
  function renderAccount() {
    title.textContent = 'Your account.';
    $('#account-intro').textContent = 'You’re signed in to BF SHOES.';
    form.classList.add('hidden');
    $('#account-profile').classList.remove('hidden');
    $('#account-profile-name').textContent = customer.name;
    $('#account-profile-email').textContent = customer.email;
    showMessage('Your customer account is ready.');
  }
  accountButton?.addEventListener('click', open);
  $('#account-close')?.addEventListener('click', close);
  backdrop?.addEventListener('click', event => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && backdrop.classList.contains('visible')) close(); });
  switcher?.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
  $('#account-signout')?.addEventListener('click', () => {
    customer = null; token = null;
    $('#account-profile').classList.add('hidden');
    form.classList.remove('hidden');
    setMode('signin');
    showMessage('You have signed out.');
    accountButton.setAttribute('aria-label', 'Sign in to your account');
  });
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
    message.classList.add('hidden');
    try {
      const payload = { email: emailInput.value.trim(), password: passwordInput.value };
      if (mode === 'signup') payload.name = nameInput.value.trim();
      const response = await fetch('/api/v1/customer-auth/' + (mode === 'signup' ? 'register' : 'login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not sign in. Please try again.');
      customer = data.customer;
      token = data.access_token;
      form.reset();
      renderAccount();
      accountButton.setAttribute('aria-label', 'Signed in customer account');
    } catch (err) {
      showMessage(err.message || 'Something went wrong. Please try again.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    }
  });
  setMode('signin');
})();
