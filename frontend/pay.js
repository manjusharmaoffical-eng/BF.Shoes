(() => {
  const status = document.getElementById('pay-status');
  const form = document.getElementById('pay-form');
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') || '';
  const allowedActions = new Set(['https://test.payu.in/_payment', 'https://secure.payu.in/_payment']);
  const fail = message => { if (status) status.textContent = message; };
  if (!/^[a-f0-9]{48}$/i.test(token)) {
    fail('This payment link is invalid. Return to BF SHOES and create a new checkout QR.');
    throw new Error('Invalid BF SHOES payment QR token');
  }
  window.history.replaceState(null, '', window.location.pathname);
  fetch('/api/v1/store/payments/payu/qr', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
  }).then(async response => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'This payment link has expired.');
    return payload?.data;
  }).then(checkout => {
    if (!checkout || checkout.method !== 'POST' || !allowedActions.has(checkout.action) || !checkout.fields || typeof checkout.fields !== 'object' || !checkout.fields.hash || !checkout.fields.txnid) {
      throw new Error('PayU did not return a valid secure checkout request.');
    }
    form.action = checkout.action;
    for (const [name, value] of Object.entries(checkout.fields)) {
      if (value === undefined || value === null) continue;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = String(value);
      form.append(input);
    }
    if (status) status.textContent = 'Secure checkout is ready. Redirecting to PayU…';
    form.submit();
  }).catch(error => {
    fail(error?.message || 'Unable to open the secure payment page. Return to BF SHOES and try again.');
  });
})();
