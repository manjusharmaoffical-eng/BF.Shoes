(() => {
  'use strict';

  const API_BASE = (window.BF_SHOES_CONFIG && window.BF_SHOES_CONFIG.API_BASE_URL) || '/api/v1/store';
  const FALLBACK_IMAGE = '/assets/bf-speed-run-product.jpeg';
  const PLACEHOLDER_IMAGE = '/assets/bf-product-placeholder.svg';
  const FALLBACK_IMAGES = [FALLBACK_IMAGE, PLACEHOLDER_IMAGE, '/bf-shoes-hero.svg'];
  const requestedMarket = new URLSearchParams(window.location.search).get('market');
  let savedMarket = requestedMarket === 'AE' ? 'AE' : 'IN';
  try {
    if (requestedMarket === 'IN' || requestedMarket === 'AE') localStorage.setItem('bf-market', savedMarket);
    else savedMarket = localStorage.getItem('bf-market') === 'AE' ? 'AE' : 'IN';
  } catch {}
  const state = { market: savedMarket, checkoutReady: false, products: [], cart: [], cartByMarket: { IN: [], AE: [] }, selectedSizes: {}, filter: 'all', search: '', wishlist: new Set(), loading: true, busy: false, pendingCheckout: null, marketConfig: null };
  state.cart = state.cartByMarket[state.market];
  const cartStorageKey = market => `bf-shoes-cart:v1:${market === 'AE' ? 'AE' : 'IN'}`;
  function persistCart(market = state.market, cart = state.cart) {
    try {
      localStorage.setItem(cartStorageKey(market), JSON.stringify(cart.map(item => ({ sku: String(item.variant?.sku || ''), quantity: Math.max(1, Math.min(10, Math.floor(Number(item.quantity) || 1))) })).filter(item => item.sku)));
    } catch {}
  }
  function hydrateCart() {
    let saved = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(cartStorageKey(state.market)) || '[]');
      if (Array.isArray(parsed)) saved = parsed;
    } catch {}
    const currency = state.market === 'AE' ? 'AED' : 'INR';
    state.cart = saved.flatMap(entry => {
      if (!entry || typeof entry.sku !== 'string') return [];
      const product = state.products.find(item => item.currency === currency && hasVerifiedPrice(item) && (item.variants || []).some(variant => variant.sku === entry.sku));
      const variant = product?.variants?.find(item => item.sku === entry.sku);
      const stock = Math.max(0, Math.floor(Number(variant?.stock_qty) || 0));
      const quantity = Math.min(10, stock, Math.floor(Number(entry.quantity) || 0));
      return product && variant && quantity > 0 ? [{ product, variant, quantity }] : [];
    });
    state.cartByMarket[state.market] = state.cart;
    persistCart();
  }
  try { state.wishlist = new Set(JSON.parse(localStorage.getItem('bf-shoes-wishlist') || '[]').map(String)); } catch { state.wishlist = new Set(); }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // Handle broken product/content images without inline handlers, which CSP blocks.
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (image.dataset.bfFallbackApplied === 'true') {
      image.hidden = true;
      return;
    }
    image.dataset.bfFallbackApplied = 'true';
    image.src = image.dataset.productFallback || PLACEHOLDER_IMAGE;
  }, true);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = (cents, currency = 'INR') => { const locale = currency === 'AED' ? 'en-AE' : 'en-IN'; const amount = (Number(cents || 0) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return currency === 'AED' ? 'AED ' + amount : '₹' + amount; };
  // Fail closed when a product has no verified, positive integer selling price.
  const hasVerifiedPrice = product => {
    const cents = Number(product?.price_cents);
    return Boolean(product) && product.price_pending_conversion !== true && product.price_verified !== false && Number.isSafeInteger(cents) && cents > 0;
  };
  // Delivery and tax amounts are never guessed; public config exposes readiness only.
  const deliveryFeeCents = () => null;
  const vatCents = () => null;
  const checkoutTotalCents = () => totalCents();
  const setupMessage = () => state.market === 'IN'
    ? 'India checkout is pending PayU merchant verification, verified INR prices, confirmed delivery fee and GST profile.'
    : 'UAE checkout is pending PayTabs merchant verification, verified AED prices, delivery fee and VAT profile.';
  const randomKey = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const normalizeImageUrl = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (parsed.hostname === 'bf-shoes.vercel.app') return parsed.pathname + parsed.search + parsed.hash;
      return parsed.protocol === 'https:' ? raw : '';
    } catch {
      return raw.startsWith('/') ? raw : '';
    }
  };
  const productImage = product => normalizeImageUrl(product?.image_url) || productFallback(product);
  const productFallback = product => /speed[- ]run/i.test((product.slug || '') + ' ' + (product.name || '')) ? FALLBACK_IMAGE : PLACEHOLDER_IMAGE;
  function hashCode(value) { let hash = 0; for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0; return hash; }
  function toast(message) { const el = $('#toast'); if (!el) return; el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600); }
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

  async function loadActiveCampaign() {
    const strip = $('#campaign-strip');
    if (!strip) return;
    try {
      const result = await request(`${API_BASE}/campaigns/active`);
      const campaign = (result.data || [])[0];
      if (!campaign) { strip.classList.add('hidden'); return; }
      try {
        if (localStorage.getItem('bf-campaign-dismissed:' + campaign.id) === '1') {
          strip.classList.add('hidden');
          return;
        }
      } catch {}

      const inner = document.createElement('div');
      inner.className = 'campaign-inner';
      const content = document.createElement(campaign.target_url && campaign.target_url.startsWith('https://') ? 'a' : 'div');
      content.className = 'campaign-content';
      if (content.tagName === 'A') content.href = campaign.target_url;
      if (campaign.image_url && campaign.image_url.startsWith('https://')) {
        const image = document.createElement('img');
        image.src = campaign.image_url;
        image.alt = campaign.headline || campaign.name || 'BF SHOES campaign';
        image.loading = 'lazy';
        content.append(image);
      }
      const copy = document.createElement('div');
      const headline = document.createElement('strong');
      headline.textContent = campaign.headline || campaign.name || 'BF SHOES';
      copy.append(headline);
      const details = [];
      if (Number(campaign.discount_percent) > 0) details.push(String(campaign.discount_percent) + '% OFF');
      if (campaign.coupon_code) details.push('Code: ' + campaign.coupon_code);
      if (details.length) {
        const detail = document.createElement('span');
        detail.textContent = details.join(' · ');
        copy.append(detail);
      }
      content.append(copy);
      inner.append(content);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'campaign-dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss campaign banner');
      dismiss.textContent = '×';
      dismiss.addEventListener('click', () => {
        try { localStorage.setItem('bf-campaign-dismissed:' + campaign.id, '1'); } catch {}
        strip.classList.add('hidden');
      });
      inner.append(dismiss);
      strip.replaceChildren(inner);
      strip.classList.remove('hidden');
    } catch {
      strip.classList.add('hidden');
    }
  }

  function totalItems() { return state.cart.reduce((sum, item) => sum + item.quantity, 0); }
  function totalCents() { return state.cart.reduce((sum, item) => sum + Number(item.product.price_cents) * item.quantity, 0); }
  function availableVariants(product) { return (product.variants || []).filter(v => Number(v.stock_qty) > 0); }

  function renderProducts() {
    const grid = $('#product-grid');
    if (!grid) return;

    const marketCurrency = state.market === 'AE' ? 'AED' : 'INR';
    const marketProducts = state.products.filter(product => product.currency === marketCurrency);
    let products = marketProducts.filter(product => {
      const inStock = availableVariants(product).length > 0;
      const query = state.search.trim().toLowerCase();
      const matchesSearch = !query || [product.name, product.brand, product.description, product.slug].some(value => String(value || '').toLowerCase().includes(query));
      return (state.filter !== 'available' || inStock) && (state.filter !== 'saved' || state.wishlist.has(String(product.id))) && matchesSearch;
    });

    if (state.sort === 'price-low') products.sort((a,b) => Number(a.price_cents)-Number(b.price_cents));
    else if (state.sort === 'price-high') products.sort((a,b) => Number(b.price_cents)-Number(a.price_cents));
    else if (state.sort === 'name') products.sort((a,b) => String(a.name).localeCompare(String(b.name)));

    const statusEl = $('#catalog-status');
    if(statusEl) statusEl.textContent = state.loading ? 'Finding your next pair…' : marketProducts.length ? `${products.length} ${products.length === 1 ? 'style' : 'styles'} shown` : 'The catalog is connected, but no active products have been added yet.';

    const countLabel = $('#catalog-count');
    if (countLabel) countLabel.textContent = state.loading ? 'Loading products…' : `Showing ${products.length} of ${marketProducts.length} products`;

    const wishlistCount = $('#wishlist-count');
    if (wishlistCount) wishlistCount.textContent = String(state.wishlist.size);
    const headerWishlist = $('#header-wishlist');
    if (headerWishlist) headerWishlist.setAttribute('aria-label', `Wishlist, ${state.wishlist.size} saved items`);

    const emptyState = $('#empty-state');
    if(emptyState) emptyState.classList.toggle('hidden', state.loading || products.length > 0);

    if (state.loading) { grid.innerHTML = ''; return; }
    if (!products.length) { grid.innerHTML = ''; return; }

    grid.innerHTML = products.map((product, index) => {
      const variants = product.variants || [];
      const available = availableVariants(product);
      const selected = state.selectedSizes[product.id] || (available[0] && available[0].sku) || '';
      const selectedVariant = variants.find(v => v.sku === selected && Number(v.stock_qty) > 0);
      const mrpCents = Number(product.mrp_cents || 0);
      const priceReady = hasVerifiedPrice(product);
      const hasDiscount = priceReady && Number.isSafeInteger(mrpCents) && mrpCents > Number(product.price_cents);
      const createdAt = product.created_at ? Date.parse(product.created_at) : NaN;
      const isNew = Number.isFinite(createdAt) && Date.now() - createdAt < 30 * 24 * 60 * 60 * 1000;
      const status = product.stock_verified === false ? 'Stock check pending' : (isNew ? 'New' : hasDiscount ? 'Sale' : (!available.length ? 'Sold out' : (available.length <= 2 ? 'Limited run' : 'Everyday essential')));
      const watched = state.wishlist.has(String(product.id));

      return `<article class="product-card" data-product="${escapeHtml(product.id)}">
        <div class="product-image"><img src="${escapeHtml(productImage(product))}" alt="${escapeHtml(product.name)}" loading="${index < 3 ? 'eager' : 'lazy'}" decoding="async" /><span class="product-tag">${status}</span><button class="wishlist-toggle ${watched ? 'saved' : ''}" type="button" data-wishlist="${escapeHtml(product.id)}" aria-label="${watched ? 'Remove from wishlist' : 'Add to wishlist'}" aria-pressed="${watched}" title="${watched ? 'Remove from wishlist' : 'Add to wishlist'}"><i class="${watched ? 'fa-solid' : 'fa-regular'} fa-heart" aria-hidden="true"></i></button></div>
        <div class="product-info"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.brand || 'BF SHOES')} · ${escapeHtml(product.short_description || product.description || 'Everyday sneaker').slice(0, 58)}</p></div><div class="product-price-wrap"><strong class="product-price">${priceReady ? money(product.price_cents, product.currency) : 'Price verification pending'}</strong>${hasDiscount ? `<del class="product-mrp">${money(mrpCents, product.currency)}</del>` : ''}</div></div>
        <p class="product-view-link">View details &amp; options <span aria-hidden="true">↗</span></p>
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
    const activeCurrency = state.market === 'AE' ? 'AED' : 'INR';
    if($('#cart-subtotal')) $('#cart-subtotal').textContent = money(totalCents(), activeCurrency);

    const delivery=$('#cart-delivery-fee');
    const guidance=$('#cart-market-guidance');
    if(guidance) guidance.textContent = state.market === 'IN' ? 'India delivery is currently limited to PIN 500052. Checkout remains closed until verified INR pricing, delivery fee, GST and PayU setup are complete.' : 'UAE delivery fee, VAT and merchant gateway setup are not yet verified. Checkout remains closed; India PIN and payment instructions do not apply.';
    if(delivery) delivery.textContent='Not configured';
    if($('#checkout-total')) $('#checkout-total').textContent = money(checkoutTotalCents(), activeCurrency);

    if($('#cart-items')) {
      $('#cart-items').innerHTML = state.cart.map(item => `<div class="cart-line"><img src="${escapeHtml(productImage(item.product))}" alt="" /><div><h3>${escapeHtml(item.product.name)}</h3><p>Size ${escapeHtml(item.variant.size_label)} · ${escapeHtml(item.variant.color_name || 'Classic')}</p><div class="qty-control"><button type="button" data-qty="-1" data-sku="${escapeHtml(item.variant.sku)}" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-qty="1" data-sku="${escapeHtml(item.variant.sku)}" aria-label="Increase quantity" ${item.quantity >= 10 ? 'disabled' : ''}>+</button></div></div><strong class="cart-line-price">${money(Number(item.product.price_cents) * item.quantity, item.product.currency)}</strong></div>`).join('');
    }
  }

  function addToCart(product, variant) {
    const activeCurrency = state.market === 'AE' ? 'AED' : 'INR';
    if (!hasVerifiedPrice(product) || product?.currency !== activeCurrency) return toast('This product needs a verified price for the selected market before it can be ordered.');
    if (!variant || Number(variant.stock_qty) <= 0) return toast('That size is out of stock.');
    const current = state.cart.find(item => item.variant.sku === variant.sku);
    const already = current?.quantity || 0;
    if (already >= Math.min(10, Number(variant.stock_qty))) return toast('Maximum available quantity reached.');
    if (current) current.quantity += 1; else state.cart.push({ product, variant, quantity: 1 });
    state.cartByMarket[state.market] = state.cart;
    persistCart();
    renderCart(); toast(`${product.name} · size ${variant.size_label} added to your bag.`);
  }

  function setDrawer(open) {
    if($('#cart-drawer')) $('#cart-drawer').classList.toggle('open', open);
    if($('#cart-drawer')) { $('#cart-drawer').setAttribute('aria-hidden', String(!open)); $('#cart-drawer').toggleAttribute('inert', !open); }
    if($('#scrim')) $('#scrim').classList.toggle('visible', open);
    document.body.classList.toggle('locked', open || $('#checkout-backdrop')?.classList.contains('visible') || $('#success-backdrop')?.classList.contains('visible'));
  }

  function setCheckout(open) {
    if($('#checkout-backdrop')) $('#checkout-backdrop').classList.toggle('visible', open);
    if($('#checkout-backdrop')) $('#checkout-backdrop').setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('locked', open || $('#cart-drawer')?.classList.contains('open') || $('#success-backdrop')?.classList.contains('visible'));
    if (open) {
      if($('#checkout-error')) $('#checkout-error').classList.add('hidden');
      if($('#checkout-total')) $('#checkout-total').textContent = money(checkoutTotalCents(), state.market === 'AE' ? 'AED' : 'INR');
      setTimeout(() => $('input[name="customer_name"]')?.focus(), 80);
    }
  }

  function setSuccess(open, order = null) {
    if($('#success-backdrop')) $('#success-backdrop').classList.toggle('visible', open);
    if($('#success-backdrop')) $('#success-backdrop').setAttribute('aria-hidden', String(!open));
    if (order && $('#success-order-number')) $('#success-order-number').textContent = order.order_number ? `BF-${String(order.order_number).padStart(6, '0')}` : 'Confirmed';
    if (order && $('#success-total')) $('#success-total').textContent = money(order.total_cents, order.currency || (state.market === 'AE' ? 'AED' : 'INR'));
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
      const response = await request(`${API_BASE}/products?market=${encodeURIComponent(state.market)}`);
      state.products = Array.isArray(response) ? response : (response.data || response.products || []);
      if (!Array.isArray(state.products)) state.products = [];
      hydrateCart();
      renderCart();
    } catch (error) {
      console.error("Error loading products:", error);
      toast(error.message || 'Failed to load products.');
      state.products = [];
    } finally {
      state.loading = false;
      renderProducts();
    }
  }

  async function syncCustomerWishlist() {
    let customerToken = '';
    try { customerToken = sessionStorage.getItem('bf-shoes-customer-token') || ''; } catch {}
    if (!customerToken) return;
    try {
      const response = await fetch('/api/v1/customer-auth/wishlist', {
        headers: { Authorization: 'Bearer ' + customerToken, Accept: 'application/json' },
        cache: 'no-store', credentials: 'same-origin'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) { try { sessionStorage.removeItem('bf-shoes-customer-token'); } catch {} }
        throw new Error(data.error || 'Wishlist sync is unavailable.');
      }
      state.wishlist = new Set((data.data || []).map(item => String(item.product_id)));
      try { localStorage.setItem('bf-shoes-wishlist', JSON.stringify([...state.wishlist])); } catch {}
      const count = $('#wishlist-count'); if (count) count.textContent = String(state.wishlist.size);
      $('#header-wishlist')?.setAttribute('aria-label', `Wishlist, ${state.wishlist.size} saved items`);
      renderProducts();
    } catch (error) {
      toast('Account wishlist sync is unavailable. Your saved items remain on this device.');
    }
  }

  let previousProductDetailsFocus = null;
  async function openProductDetails(productId) {
    previousProductDetailsFocus = document.activeElement;
    const product = state.products.find(item => String(item.id) === String(productId));
    const modal = $('#product-detail-modal');
    const content = $('#product-detail-content');
    if (!product || !modal || !content) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('locked');
    content.innerHTML = '<p class="product-detail-loading">Loading BF product details…</p>';
    let images = [];
    try {
      const response = await fetch('/api/v1/store/products/' + encodeURIComponent(product.id) + '/images');
      if (response.ok) {
        const data = await response.json();
        images = Array.isArray(data.data)
          ? data.data.map(image => ({ ...image, image_url: normalizeImageUrl(image.image_url) })).filter(image => image.image_url)
          : [];
      }
    } catch {}
    if (!images.length && product.image_url) images = [{ image_url: productImage(product), alt_text: product.name }];
    if (!images.length) images = [{ image_url: productImage(product), alt_text: product.name }];
    const variants = (product.variants || []).filter(v => v.active !== false);
    const available = variants.filter(v => Number(v.stock_qty) > 0 && v.stock_verified !== false);
    const initialSku = state.selectedSizes[product.id] || variants[0]?.sku || '';
    const initialVariant = variants.find(v => v.sku === initialSku) || variants[0] || null;
    let selectedColor = String(initialVariant?.color_name || '');
    let selectedSku = initialVariant?.sku || '';
    const colorNames = [...new Set(variants.map(v => String(v.color_name || '').trim()).filter(Boolean))];
    const priceReady = hasVerifiedPrice(product);
    const moneyLine = priceReady
      ? '<p class="detail-price">' + money(product.price_cents, product.currency) + '</p>'
      : '<p class="detail-price-pending">Price verification pending for this market</p>';
    const mrpCents = Number(product.mrp_cents);
    const mrpLine = priceReady && Number.isSafeInteger(mrpCents) && mrpCents > Number(product.price_cents)
      ? '<p class="detail-mrp">MRP <del>' + money(mrpCents, product.currency) + '</del></p>'
      : '';
    const attributeEntries = Object.entries(product.attributes && typeof product.attributes === 'object' ? product.attributes : {})
      .filter(([key, value]) => /^[a-z0-9 _-]{1,50}$/i.test(key) && ['string','number','boolean'].includes(typeof value) && String(value).trim() !== '');
    const attributeMarkup = attributeEntries.length
      ? '<section class="detail-specifications"><h3>Product information</h3><dl>' + attributeEntries.map(([key,value]) => '<div><dt>' + escapeHtml(key.replace(/[_-]+/g,' ').split(' ').map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' ')) + '</dt><dd>' + escapeHtml(value) + '</dd></div>').join('') + '</dl></section>'
      : '';
    const detailMeta = [
      ['Brand', product.brand || 'BF SHOES'],
      ['Category', product.category || ''],
      ['Type', product.product_type || ''],
      ['For', product.audience || ''],
      ['SKU', initialVariant?.sku || 'Select a size']
    ].filter(([,value]) => String(value).trim());
    const metaMarkup = '<dl class="detail-meta">' + detailMeta.map(([label,value]) => '<div><dt>' + label + '</dt><dd>' + escapeHtml(value) + '</dd></div>').join('') + '</dl>';
    const colorMarkup = colorNames.length
      ? '<section class="detail-option-group"><h3>Colour</h3><div class="detail-colors">' + colorNames.map(color => '<button type="button" class="detail-color-option ' + (color === selectedColor ? 'selected' : '') + '" data-detail-color="' + escapeHtml(color) + '" aria-pressed="' + (color === selectedColor) + '">' + escapeHtml(color) + '</button>').join('') + '</div></section>'
      : '<p class="detail-stock">Colour information has not been added for this product yet.</p>';
    const renderSizeMarkup = () => variants
      .filter(v => !selectedColor || String(v.color_name || '').trim() === selectedColor)
      .map(v => '<button type="button" class="size-option ' + (v.sku === selectedSku ? 'selected' : '') + '" data-detail-size="' + escapeHtml(v.sku) + '" ' + (v.stock_verified === false || Number(v.stock_qty) <= 0 ? 'disabled' : '') + '>' + escapeHtml(v.size_label) + '</button>').join('');
    let sizeMarkup = renderSizeMarkup();
    const galleryMarkup = images.map((image, index) => '<button type="button" class="detail-thumb ' + (index === 0 ? 'active' : '') + '" data-detail-image="' + index + '" aria-label="View product angle ' + (index + 1) + '"><img src="' + escapeHtml(image.image_url) + '" alt="' + escapeHtml(image.alt_text || product.name) + '"></button>').join('');
    content.innerHTML = '<div class="product-detail-layout"><div class="product-detail-gallery"><div class="product-detail-stage" id="detail-stage">' +
      '<img id="detail-main-image" src="' + escapeHtml(images[0].image_url) + '" alt="' + escapeHtml(images[0].alt_text || product.name) + '">' +
      '</div><div class="detail-thumbnails">' + galleryMarkup + '</div>' +
      '<p class="detail-viewer-note">Product photos · Select a thumbnail to view another angle</p>' +
      '</div><div class="product-detail-copy"><p class="eyebrow">BF SHOES · PRODUCT DETAILS</p><h2>' + escapeHtml(product.name) + '</h2>' + moneyLine + mrpLine +
      '<p class="detail-description">' + escapeHtml(product.description || product.short_description || 'Product description has not been added yet.') + '</p>' +
      metaMarkup + colorMarkup + '<section class="detail-option-group"><h3>Size</h3><div class="product-sizes detail-sizes" id="detail-sizes">' + (sizeMarkup || '<span>No sizes have been added for this colour.</span>') + '</div></section>' +
      '<p class="detail-stock" id="detail-stock">' + (initialVariant?.stock_verified === false ? 'Stock verification pending' : initialVariant ? (Number(initialVariant.stock_qty) > 0 ? Number(initialVariant.stock_qty) + ' in stock' : 'Out of stock') : 'Size and stock information has not been added yet') + '</p>' +
      attributeMarkup + '<button type="button" class="button button-dark detail-add" id="detail-add" ' + (!initialVariant || initialVariant.stock_verified === false || Number(initialVariant.stock_qty) <= 0 || !priceReady ? 'disabled' : '') + '>Add to bag</button>' +
      '<div class="detail-benefits"><span>Return and exchange requests are reviewed by the BF SHOES team</span></div>' +
      '<nav class="detail-help-links" aria-label="Product help"><a href="/size-guide.html">Size guide</a><a href="/fit-guide.html">Fit guide</a><a href="/shoe-care.html">Shoe care</a><a href="/shipping.html">Shipping</a><a href="/returns.html">Returns</a></nav></div></div>';
    modal.querySelector('.product-detail-close')?.focus();
    content.querySelectorAll('[data-detail-image]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.detailImage);
      const image = images[index];
      const stage = $('#detail-stage', content);
      if (stage && image) stage.innerHTML = '<img id="detail-main-image" src="' + escapeHtml(image.image_url) + '" data-product-fallback="' + escapeHtml(productImage(product)) + '" alt="' + escapeHtml(image.alt_text || product.name) + '">';
      content.querySelectorAll('[data-detail-image]').forEach(item => item.classList.toggle('active', item === button));
    }));
    const updateDetailVariant = () => {
      const variant = variants.find(v => v.sku === selectedSku) || null;
      const stock = $('#detail-stock', content), add = $('#detail-add', content);
      if (stock) stock.textContent = !variant ? 'Size and stock information has not been added yet' : variant.stock_verified === false ? 'Stock verification pending' : Number(variant.stock_qty) > 0 ? Number(variant.stock_qty) + ' in stock' : 'Out of stock';
      if (add) add.disabled = !variant || variant.stock_verified === false || Number(variant.stock_qty) <= 0 || !priceReady;
      const sku = content.querySelector('.detail-meta dd:last-child');
      if (sku) sku.textContent = variant?.sku || 'Select a size';
      state.selectedSizes[product.id] = selectedSku;
    };
    const bindDetailSizeButtons = () => content.querySelectorAll('[data-detail-size]').forEach(button => button.addEventListener('click', () => {
      selectedSku = button.dataset.detailSize;
      content.querySelectorAll('[data-detail-size]').forEach(item => item.classList.toggle('selected', item === button));
      updateDetailVariant();
    }));
    bindDetailSizeButtons();
    content.querySelectorAll('[data-detail-color]').forEach(button => button.addEventListener('click', () => {
      selectedColor = button.dataset.detailColor;
      const firstAvailable = variants.find(v => String(v.color_name || '').trim() === selectedColor);
      selectedSku = firstAvailable?.sku || '';
      content.querySelectorAll('[data-detail-color]').forEach(item => { const active = item === button; item.classList.toggle('selected', active); item.setAttribute('aria-pressed', String(active)); });
      const sizeContainer = $('#detail-sizes', content);
      sizeMarkup = renderSizeMarkup();
      if (sizeContainer) sizeContainer.innerHTML = sizeMarkup || '<span>No sizes available in this colour</span>';
      bindDetailSizeButtons();
      updateDetailVariant();
    }));
    $('#detail-add', content)?.addEventListener('click', () => {
      const sku = selectedSku || state.selectedSizes[product.id] || '';
      const variant = availableVariants(product).find(v => v.sku === sku && v.stock_verified !== false);
      if (!variant) return toast('Select an available size first.');
      addToCart(product, variant);
      renderCart();
      renderProducts();
      closeProductDetails();
      toast('Added to your BF bag.');
    });
  }
  function closeProductDetails() {
    const modal = $('#product-detail-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.toggle('locked', Boolean($('#cart-drawer')?.classList.contains('open') || $('#checkout-backdrop')?.classList.contains('visible') || $('#success-backdrop')?.classList.contains('visible') || $('#account-backdrop')?.classList.contains('visible')));
    previousProductDetailsFocus?.focus?.();
    previousProductDetailsFocus = null;
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-detail-close]')) closeProductDetails();
    if (event.target === $('#product-detail-modal')) closeProductDetails();
  });
  document.addEventListener('keydown', event => {
    const modal = $('#product-detail-modal');
    if (!modal?.classList.contains('open')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeProductDetails(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  if($('#product-grid')) {
    $('#product-grid').addEventListener('click', event => {
      const productCard = event.target.closest('.product-card');
      if (productCard && !event.target.closest('button')) { openProductDetails(productCard.dataset.product); return; }
      const wishlistButton = event.target.closest('[data-wishlist]');
      if (wishlistButton) {
        const id = String(wishlistButton.dataset.wishlist);
        const removing = state.wishlist.has(id);
        if (removing) state.wishlist.delete(id); else state.wishlist.add(id);
        try { localStorage.setItem('bf-shoes-wishlist', JSON.stringify([...state.wishlist])); } catch {}
        let customerToken = ''; try { customerToken = sessionStorage.getItem('bf-shoes-customer-token') || ''; } catch {}
        if (customerToken) {
          fetch('/api/v1/customer-auth/wishlist/' + encodeURIComponent(id), {
            method: removing ? 'DELETE' : 'PUT', credentials: 'same-origin',
            headers: { Authorization: 'Bearer ' + customerToken, Accept: 'application/json' }
          }).then(async response => {
            if (!response.ok) { const data = await response.json().catch(() => ({})); if (response.status === 401) { try { sessionStorage.removeItem('bf-shoes-customer-token'); } catch {} } throw new Error(data.error || 'Wishlist sync failed'); }
          }).catch(() => toast('Saved on this device; account wishlist sync needs sign-in.'));
        } else if (!removing) toast('Saved on this device. Sign in to sync your wishlist across devices.');
        const count = $('#wishlist-count'); if (count) count.textContent = String(state.wishlist.size);
        const icon = wishlistButton.querySelector('i');
        const watched = state.wishlist.has(id);
        wishlistButton.classList.toggle('saved', watched);
        wishlistButton.setAttribute('aria-pressed', String(watched));
        wishlistButton.setAttribute('aria-label', watched ? 'Remove from wishlist' : 'Add to wishlist');
        wishlistButton.title = watched ? 'Remove from wishlist' : 'Add to wishlist';
        if (icon) { icon.classList.toggle('fa-solid', watched); icon.classList.toggle('fa-regular', !watched); }
        const headerWishlist = $('#header-wishlist');
        if (headerWishlist) headerWishlist.setAttribute('aria-label', `Wishlist, ${state.wishlist.size} saved items`);
        if (state.filter === 'saved' && !watched) renderProducts();
        return;
      }
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
      state.cartByMarket[state.market] = state.cart;
      persistCart();
      renderCart();
    });
  }

  $('#open-cart')?.addEventListener('click', () => setDrawer(true));
  $('#close-cart')?.addEventListener('click', () => setDrawer(false));
  $('#scrim')?.addEventListener('click', () => setDrawer(false));
  $('#continue-shopping')?.addEventListener('click', () => setDrawer(false));
  $('#checkout-button')?.addEventListener('click', () => { if (!state.cart.length) return; setDrawer(false); setCheckout(true); });
  $('#close-checkout')?.addEventListener('click', () => { stopPayuQrPolling(); setCheckout(false); });
  $('#checkout-backdrop')?.addEventListener('click', event => { if (event.target === $('#checkout-backdrop')) { stopPayuQrPolling(); setCheckout(false); } });
  $('#finish-order')?.addEventListener('click', () => { setSuccess(false); state.cart = []; state.cartByMarket[state.market] = state.cart; persistCart(); renderCart(); renderProducts(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#success-backdrop')?.addEventListener('click', event => { if (event.target === $('#success-backdrop')) setSuccess(false); });

  $('#header-product-search')?.addEventListener('input', event => { state.search=event.target.value; renderProducts(); if(event.target.value) $('#shop')?.scrollIntoView({behavior:'smooth',block:'start'}); });
  $('#header-wishlist')?.addEventListener('click', () => { state.filter='saved'; renderProducts(); $('#shop')?.scrollIntoView({behavior:'smooth',block:'start'}); });

  const countrySelect = $('#shipping-country');
  document.querySelectorAll('input[name="payment_method"]').forEach(input => input.addEventListener('change', () => updateCheckoutMarketForm()));

  async function loadCheckoutReadiness() {
    try {
      const config = await request('/api/v1/store/market-config');
      const selected = (config.data || []).find(market => market.country === state.market);
      state.marketConfig = selected || null;
      const marketSelected = selected && (!countrySelect || countrySelect.value === state.market);
      const onlineReady = Boolean(marketSelected && selected.checkoutEnabled);
      const codReady = Boolean(marketSelected && selected.codEnabled);
      state.checkoutReady = onlineReady || codReady;
      state.codReady = codReady;
      state.onlineCheckoutReady = onlineReady;
    } catch { state.checkoutReady = false; }
    const payuInput = $('#payment-payu-option input');
    if (payuInput) payuInput.disabled = !(state.market === 'IN' && state.onlineCheckoutReady);
    const paytabsInput = $('#payment-paytabs-option input');
    if (paytabsInput) paytabsInput.disabled = !(state.market === 'AE' && state.onlineCheckoutReady);
    const codInput = $('#payment-cod-option input');
    if (codInput) codInput.disabled = !state.codReady;
    $('#payment-cod-option')?.classList.toggle('hidden', !state.codReady);
    if (state.codReady && !state.onlineCheckoutReady && codInput) codInput.checked = true;
    const qrInput = $('#payment-upi-option input');
    if (qrInput) {
      qrInput.disabled = !(state.market === 'IN' && state.onlineCheckoutReady && state.marketConfig?.paymentQrEnabled);
      $('#payment-upi-option')?.classList.toggle('payment-unavailable', qrInput.disabled);
      if (qrInput.disabled && qrInput.checked) {
        const payuFallback = $('#payment-payu-option input');
        if (payuFallback) payuFallback.checked = true;
      }
    }
    const checkoutButton = $('#checkout-button');
    const placeOrder = $('#place-order');
    if (checkoutButton) { checkoutButton.disabled = !state.checkoutReady; checkoutButton.textContent = state.checkoutReady ? 'Continue to checkout' : 'Checkout temporarily unavailable'; }
    if (placeOrder) placeOrder.disabled = !state.checkoutReady;
    if ($('#checkout-readiness-note')) $('#checkout-readiness-note').textContent = state.checkoutReady
      ? (state.codReady && !state.onlineCheckoutReady ? 'Cash on Delivery is available for this market.' : "Checkout is ready only after this market's payment, delivery and tax settings are verified.")
      : state.market === 'AE' ? 'UAE shopping is available. COD or online checkout opens after owner, delivery, pricing and VAT verification.' : 'Checkout opens after owner, delivery, pricing and GST verification.';
    updateCheckoutMarketForm();
  }

  function updateCheckoutMarketForm() {
    const isIndia = state.market === 'IN';
    const deliveryHeading = $('#market-delivery-heading');
    if (deliveryHeading) deliveryHeading.textContent = isIndia ? 'INDIA DELIVERY' : 'UAE DELIVERY';
    const deliveryDetail = $('#market-delivery-detail');
    if (deliveryDetail) deliveryDetail.textContent = isIndia ? 'PIN 500052 · Delivery fee pending confirmation' : 'UAE delivery coverage and fee pending confirmation';
    const countryLabel = $('#shipping-country-label');
    if (countryLabel) countryLabel.value = isIndia ? 'India' : 'United Arab Emirates';
    $('#india-pin-field')?.classList.toggle('hidden', !isIndia);
    $('#uae-emirate-field')?.classList.toggle('hidden', isIndia);
    const emirate = $('#shipping-emirate');
    if (emirate) { emirate.required = !isIndia; if (isIndia) emirate.value = ''; }
    const pin = $('#shipping-pincode');
    if (pin) { pin.required = isIndia; pin.value = isIndia ? '500052' : ''; }
    $('#payment-payu-option')?.classList.toggle('hidden', !isIndia);
    $('#payment-card-option')?.classList.add('hidden');
    $('#payment-upi-option')?.classList.toggle('hidden', !isIndia);
    $('#payment-paytabs-option')?.classList.toggle('hidden', isIndia);
    const paytabs = $('#payment-paytabs-option input');
    const payu = $('#payment-payu-option input');
    const payuQr = $('#payment-upi-option input');
    const cod = $('#payment-cod-option input');
    $('#payment-cod-option')?.classList.toggle('hidden', !state.codReady);
    if (cod) cod.disabled = !state.codReady;
    if (payu) payu.disabled = !(isIndia && state.onlineCheckoutReady);
    if (paytabs) paytabs.disabled = !(!isIndia && state.onlineCheckoutReady);
    if (payuQr) payuQr.disabled = !(isIndia && state.onlineCheckoutReady && state.marketConfig?.paymentQrEnabled);
    $('#payment-upi-option')?.classList.toggle('payment-unavailable', Boolean(payuQr?.disabled));
    const currentPayment = document.querySelector('input[name="payment_method"]:checked');
    if (!currentPayment || currentPayment.disabled || currentPayment.closest('.payment-choice')?.classList.contains('hidden')) {
      if (state.codReady && cod) cod.checked = true;
      else if (isIndia && payu && !payu.disabled) payu.checked = true;
      else if (!isIndia && paytabs && !paytabs.disabled) paytabs.checked = true;
    }
    const selectedPayment = document.querySelector('input[name="payment_method"]:checked')?.value || 'cod';
    const note = $('#checkout-payment-note');
    if (note) note.textContent = selectedPayment === 'cod'
      ? 'Pay in cash when your order is delivered. Order placement is subject to verified stock and delivery coverage.'
      : isIndia ? 'Pay securely with PayU hosted checkout or scan a secure checkout QR. Delivery PIN: 500052.'
      : 'PayTabs hosted checkout. AED pricing, delivery and VAT must be verified before payment.';
    const submit = $('#place-order');
    if (submit) submit.innerHTML = selectedPayment === 'cod' ? 'Place COD order <span>↗</span>' : (isIndia ? 'Continue to PayU <span>↗</span>' : 'Continue to PayTabs <span>↗</span>');
    const cartNote = $('#cart-delivery-note');
    if (cartNote) cartNote.innerHTML = isIndia
      ? 'Delivery is currently limited to PIN code 500052. The delivery fee has not been confirmed and will not be charged until verified. See our <a href="/policies.html#shipping">Shipping Policy</a>.'
      : 'UAE delivery is subject to verified delivery coverage and the fee shown before payment.';
    $('#cart-payu-note')?.classList.toggle('hidden', !isIndia);
  }

  let payuQrPollTimer = null;
  function stopPayuQrPolling() {
    if (payuQrPollTimer) window.clearTimeout(payuQrPollTimer);
    payuQrPollTimer = null;
  }
  function showPayuQrPanel(show) {
    const panel = $('#payu-qr-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !show);
    for (const selector of ['.form-grid', '.payment-options', '.checkout-summary', '#place-order', '.privacy-note']) {
      const element = $('#checkout-form ' + selector);
      if (element) element.classList.toggle('hidden', show);
    }
    if (show) $('#checkout-error')?.classList.add('hidden');
  }
  function startPayuQrPolling(token, expiresAt) {
    stopPayuQrPolling();
    const poll = async () => {
      try {
        if (Date.now() >= Date.parse(expiresAt)) {
          const message = $('#payu-qr-status');
          const action = $('#payu-qr-back');
          if (message) message.textContent = 'This payment QR has expired. Create a fresh checkout QR.';
          if (action) { action.textContent = 'Try again'; action.dataset.action = 'retry'; }
          state.pendingCheckout = null;
          stopPayuQrPolling();
          return;
        }
        const response = await fetch('/api/v1/store/payments/payu/qr-status', {
          method: 'GET', credentials: 'same-origin', cache: 'no-store',
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Unable to check payment status.');
        const result = payload;
        const status = String(result?.data?.status || 'pending');
        const message = $('#payu-qr-status');
        const action = $('#payu-qr-back');
        if (status === 'paid') {
          if (message) message.textContent = 'Payment verified. Order #' + String(result.data.order_number || '') + ' is now being processed.';
          if (action) { action.textContent = 'Continue shopping'; action.dataset.action = 'done'; }
          state.cart = [];
          state.pendingCheckout = null;
          renderCart();
          renderProducts();
          stopPayuQrPolling();
          return;
        }
        if (status === 'review') {
          if (message) message.textContent = 'Payment status needs BF SHOES verification. Do not pay again; your order is under review.';
          if (action) { action.textContent = 'Close'; action.dataset.action = 'done'; }
          stopPayuQrPolling();
          return;
        }
        if (status === 'failed' || status === 'expired') {
          if (message) message.textContent = status === 'expired' ? 'This payment QR has expired. Create a fresh checkout QR.' : 'PayU did not confirm this payment. You can try again.';
          if (action) { action.textContent = 'Try again'; action.dataset.action = 'retry'; }
          state.pendingCheckout = null;
          stopPayuQrPolling();
          return;
        }
        if (message) message.textContent = 'Waiting for secure PayU payment confirmation…';
      } catch {
        const message = $('#payu-qr-status');
        if (message) message.textContent = 'Checking payment status securely…';
      }
      payuQrPollTimer = window.setTimeout(poll, 5000);
    };
    poll();
  }
  $('#payu-qr-back')?.addEventListener('click', () => {
    stopPayuQrPolling();
    const action = $('#payu-qr-back')?.dataset.action || 'close';
    if (action === 'retry') {
      showPayuQrPanel(false);
      return;
    }
    setCheckout(false);
  });

  if (countrySelect) {
    countrySelect.addEventListener('change', () => {
      const phone = $('input[name="customer_phone"]'); if (phone) phone.placeholder = countrySelect.value === 'IN' ? '+91 98765 43210' : '+971 50 000 0000';
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
    loadCheckoutReadiness();
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
      shipping_country: String(formData.get('shipping_country') || state.market),
      shipping_pincode: state.market === 'IN' ? String(formData.get('shipping_pincode') || '') : '',
      shipping_emirate: state.market === 'AE' ? String(formData.get('shipping_emirate') || '') : '',
      payment_method: String(formData.get('payment_method') || (state.market === 'AE' ? 'paytabs' : 'payu')),
      items: state.cart.map(item => ({ sku: item.variant.sku, quantity: item.quantity }))
    };

    const body = JSON.stringify(payload);
    if (!state.pendingCheckout || state.pendingCheckout.body !== body) {
      state.pendingCheckout = { body, key: `web-${randomKey()}` };
    }

    try {
      if (!state.checkoutReady) throw new Error(state.market === 'IN' ? 'India checkout is disabled until PayU merchant credentials, verified prices, delivery fee and GST are configured.' : 'UAE checkout is disabled until PayTabs merchant verification, verified AED prices, delivery fee and VAT are configured.');
      if (payload.payment_method === 'cod') {
        const result = await request(API_BASE + '/orders/cod', {
          method: 'POST',
          headers: { 'Idempotency-Key': state.pendingCheckout.key },
          body: JSON.stringify(payload)
        });
        const orderNumber = result?.data?.order_number;
        if (!orderNumber) throw new Error('COD order confirmation was not returned.');
        state.cart = [];
        state.cartByMarket[state.market] = [];
        persistCart();
        state.pendingCheckout = null;
        renderCart();
        setCheckout(false);
        if ($('#success-order-number')) $('#success-order-number').textContent = String(orderNumber);
        setSuccess(true);
        return;
      }
      if (state.market === 'AE') {
        const result = await request(API_BASE + '/orders/paytabs', {
          method: 'POST',
          headers: { 'Idempotency-Key': state.pendingCheckout.key },
          body: JSON.stringify(payload)
        });
        const checkoutUrl = result?.data?.checkout?.redirect_url;
        let securePayTabsUrl = false;
        try { const parsed = new URL(checkoutUrl); securePayTabsUrl = parsed.protocol === 'https:' && parsed.hostname === 'secure.paytabs.com'; } catch {}
        if (!securePayTabsUrl) throw new Error('PayTabs did not return a valid secure checkout link.');
        window.location.assign(checkoutUrl);
        return;
      }
      const result = await request(API_BASE + '/orders/payu', {
        method: 'POST',
        headers: { 'Idempotency-Key': state.pendingCheckout.key },
        body: JSON.stringify(payload)
      });
      const checkout = result?.data?.checkout;
      if (checkout?.type === 'qr') {
        if (!checkout.qr_data_url || !checkout.token || !checkout.expires_at) throw new Error('PayU did not return a valid secure payment QR.');
        const qrImage = $('#payu-qr-image');
        if (qrImage) qrImage.src = checkout.qr_data_url;
        if ($('#payu-qr-order-number')) $('#payu-qr-order-number').textContent = String(result?.data?.order_number || '—');
        if ($('#payu-qr-expiry')) $('#payu-qr-expiry').textContent = 'QR expires: ' + new Date(checkout.expires_at).toLocaleString();
        if ($('#payu-qr-status')) $('#payu-qr-status').textContent = 'Scan with another phone camera to open the secure PayU checkout page.';
        if ($('#payu-qr-back')) { $('#payu-qr-back').textContent = 'Close QR'; $('#payu-qr-back').dataset.action = 'close'; }
        showPayuQrPanel(true);
        startPayuQrPolling(checkout.token, checkout.expires_at);
        return;
      }
      const allowedPayUActions = ['https://test.payu.in/_payment', 'https://secure.payu.in/_payment'];
      if (!checkout || checkout.method !== 'POST' || !allowedPayUActions.includes(checkout.action) || !checkout.fields || typeof checkout.fields !== 'object' || !checkout.fields.hash || !checkout.fields.txnid) {
        throw new Error('PayU did not return a valid secure checkout request.');
      }
      const payuForm = document.createElement('form');
      payuForm.method = 'POST';
      payuForm.action = checkout.action;
      payuForm.acceptCharset = 'UTF-8';
      for (const [name, value] of Object.entries(checkout.fields)) {
        if (value === undefined || value === null) continue;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = String(value);
        payuForm.append(input);
      }
      document.body.append(payuForm);
      payuForm.submit();
      return;

    } catch (error) {
      showCheckoutError(error.message || 'Failed to place order. Please try again.');
    } finally {
      state.busy = false;
      if(submit) {
        submit.disabled = !state.checkoutReady;
        submit.innerHTML = state.market === 'AE' ? 'Continue to PayTabs <span>↗</span>' : 'Continue to PayU <span>↗</span>';
      }
    }
  });

  $('#account-link')?.addEventListener('click', () => { window.location.href = '/account.html'; });

  $('#market-selector')?.addEventListener('change', event => {
    const nextMarket = event.target.value === 'AE' ? 'AE' : 'IN';
    if (nextMarket === state.market) return;
    state.cartByMarket[state.market] = state.cart;
    persistCart();
    state.market = nextMarket;
    state.cart = state.cartByMarket[state.market] || [];
    state.pendingCheckout = null;
    state.selectedSizes = {};
    try { localStorage.setItem('bf-market', state.market); } catch {}
    const selectedCountry = $('#shipping-country');
    if (selectedCountry) selectedCountry.value = state.market;
    updateCheckoutMarketForm();
    loadProducts();
    loadCheckoutReadiness();
    renderCart();
    toast(state.market === 'IN' ? 'India market selected.' : 'UAE market selected. Checkout is not available yet.');
  });
  if ($('#market-selector')) $('#market-selector').value = state.market;
  updateCheckoutMarketForm();
  renderCart();
  loadCheckoutReadiness();
  loadActiveCampaign();
  syncCustomerWishlist();
  window.addEventListener('bf-customer-session', syncCustomerWishlist);
  let storefrontProductsReady = false;
  function openRequestedOverlay() {
    if (!storefrontProductsReady) return;
    if (window.location.hash === '#cart') {
      setCheckout(false);
      setDrawer(true);
    } else if (window.location.hash === '#checkout') {
      setCheckout(false);
      if (state.cart.length) {
        setDrawer(false);
        setCheckout(true);
      } else {
        setDrawer(true);
        toast('Add a product to your bag before checkout.');
      }
    }
  }
  window.addEventListener('hashchange', openRequestedOverlay);
  loadProducts().then(() => {
    storefrontProductsReady = true;
    openRequestedOverlay();
  });
})();
