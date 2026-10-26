(() => {
  'use strict';
  const API_BASE = (window.BF_SHOES_CONFIG && window.BF_SHOES_CONFIG.API_BASE_URL) || '/api/v1/store';
  const FALLBACK_IMAGES = [
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1495555961986-6d4c1ecb7be3?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=900&q=80'
  ];
  const state = { products: [], cart: [], selectedSizes: {}, filter: 'all', search: '', categories: [], colors: [], sort: 'featured', wishlist: new Set(), loading: true, busy: false, pendingCheckout: null };
  try { state.wishlist = new Set(JSON.parse(localStorage.getItem('bf-shoes-wishlist') || '[]').map(String)); } catch { state.wishlist = new Set(); }
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = (cents, currency = 'INR') => `₹${(Number(cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;\n  const DELIVERY_FEE_PAISE = 5000;\n  const checkoutTotalCents = () => totalCents() + (state.cart.length ? DELIVERY_FEE_PAISE : 0);
  const productImage = product => {
    const candidate = typeof product.image_url === 'string' && product.image_url.startsWith('https://') ? product.image_url : '';
    return candidate || FALLBACK_IMAGES[Math.abs(hashCode(product.slug || product.name || 'bf')) % FALLBACK_IMAGES.length];
  };
  function hashCode(value) { let hash = 0; for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0; return hash; }
  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600); }
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The product service took too long to respond. Please refresh in a moment.');
      throw new Error('Could not connect to the BF SHOES product service. Please try again shortly.');
    } finally { clearTimeout(timeout); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'Something went wrong. Please try again.'); error.status = response.status; throw error; }
    return data;
  }
  function totalItems() { return state.cart.reduce((sum, item) => sum + item.quantity, 0); }
  function totalCents() { return state.cart.reduce((sum, item) => sum + Number(item.product.price_cents) * item.quantity, 0); }
  function availableVariants(product) { return (product.variants || []).filter(v => Number(v.stock_qty) > 0); }
  function renderProducts() {
    const grid = $('#product-grid');
    let products = state.products.filter(product => { const inStock = availableVariants(product).length > 0; const query = state.search.trim().toLowerCase(); const matchesSearch = !query || [product.name, product.brand, product.description, product.slug].some(value => String(value || '').toLowerCase().includes(query)); const category=String(product.category || product.category_name || '').toLowerCase(); const matchesCategory=!state.categories.length || state.categories.some(value=>category.includes(value)); const productColors=(product.variants||[]).map(v=>String(v.color_name||'').toLowerCase()); const matchesColor=!state.colors.length || state.colors.some(value=>productColors.some(color=>color.includes(value))); return (state.filter !== 'available' || inStock) && (state.filter !== 'saved' || state.wishlist.has(String(product.id))) && matchesSearch && matchesCategory && matchesColor; });
    if (state.sort === 'price-low') products.sort((a,b) => Number(a.price_cents)-Number(b.price_cents)); else if (state.sort === 'price-high') products.sort((a,b) => Number(b.price_cents)-Number(a.price_cents)); else if (state.sort === 'name') products.sort((a,b) => String(a.name).localeCompare(String(b.name)));
    $('#catalog-status').textContent = state.loading ? 'Finding your next pair…' : state.products.length ? `${products.length} ${products.length === 1 ? 'style' : 'styles'} shown` : 'The catalog is connected, but no active products have been added yet.';
    const countLabel = $('#catalog-count'); if (countLabel) countLabel.textContent = state.loading ? 'Loading products…' : `Showing ${products.length} of ${state.products.length} products`;
    const wishlistCount = $('#wishlist-count'); if (wishlistCount) wishlistCount.textContent = String(state.wishlist.size);
    $('#empty-state').classList.toggle('hidden', state.loading || products.length > 0);
    if (state.loading) { grid.innerHTML = ''; return; }
    if (!products.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = products.map((product, index) => {
      const variants = product.variants || [];
      const available = availableVariants(product);
      const selected = state.selectedSizes[product.id] || (available[0] && available[0].sku) || '';
      const selectedVariant = variants.find(v => v.sku === selected && Number(v.stock_qty) > 0);
      const sizes = variants.map(v => `<button class="size-option ${v.sku === selected ? 'selected' : ''}" type="button" data-size-product="${escapeHtml(product.id)}" data-sku="${escapeHtml(v.sku)}" aria-pressed="${v.sku === selected}" ${Number(v.stock_qty) <= 0 ? 'disabled title="Out of stock"' : ''}>${escapeHtml(v.size_label)}</button>`).join('');
      const status = !available.length ? 'Sold out' : (available.length <= 2 ? 'Limited run' : 'Everyday essential');
      return `<article class="product-card" data-product="${escapeHtml(product.id)}">
        <div class="product-image"><img src="${escapeHtml(productImage(product))}" alt="${escapeHtml(product.name)} sneaker" loading="${index < 3 ? 'eager' : 'lazy'}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGES[index % FALLBACK_IMAGES.length]}'" /><span class="product-tag">${status}</span><button class="wishlist-toggle ${state.wishlist.has(String(product.id)) ? 'saved' : ''}" type="button" data-wishlist="${escapeHtml(product.id)}" aria-label="${state.wishlist.has(String(product.id)) ? 'Remove from wishlist' : 'Save to wishlist'}" aria-pressed="${state.wishlist.has(String(product.id))}">${state.wishlist.has(String(product.id)) ? '♥' : '♡'}</button><button class="quick-add" type="button" data-quick-add="${escapeHtml(product.id)}" aria-label="Quick add ${escapeHtml(product.name)}" ${!available.length ? 'disabled' : ''}>+</button></div>
        <div class="product-info"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.brand || 'BF SHOES')} · ${escapeHtml(product.short_description || product.description || 'Everyday sneaker').slice(0, 58)}</p></div><strong class="product-price">${money(product.price_cents, product.currency)}</strong></div>
        <div class="product-sizes" aria-label="Choose size for ${escapeHtml(product.name)}">${sizes || '<span class="product-info"><p>No sizes listed</p></span>'}</div>
        <div class="add-row"><button class="button button-dark" type="button" data-add="${escapeHtml(product.id)}" ${!selectedVariant ? 'disabled' : ''}>${selectedVariant ? 'Add to bag' : 'Out of stock'} <span>+</span></button></div>
      </article>`;
    }).join('');
  }
  function renderCart() {
    const count = totalItems();
    $('#cart-count').textContent = String(count);
    $('#drawer-count').textContent = `(${count})`;
    $('#cart-empty').classList.toggle('hidden', count > 0);
    $('#drawer-foot').classList.toggle('hidden', count === 0);
    $('#cart-items').classList.toggle('hidden', count === 0);
    $('#cart-subtotal').textContent = money(totalCents(), 'INR'); const delivery=$('#cart-delivery-fee'); if(delivery) delivery.textContent=money(state.cart.length ? DELIVERY_FEE_PAISE : 0,'INR');
    $('#checkout-total').textContent = money(checkoutTotalCents(), 'INR');
    $('#cart-items').innerHTML = state.cart.map(item => `<div class="cart-line"><img src="${escapeHtml(productImage(item.product))}" alt="" /><div><h3>${escapeHtml(item.product.name)}</h3><p>Size ${escapeHtml(item.variant.size_label)} · ${escapeHtml(item.variant.color_name || 'Classic')}</p><div class="qty-control"><button type="button" data-qty="-1" data-sku="${escapeHtml(item.variant.sku)}" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-qty="1" data-sku="${escapeHtml(item.variant.sku)}" aria-label="Increase quantity" ${item.quantity >= 10 ? 'disabled' : ''}>+</button></div></div><strong class="cart-line-price">${money(Number(item.product.price_cents) * item.quantity, item.product.currency)}</strong></div>`).join('');
  }
  function addToCart(product, variant) {
    if (!variant || Number(variant.stock_qty) <= 0) return toast('That size is out of stock.');
    const current = state.cart.find(item => item.variant.sku === variant.sku);
    const already = current?.quantity || 0;
    if (already >= Math.min(10, Number(variant.stock_qty))) return toast('Maximum available quantity reached.');
    if (current) current.quantity += 1; else state.cart.push({ product, variant, quantity: 1 });
    renderCart(); toast(`${product.name} · size ${variant.size_label} added to your bag.`);
  }
  function setDrawer(open) {
    $('#cart-drawer').classList.toggle('open', open); $('#cart-drawer').setAttribute('aria-hidden', String(!open)); $('#scrim').classList.toggle('visible', open); document.body.classList.toggle('locked', open || $('#checkout-backdrop').classList.contains('visible') || $('#success-backdrop').classList.contains('visible'));
  }
  function setCheckout(open) {
    $('#checkout-backdrop').classList.toggle('visible', open); $('#checkout-backdrop').setAttribute('aria-hidden', String(!open)); document.body.classList.toggle('locked', open || $('#cart-drawer').classList.contains('open') || $('#success-backdrop').classList.contains('visible'));
    if (open) { $('#checkout-error').classList.add('hidden'); $('#checkout-total').textContent = money(checkoutTotalCents(), 'INR'); setTimeout(() => $('input[name="customer_name"]')?.focus(), 80); }
  }
  function setSuccess(open, order = null) {
    $('#success-backdrop').classList.toggle('visible', open); $('#success-backdrop').setAttribute('aria-hidden', String(!open));
    if (order) $('#success-order-number').textContent = order.order_number ? `BF-${String(order.order_number).padStart(6, '0')}` : 'Confirmed';
    document.body.classList.toggle('locked', open);
  }
  function showCheckoutError(message) { $('#checkout-error').textContent = message; $('#checkout-error').classList.remove('hidden'); }

  $('#product-grid').addEventListener('click', event => {
    const wishlistButton = event.target.closest('[data-wishlist]');
    if (wishlistButton) { const id = String(wishlistButton.dataset.wishlist); if (state.wishlist.has(id)) state.wishlist.delete(id); else state.wishlist.add(id); try { localStorage.setItem('bf-shoes-wishlist', JSON.stringify([...state.wishlist])); } catch {} renderProducts(); return; }
    const sizeButton = event.target.closest('[data-size-product]');
    if (sizeButton) { state.selectedSizes[sizeButton.dataset.sizeProduct] = sizeButton.dataset.sku; renderProducts(); return; }
    const addButton = event.target.closest('[data-add]');
    const quickButton = event.target.closest('[data-quick-add]');
    if (addButton || quickButton) {
      const id = (addButton || quickButton).dataset[addButton ? 'add' : 'quickAdd'];
      const product = state.products.find(p => String(p.id) === String(id)); if (!product) return;
      const variants = availableVariants(product);
      const selectedSku = state.selectedSizes[product.id];
      const variant = variants.find(v => v.sku === selectedSku) || variants[0];
      if (!variant) return toast('This style is currently sold out.');
      state.selectedSizes[product.id] = variant.sku;
      addToCart(product, variant); renderProducts();
    }
  });
  $('#product-grid').addEventListener('error', () => {}, true);
  $('#cart-items').addEventListener('click', event => {
    const button = event.target.closest('[data-qty]'); if (!button) return;
    const item = state.cart.find(row => row.variant.sku === button.dataset.sku); if (!item) return;
    const next = item.quantity + Number(button.dataset.qty); const stock = Number(item.variant.stock_qty);
    if (next <= 0) state.cart = state.cart.filter(row => row !== item);
    else if (next <= Math.min(10, stock)) item.quantity = next;
    else toast('Maximum available quantity reached.');
    renderCart();
  });
  $('#open-cart').addEventListener('click', () => setDrawer(true));
  $('#close-cart').addEventListener('click', () => setDrawer(false));
  $('#scrim').addEventListener('click', () => setDrawer(false));
  $('#continue-shopping').addEventListener('click', () => setDrawer(false));
  $('#checkout-button').addEventListener('click', () => { if (!state.cart.length) return; setDrawer(false); setCheckout(true); });
  $('#close-checkout').addEventListener('click', () => setCheckout(false));
  $('#checkout-backdrop').addEventListener('click', event => { if (event.target === $('#checkout-backdrop')) setCheckout(false); });
  $('#finish-order').addEventListener('click', () => { setSuccess(false); state.cart = []; renderCart(); renderProducts(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#success-backdrop').addEventListener('click', event => { if (event.target === $('#success-backdrop')) setSuccess(false); });
  $$('.filter').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; $$('.filter').forEach(b => b.classList.toggle('active', b === button)); renderProducts(); }));
  $('#product-search').addEventListener('input', event => { state.search = event.target.value; const headerSearch=$('#header-product-search'); if(headerSearch) headerSearch.value=event.target.value; renderProducts(); });
  $('#header-product-search')?.addEventListener('input', event => { $('#product-search').value=event.target.value; state.search=event.target.value; renderProducts(); if(event.target.value) $('#shop').scrollIntoView({behavior:'smooth',block:'start'}); });
  $('#header-wishlist')?.addEventListener('click', () => { state.filter='saved'; $$('.filter').forEach(b=>b.classList.toggle('active',b.dataset.filter==='saved')); renderProducts(); $('#shop').scrollIntoView({behavior:'smooth',block:'start'}); });
  $('#account-link')?.addEventListener('click', () => toast('Account support is coming soon. You can shop and check out as a guest.'));
  $('#price-range')?.addEventListener('input', event => { $('#price-range-value').textContent=`₹${Number(event.target.value).toLocaleString('en-IN')}`; });
  $$('.catalog-sidebar [data-category]').forEach(input => input.addEventListener('change', () => { state.categories=$$('.catalog-sidebar [data-category]:checked').map(x=>x.dataset.category.toLowerCase()); renderProducts(); }));
  $$('.catalog-sidebar [data-color]').forEach(input => input.addEventListener('change', () => { state.colors=$$('.catalog-sidebar [data-color]:checked').map(x=>x.dataset.color.toLowerCase()); renderProducts(); }));
  $$('.view-mode').forEach(button=>button.addEventListener('click',()=>{$$('.view-mode').forEach(b=>b.classList.toggle('active',b===button));$('#product-grid').classList.toggle('list-view',button.textContent.trim()==='☷');}));
  $('#product-sort').addEventListener('change', event => { state.sort = event.target.value; renderProducts(); });

  // Keep the catalog filter controls in a slide-out panel on smaller screens.
  const catalogLayout = $('.catalog-layout');
  const mobileFilterTrigger = $('#mobile-filter-trigger');
  const closeMobileFilters = $('#close-mobile-filters');
  function setMobileFilters(open) {
    if (!catalogLayout || !mobileFilterTrigger) return;
    catalogLayout.classList.toggle('filters-open', open);
    mobileFilterTrigger.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('filters-locked', open);
  }
  mobileFilterTrigger?.addEventListener('click', () => setMobileFilters(!catalogLayout.classList.contains('filters-open')));
  closeMobileFilters?.addEventListener('click', () => setMobileFilters(false));
  catalogLayout?.addEventListener('click', event => {
    if (catalogLayout.classList.contains('filters-open') && event.target === catalogLayout) setMobileFilters(false);
  });
  $('.catalog-sidebar input').forEach(input => input.addEventListener('change', () => {
    if (window.matchMedia('(max-width: 1024px)').matches && input.type === 'checkbox') setMobileFilters(false);
  }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setMobileFilters(false); });

  const countrySelect = $('#shipping-country');
  if (countrySelect) {
    countrySelect.addEventListener('change', () => {
      $('input[name="customer_phone"]').placeholder = '+971 50 000 0000';
    });
  }
  $('#newsletter-form').addEventListener('submit', async event => { event.preventDefault(); const form=event.currentTarget, button=form.querySelector('button[type=submit],button:not([type])'); if(button)button.disabled=true; $('#newsletter-message').textContent='Submitting…'; try { const email=String(new FormData(form).get('email')||'').trim(); const result=await request('/api/v1/newsletter/subscribe',{method:'POST',body:JSON.stringify({email})}); $('#newsletter-message').textContent=result.message+(result.email_status==='sent'?' Email confirmation sent.': ' Your signup is saved; email delivery may need configuration.'); form.reset(); } catch(error) { $('#newsletter-message').textContent=error.message||'Signup failed. Please try again.'; } finally { if(button)button.disabled=false; } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { setCheckout(false); setSuccess(false); setDrawer(false); } });

  $('#shipping-country')?.addEventListener('change', event => {
    const isIndia = event.target.value === 'IN';
    $('#india-pin-field')?.classList.toggle('hidden', !isIndia);
    const pin = $('#shipping-pincode');
    if (pin) { pin.required = isIndia; if (!isIndia) pin.value = ''; }
    const phone = $('input[name="customer_phone"]');
    if (phone) phone.placeholder = isIndia ? '+91 98765 43210' : '+971 50 000 0000';
  });
  $('#checkout-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy || !state.cart.length) return;
    const form = event.currentTarget; if (!form.reportValidity()) return;
    state.busy = true; const submit = $('#place-order'); submit.disabled = true; submit.innerHTML = 'Placing your order…'; $('#checkout-error').classList.add('hidden');
    const formData = new FormData(form);
    const payload = {
      customer_name: String(formData.get('customer_name') || '').trim(),
      customer_email: String(formData.get('customer_email') || '').trim(),
      customer_phone: String(formData.get('customer_phone') || '').trim(),
      shipping_address: String(formData.get('shipping_address') || '').trim(),
      shipping_country: 'IN',
      shipping_pincode: String(formData.get('shipping_pincode') || '').trim(),
      items: state.cart.map(item => ({ sku: item.variant.sku, quantity: item.quantity }))
    };
    const body = JSON.stringify(payload);
    if (!state.pendingCheckout || state.pendingCheckout.body !== body) state.pendingCheckout = { body, key: `web-${randomKey()}` };
    try {
      const response = await request(`${API_BASE}/orders`, { method: 'POST', headers: { 'Idempotency-Key': state.pendingCheckout.key }, body });
      state.pendingCheckout = null; setCheckout(false); setSuccess(true, response.data || {}); form.reset();
    } catch (error) {
      showCheckoutError(error.message || 'Could not place the order. Please try again.');
      if (error.status === 409) toast('Stock or cart details changed. Please review your bag.');
    } finally { state.busy = false; submit.disabled = false; submit.innerHTML = 'Place COD order <span>↗</span>'; }
  });
  function randomKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(18); if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes); else for (let i=0;i<bytes.length;i++) bytes[i] = Math.floor(Math.random()*256);
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function loadProducts() {
    state.loading = true; renderProducts();
    try {
      const response = await request(`${API_BASE}/products`);
      state.products = Array.isArray(response.data) ? response.data : [];
      state.products.forEach(product => { if (!state.selectedSizes[product.id]) { const first = availableVariants(product)[0]; if (first) state.selectedSizes[product.id] = first.sku; } });
      $('#catalog-status').textContent = state.products.length ? '' : 'The catalog is connected, but no active products have been added yet.';
    } catch (error) {
      $('#catalog-status').textContent = '';
      $('#catalog-count').textContent = 'Collection temporarily unavailable';
      $('#empty-state').classList.remove('hidden');
      $('#empty-state').innerHTML = `<p class="eyebrow">CONNECTION NEEDED</p><h3>We’re preparing your collection.</h3><p>${escapeHtml(error.message)} Please refresh shortly. We won’t show fake products or incorrect prices.</p><button class="button button-dark" type="button" id="retry-products">Try again ↻</button>`;
      $('#retry-products')?.addEventListener('click', loadProducts, { once: true });
    } finally { state.loading = false; renderProducts(); }
  }
  async function loadActiveCampaigns() {
    try {
      const response = await request('/api/v1/store/campaigns/active');
      const campaigns = Array.isArray(response.data) ? response.data : [];
      const banner = $('#campaign-strip');
      if (!banner || !campaigns.length) return;
      const campaign = campaigns[0];
      const link = document.createElement('a');
      link.href = campaign.target_url || '#shop';
      if (campaign.target_url) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      if (campaign.image_url) { const image = document.createElement('img'); image.src = campaign.image_url; image.alt = ''; image.loading = 'lazy'; link.append(image); }
      const headline = document.createElement('strong'); headline.textContent = campaign.headline || campaign.name || 'Discover the latest BF SHOES drop'; link.append(headline);
      if (Number(campaign.discount_percent) > 0) { const discount = document.createElement('span'); discount.textContent = `${campaign.discount_percent}% offer`; link.append(discount); }
      banner.replaceChildren(link); banner.classList.remove('hidden');
    } catch { /* Homepage stays usable when no campaign has been configured. */ }
  }
  $('#year').textContent = String(new Date().getFullYear());
  renderCart(); loadProducts(); loadActiveCampaigns();
})();
