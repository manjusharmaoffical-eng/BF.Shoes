(() => {
  'use strict';

  const API_BASE = (window.BF_SHOES_CONFIG && window.BF_SHOES_CONFIG.API_BASE_URL) || '/api/v1/store';

  const FALLBACK_IMAGES = ['/bf-shoes-hero.svg'];

  const state = { products: [], cart: [], selectedSizes: {}, filter: 'all', search: '', categories: [], colors: [], sort: 'featured', wishlist: new Set(), loading: true, busy: false, pendingCheckout: null };

  try { state.wishlist = new Set(JSON.parse(localStorage.getItem('bf-shoes-wishlist') || '[]').map(String)); } catch { state.wishlist = new Set(); }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = (cents, currency = 'INR') => `₹${(Number(cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const DELIVERY_FEE_PAISE = 5000;
  const checkoutTotalCents = () => totalCents() + (state.cart.length ? DELIVERY_FEE_PAISE : 0);
  const randomKey = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  const productImage = product => {
    const candidate = typeof product.image_url === 'string' && product.image_url.startsWith('https://') ? product.image_url : '';
    return candidate || FALLBACK_IMAGES[Math.abs(hashCode(product.slug || product.name || 'bf')) % FALLBACK_IMAGES.length];
  };

  function hashCode(value) { let hash = 0; for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0; return hash; }
  function toast(message) { const el = $('#toast'); if(!el) return; el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600); }

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
    if (!grid) return;

    let products = state.products.filter(product => { 
      const inStock = availableVariants(product).length > 0; 
      const query = state.search.trim().toLowerCase(); 
      const matchesSearch = !query || [product.name, product.brand, product.description, product.slug].some(value => String(value || '').toLowerCase().includes(query)); 
      const category=String(product.category || product.category_name || '').toLowerCase(); 
      const matchesCategory=!state.categories.length || state.categories.some(value=>category.includes(value)); 
      const productColors=(product.variants||[]).map(v=>String(v.color_name||'').toLowerCase()); 
      const matchesColor=!state.colors.length || state.colors.some(value=>productColors.some(color=>color.includes(value))); 
      return (state.filter !== 'available' || inStock) && (state.filter !== 'saved' || state.wishlist.has(String(product.id))) && matchesSearch && matchesCategory && matchesColor; 
    });

    if (state.sort === 'price-low') products.sort((a,b) => Number(a.price_cents)-Number(b.price_cents)); 
    else if (state.sort === 'price-high') products.sort((a,b) => Number(b.price_cents)-Number(a.price_cents)); 
    else if (state.sort === 'name') products.sort((a,b) => String(a.name).localeCompare(String(b.name)));

    const statusEl = $('#catalog-status');
    if(statusEl) statusEl.textContent = state.loading ? 'Finding your next pair…' : state.products.length ? `${products.length} ${products.length === 1 ? 'style' : 'styles'} shown` : 'The catalog is connected, but no active products have been added yet.';

    const countLabel = $('#catalog-count'); 
    if (countLabel) countLabel.textContent = state.loading ? 'Loading products…' : `Showing ${products.length} of ${state.products.length} products`;

    const wishlistCount = $('#wishlist-count'); 
    if (wishlistCount) wishlistCount.textContent = String(state.wishlist.size);

    const emptyState = $('#empty-state');
    if(emptyState) emptyState.classList.toggle('hidden', state.loading || products.length > 0);

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
    if($('#cart-count')) $('#cart-count').textContent = String(count);
    if($('#drawer-count')) $('#drawer-count').textContent = `(${count})`;
    if($('#cart-empty')) $('#cart-empty').classList.toggle('hidden', count > 0);
    if($('#drawer-foot')) $('#drawer-foot').classList.toggle('hidden', count === 0);
    if($('#cart-items')) $('#cart-items').classList.toggle('hidden', count === 0);
    if($('#cart-subtotal')) $('#cart-subtotal').textContent = money(totalCents(), 'INR'); 

    const delivery=$('#cart-delivery-fee'); 
    if(delivery) delivery.textContent=money(state.cart.length ? DELIVERY_FEE_PAISE : 0,'INR');
    if($('#checkout-total')) $('#checkout-total').textContent = money(checkoutTotalCents(), 'INR');

    if($('#cart-items')) {
      $('#cart-items').innerHTML = state.cart.map(item => `<div class="cart-line"><img src="${escapeHtml(productImage(item.product))}" alt="" /><div><h3>${escapeHtml(item.product.name)}</h3><p>Size ${escapeHtml(item.variant.size_label)} · ${escapeHtml(item.variant.color_name || 'Classic')}</p><div class="qty-control"><button type="button" data-qty="-1" data-sku="${escapeHtml(item.variant.sku)}" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-qty="1" data-sku="${escapeHtml(item.variant.sku)}" aria-label="Increase quantity" ${item.quantity >= 10 ? 'disabled' : ''}>+</button></div></div><strong class="cart-line-price">${money(Number(item.product.price_cents) * item.quantity, item.product.currency)}</strong></div>`).join('');
    }
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
    if($('#cart-drawer')) $('#cart-drawer').classList.toggle('open', open); 
    if($('#cart-drawer')) $('#cart-drawer').setAttribute('aria-hidden', String(!open)); 
    if($('#scrim')) $('#scrim').classList.toggle('visible', open); 
    document.body.classList.toggle('locked', open || $('#checkout-backdrop')?.classList.contains('visible') || $('#success-backdrop')?.classList.contains('visible'));
  }

  function setCheckout(open) {
    if($('#checkout-backdrop')) $('#checkout-backdrop').classList.toggle('visible', open); 
    if($('#checkout-backdrop')) $('#checkout-backdrop').setAttribute('aria-hidden', String(!open)); 
    document.body.classList.toggle('locked', open || $('#cart-drawer')?.classList.contains('open') || $('#success-backdrop')?.classList.contains('visible'));
    if (open) { 
      if($('#checkout-error')) $('#checkout-error').classList.add('hidden'); 
      if($('#checkout-total')) $('#checkout-total').textContent = money(checkoutTotalCents(), 'INR'); 
      setTimeout(() => $('input[name="customer_name"]')?.focus(), 80); 
    }
  }

  function setSuccess(open, order = null) {
    if($('#success-backdrop')) $('#success-backdrop').classList.toggle('visible', open); 
    if($('#success-backdrop')) $('#success-backdrop').setAttribute('aria-hidden', String(!open));
    if (order && $('#success-order-number')) $('#success-order-number').textContent = order.order_number ? `BF-${String(order.order_number).padStart(6, '0')}` : 'Confirmed';
    document.body.classList.toggle('locked', open);
  }

  function showCheckoutError(message) { 
    if($('#checkout-error')) {
      $('#checkout-error').textContent = message; 
      $('#checkout-error').classList.remove('hidden'); 
    }
  }

  async function loadProducts() {
    state.loading = true;
    renderProducts();
    try {
      const response = await request(`${API_BASE}/products`);
      state.products = Array.isArray(response) ? response : (response.data || response.products || []);
      if (!Array.isArray(state.products)) state.products = [];
    } catch (error) {
      console.error("Error loading products:", error);
      toast(error.message || 'Failed to load products.');
      state.products = [];
    } finally {
      state.loading = false;
      renderProducts();
    }
  }

  if($('#product-grid')) {
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
  }

  if($('#cart-items')) {
    $('#cart-items').addEventListener('click', event => {
      const button = event.target.closest('[data-qty]'); if (!button) return;
      const item = state.cart.find(row => row.variant.sku === button.dataset.sku); if (!item) return;
      const next = item.quantity + Number(button.dataset.qty); const stock = Number(item.variant.stock_qty);
      if (next <= 0) state.cart = state.cart.filter(row => row !== item);
      else if (next <= Math.min(10, stock)) item.quantity = next;
      else toast('Maximum available quantity reached.');
      renderCart();
    });
  }

  $('#open-cart')?.addEventListener('click', () => setDrawer(true));
  $('#close-cart')?.addEventListener('click', () => setDrawer(false));
  $('#scrim')?.addEventListener('click', () => setDrawer(false));
  $('#continue-shopping')?.addEventListener('click', () => setDrawer(false));
  $('#checkout-button')?.addEventListener('click', () => { if (!state.cart.length) return; setDrawer(false); setCheckout(true); });
  $('#close-checkout')?.addEventListener('click', () => setCheckout(false));
  $('#checkout-backdrop')?.addEventListener('click', event => { if (event.target === $('#checkout-backdrop')) setCheckout(false); });
  $('#finish-order')?.addEventListener('click', () => { setSuccess(false); state.cart = []; renderCart(); renderProducts(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#success-backdrop')?.addEventListener('click', event => { if (event.target === $('#success-backdrop')) setSuccess(false); });

  $$('.filter').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; $$('.filter').forEach(b => b.classList.toggle('active', b === button)); renderProducts(); }));
  $('#product-search')?.addEventListener('input', event => { state.search = event.target.value; const headerSearch=$('#header-product-search'); if(headerSearch) headerSearch.value=event.target.value; renderProducts(); });
  $('#header-product-search')?.addEventListener('input', event => { if($('#product-search')) $('#product-search').value=event.target.value; state.search=event.target.value; renderProducts(); if(event.target.value) $('#shop')?.scrollIntoView({behavior:'smooth',block:'start'}); });
  $('#header-wishlist')?.addEventListener('click', () => { state.filter='saved'; $$('.filter').forEach(b=>b.classList.toggle('active',b.dataset.filter==='saved')); renderProducts(); $('#shop')?.scrollIntoView({behavior:'smooth',block:'start'}); });
  $('#price-range')?.addEventListener('input', event => { if($('#price-range-value')) $('#price-range-value').textContent=`₹${Number(event.target.value).toLocaleString('en-IN')}`; });
  $$('.catalog-sidebar [data-category]').forEach(input => input.addEventListener('change', () => { state.categories=$$('.catalog-sidebar [data-category]:checked').map(x=>x.dataset.category.toLowerCase()); renderProducts(); }));
  $$('.catalog-sidebar [data-color]').forEach(input => input.addEventListener('change', () => { state.colors=$$('.catalog-sidebar [data-color]:checked').map(x=>x.dataset.color.toLowerCase()); renderProducts(); }));
  $$('.view-mode').forEach(button=>button.addEventListener('click',()=>{$$('.view-mode').forEach(b=>b.classList.toggle('active',b===button));$('#product-grid')?.classList.toggle('list-view',button.textContent.trim()==='☷');}));
  $('#product-sort')?.addEventListener('change', event => { state.sort = event.target.value; renderProducts(); });

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
  $$('.catalog-sidebar input').forEach(input => input.addEventListener('change', () => {
    if (window.matchMedia('(max-width: 1024px)').matches && input.type === 'checkbox') setMobileFilters(false);
  }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setMobileFilters(false); });

  const countrySelect = $('#shipping-country');
  if (countrySelect) {
    countrySelect.addEventListener('change', () => {
      $('input[name="customer_phone"]').placeholder = '+971 50 000 0000';
    });
  }

  $('#newsletter-form')?.addEventListener('submit', async event => { 
    event.preventDefault(); 
    const form=event.currentTarget, button=form.querySelector('button[type=submit],button:not([type])'); 
    if(button)button.disabled=true; 
    if($('#newsletter-message')) $('#newsletter-message').textContent='Submitting…'; 
    try { 
      const email=String(new FormData(form).get('email')||'').trim(); 
      const result=await request('/api/v1/newsletter/subscribe',{method:'POST',body:JSON.stringify({email})}); 
      if($('#newsletter-message')) $('#newsletter-message').textContent=result.message+(result.email_status==='sent'?' Email confirmation sent.': ' Your signup is saved; email delivery may need configuration.'); 
      form.reset(); 
    } catch(error) { 
      if($('#newsletter-message')) $('#newsletter-message').textContent=error.message||'Signup failed. Please try again.'; 
    } finally { 
      if(button)button.disabled=false; 
    } 
  });
  
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { setCheckout(false); setSuccess(false); setDrawer(false); } });

  $('#shipping-country')?.addEventListener('change', event => {
    const isIndia = event.target.value === 'IN';
    $('#india-pin-field')?.classList.toggle('hidden', !isIndia);
    const pin = $('#shipping-pincode');
    if (pin) { pin.required = isIndia; if (!isIndia) pin.value = ''; }
    const phone = $('input[name="customer_phone"]');
    if (phone) phone.placeholder = isIndia ? '+91 98765 43210' : '+971 50 000 0000';
  });

  $('#checkout-form')?.addEventListener('submit', async event => {
    event.preventDefault(); 
    if (state.busy || !state.cart.length) return;
    const form = event.currentTarget; 
    if (!form.reportValidity()) return;
    
    state.busy = true; 
    const submit = $('#place-order'); 
    if(submit) {
      submit.disabled = true; 
      submit.innerHTML = 'Placing your order…'; 
    }
    if($('#checkout-error')) $('#checkout-error').classList.add('hidden');
    
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
    if (!state.pendingCheckout || state.pendingCheckout.body !== body) {
      state.pendingCheckout = { body, key: `web-${randomKey()}` };
    }

    try {
      const result = await request(`${API_BASE}/orders`, {
        method: 'POST',
        body: body,
        headers: {
          'Idempotency-Key': state.pendingCheckout.key
        }
      });
      
      setCheckout(false);
      setSuccess(true, result.order || result);
      state.cart = [];
      state.pendingCheckout = null;
      renderCart();
      
    } catch (error) {
      showCheckoutError(error.message || 'Failed to place order. Please try again.');
    } finally {
      state.busy = false;
      if(submit) {
        submit.disabled = false;
        submit.innerHTML = 'Place order'; 
      }
    }
  });

  renderCart();
  loadProducts(); 
})();
