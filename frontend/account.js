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
    const requestByOrder = new Map();
    requests.forEach(request => { const key = String(request.order_number); if (!requestByOrder.has(key)) requestByOrder.set(key, request); });
    if (!rows.length) { host.innerHTML = '<p class="account-muted">No orders are linked to this account yet.</p>'; return; }
    host.innerHTML = rows.map(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemText = items.map(item => [item.product_name, item.size ? 'Size ' + item.size : '', item.color, '×' + item.quantity].filter(Boolean).join(' · ')).join('<br>');
      const existing = requestByOrder.get(String(order.order_number));
      let returnSection = '';
      if (existing) {
        const history = (existing.history || []).map(event => '<li><strong>' + escapeHtml(event.status) + '</strong> · ' + escapeHtml(event.message || '') + ' <span class="account-muted">' + escapeHtml(new Date(event.created_at).toLocaleString()) + '</span></li>').join('');
        returnSection = '<div class="return-history"><strong>' + escapeHtml(existing.request_type) + ' request · ' + escapeHtml(existing.status) + '</strong><ul>' + (history || '<li>Request received and awaiting review.</li>') + '</ul></div>';
      } else if (order.status === 'delivered') {
        const itemRows = items.map(item => '<div class="return-item"><input type="checkbox" name="item" value="' + escapeHtml(item.id) + '" checked aria-label="Select ' + escapeHtml(item.product_name) + '"><span>' + escapeHtml(item.product_name) + ' · ' + escapeHtml(item.size) + ' / ' + escapeHtml(item.color) + ' · Purchased ' + escapeHtml(item.quantity) + '</span><input type="number" min="1" max="' + escapeHtml(item.quantity) + '" value="' + escapeHtml(item.quantity) + '" data-quantity="' + escapeHtml(item.id) + '" aria-label="Quantity for ' + escapeHtml(item.product_name) + '"><input type="text" maxlength="40" data-size="' + escapeHtml(item.id) + '" placeholder="New size (exchange)" aria-label="Requested size for ' + escapeHtml(item.product_name) + '"></div>').join('');
        returnSection = '<form class="return-request" data-return-form="' + escapeHtml(order.order_number) + '"><strong>Request a return or exchange</strong><label>Request type</label><select name="request_type"><option value="return">Return</option><option value="exchange">Exchange</option></select><label>Choose items and quantities</label>' + itemRows + '<label>Reason (minimum 10 characters)</label><textarea name="reason" rows="3" minlength="10" maxlength="1000" required placeholder="Tell us why you are requesting a return or exchange"></textarea><button type="submit">Submit request</button></form>';
      }
      return '<article class="order-card"><div class="order-head"><div><strong>Order #' + escapeHtml(order.order_number) + '</strong><div class="account-muted">' + escapeHtml(new Date(order.created_at).toLocaleString()) + '</div></div><div><strong>' + escapeHtml(order.status) + '</strong><div class="account-muted">Payment: ' + escapeHtml(order.payment_status) + '</div></div></div><div class="order-items">' + itemText + '</div><div class="order-total">' + money(order.total_cents, order.currency) + '</div>' + returnSection + '</article>';
    }).join('');
  }
  function renderReturnRequests(rows) {
    const host = $('#return-requests-list');
    if (!rows.length) { host.innerHTML = '<p class="account-muted">No return or exchange requests yet.</p>'; return; }
    host.innerHTML = rows.map(request => '<article class="return-history"><strong>Order #' + escapeHtml(request.order_number) + ' · ' + escapeHtml(request.request_type) + ' · ' + escapeHtml(request.status) + '</strong><p>' + escapeHtml(request.reason) + '</p><ul>' + (request.history || []).map(event => '<li><strong>' + escapeHtml(event.status) + '</strong> · ' + escapeHtml(event.message) + '</li>').join('') + '</ul></article>').join('');
  }
  async function loadAccount() {
    try {
      const me = await api('/me');
      $('#auth-panels').classList.add('hidden');
      $('#account-workspace').classList.remove('hidden');
      $('#customer-name').textContent = me.customer.name;
      $('#customer-email').textContent = me.customer.email;
      message('You are signed in.');
      const [orders, requests] = await Promise.all([api('/orders'), api('/returns/mine')]);
      renderOrders(orders.data || [], requests.data || []);
      renderReturnRequests(requests.data || []);
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
  $('#orders-list').addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-return-form]');
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const formData = new FormData(form);
      const requestType = String(formData.get('request_type') || 'return');
      const selected = Array.from(form.querySelectorAll('input[name="item"]:checked'));
      if (!selected.length) throw new Error('Select at least one order item.');
      const items = selected.map(input => {
        const id = input.value;
        const quantity = Number(form.querySelector('[data-quantity="' + CSS.escape(id) + '"]').value);
        const requested_size = form.querySelector('[data-size="' + CSS.escape(id) + '"]').value.trim();
        return { order_item_id: id, quantity, requested_size };
      });
      if (requestType === 'exchange' && items.some(item => !item.requested_size)) throw new Error('Enter the requested new size for each selected exchange item.');
      await api('/returns', { method: 'POST', body: JSON.stringify({ order_number: Number(form.dataset.returnForm), request_type: requestType, reason: String(formData.get('reason') || ''), items }) });
      message('Your request has been submitted. BF SHOES will review it; no refund, fee or stock change has been made.');
      await loadAccount();
    } catch (err) { message(err.message, true); submit.disabled = false; }
  });
  $('#signout-button').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    $('#account-workspace').classList.add('hidden');
    $('#auth-panels').classList.remove('hidden');
    message('You have signed out.');
  });
  if (token()) loadAccount();
})();
