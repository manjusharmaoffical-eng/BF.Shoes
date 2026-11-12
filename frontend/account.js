(() => {
  'use strict';
  const TOKEN_KEY = 'bf_customer_token';
  const $ = (s) => document.querySelector(s);
  const status = $('#account-status');
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (cents, currency) => {
    const amount = (Number(cents || 0) / 100).toFixed(2);
    return (currency === 'AED' ? 'AED ' : '₹') + amount;
  };
  const token = () => sessionStorage.getItem(TOKEN_KEY) || '';
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
    status.classList.remove('hidden');
  }
  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token()) headers.Authorization = 'Bearer ' + token();
    const response = await fetch('/api/v1/customer-auth' + path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }
  function setBusy(form, busy) {
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = busy; button.textContent = busy ? 'Please wait…' : (form.id === 'login-form' ? 'Sign in' : 'Create account'); }
  }
  function renderOrders(rows, requests = []) {
    const host = $('#orders-list');
    if (!rows.length) { host.innerHTML = '<p class="account-muted">No orders are linked to this account yet.</p>'; return; }
    host.innerHTML = rows.map(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemText = items.map(item => [item.product_name, item.size ? 'Size ' + item.size : '', item.color, '×' + item.quantity].filter(Boolean).join(' · ')).join('<br>');
      const related = requests.filter(r => String(r.order_number) === String(order.order_number));
      const active = related.find(r => !['rejected','closed'].includes(r.status));
      let returnPanel = '';
      if (order.currency === 'INR' && order.status === 'delivered') {
        const history = related.map(r => '<li><strong>' + escapeHtml(r.request_type) + ': ' + escapeHtml(r.status) + '</strong>' + (r.review_note ? '<div class="account-muted">' + escapeHtml(r.review_note) + '</div>' : '') + '</li>').join('');
        if (active) {
          returnPanel = '<div class="return-panel"><strong>Return / exchange request: ' + escapeHtml(active.status) + '</strong>' + (active.review_note ? '<p class="account-muted">' + escapeHtml(active.review_note) + '</p>' : '<p class="account-muted">Your request is awaiting review. No refund or return fee has been charged.</p>') + (history ? '<ul>' + history + '</ul>' : '') + '</div>';
        } else {
          returnPanel = '<div class="return-panel"><h3>Request a return or exchange</h3>' + (history ? '<ul>' + history + '</ul>' : '') + '<form class="return-form" data-return-order="' + escapeHtml(order.order_number) + '"><label>Request type<select name="request_type" required><option value="return">Return</option><option value="exchange">Exchange</option></select></label><label>Reason<input name="reason" required minlength="2" maxlength="120" placeholder="Tell us why you need a return or exchange"></label><label>Details (optional)<textarea name="details" rows="2" maxlength="1000" placeholder="Add any useful details"></textarea></label><button type="submit">Submit request for review</button></form><p class="account-muted">Submitting a request does not guarantee approval. No refund or return fee is processed automatically.</p></div>';
        }
      } else if (order.currency !== 'INR') {
        returnPanel = '<p class="account-muted">Return / exchange requests are currently available for India orders only.</p>';
      } else if (order.status !== 'delivered') {
        returnPanel = '<p class="account-muted">You can submit a return or exchange request after this order is delivered.</p>';
      }
      return '<article class="order-card"><div class="order-head"><div><strong>Order #' + escapeHtml(order.order_number) + '</strong><div class="account-muted">' + escapeHtml(new Date(order.created_at).toLocaleString()) + '</div></div><div><strong>' + escapeHtml(order.status) + '</strong><div class="account-muted">Payment: ' + escapeHtml(order.payment_status) + '</div></div></div><div class="order-items">' + itemText + '</div><div class="order-total">' + money(order.total_cents, order.currency) + '</div>' + returnPanel + '</article>';
    }).join('');
    document.querySelectorAll('[data-return-order]').forEach(form => form.addEventListener('submit', async event => {
      event.preventDefault();
      const current = event.currentTarget;
      const button = current.querySelector('button[type="submit"]');
      button.disabled = true;
      const values = new FormData(current);
      try {
        await api('/returns', { method: 'POST', body: JSON.stringify({
          order_number: current.dataset.returnOrder,
          request_type: values.get('request_type'),
          reason: values.get('reason'),
          details: values.get('details') || ''
        }) });
        message('Your request was submitted for BF SHOES review. No refund or return fee has been charged.');
        await loadAccount();
      } catch (err) {
        message(err.message, true);
        button.disabled = false;
      }
    }));
  }
  async function loadAccount() {
    try {
      const me = await api('/me');
      $('#auth-panels').classList.add('hidden');
      $('#account-workspace').classList.remove('hidden');
      $('#customer-name').textContent = me.customer.name;
      $('#customer-email').textContent = me.customer.email;
      message('You are signed in.');
      const orders = await api('/orders');
      let requests = [];
      try {
        const returns = await api('/returns');
        requests = returns.data || [];
      } catch (err) {
        message('Order history loaded. Return requests are temporarily unavailable: ' + err.message, true);
      }
      renderOrders(orders.data || [], requests);
    } catch (err) {
      sessionStorage.removeItem(TOKEN_KEY);
      $('#auth-panels').classList.remove('hidden');
      $('#account-workspace').classList.add('hidden');
      message(err.message || 'Please sign in to continue.', true);
    }
  }
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; setBusy(form, true);
    try {
      const data = await api('/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      sessionStorage.setItem(TOKEN_KEY, data.access_token);
      form.reset(); await loadAccount();
    } catch (err) { message(err.message, true); }
    finally { setBusy(form, false); }
  });
  $('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; setBusy(form, true);
    try {
      const data = await api('/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      sessionStorage.setItem(TOKEN_KEY, data.access_token);
      form.reset(); await loadAccount();
    } catch (err) { message(err.message, true); }
    finally { setBusy(form, false); }
  });
  $('#signout-button').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    $('#account-workspace').classList.add('hidden');
    $('#auth-panels').classList.remove('hidden');
    message('You have signed out.');
  });
  if (token()) loadAccount();
})();
