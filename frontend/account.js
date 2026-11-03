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
  function renderOrders(rows) {
    const host = $('#orders-list');
    if (!rows.length) { host.innerHTML = '<p class="account-muted">No orders are linked to this account yet.</p>'; return; }
    host.innerHTML = rows.map(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemText = items.map(item => [item.product_name, item.size ? 'Size ' + item.size : '', item.color, '×' + item.quantity].filter(Boolean).join(' · ')).join('<br>');
      return '<article class="order-card"><div class="order-head"><div><strong>Order #' + escapeHtml(order.order_number) + '</strong><div class="account-muted">' + escapeHtml(new Date(order.created_at).toLocaleString()) + '</div></div><div><strong>' + escapeHtml(order.status) + '</strong><div class="account-muted">Payment: ' + escapeHtml(order.payment_status) + '</div></div></div><div class="order-items">' + itemText + '</div><div class="order-total">' + money(order.total_cents, order.currency) + '</div></article>';
    }).join('');
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
      renderOrders(orders.data || []);
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
