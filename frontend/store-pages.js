(() => {
  'use strict';
  const root = document.querySelector('[data-bf-collection]');
  if (!root) return;
  const grid = document.querySelector('#store-page-products');
  const status = document.querySelector('#store-page-status');
  const marketSelect = document.querySelector('#store-page-market');
  const currencyFor = market => market === 'AE' ? 'AED' : 'INR';
  const money = (cents, currency) => new Intl.NumberFormat(currency === 'AED' ? 'en-AE' : 'en-IN', {style:'currency',currency,minimumFractionDigits:2}).format(Number(cents || 0) / 100);
  const safeImage = value => {
    if (typeof value !== 'string' || !value.trim()) return '/assets/bf-product-placeholder.svg';
    try {
      const parsed = new URL(value, window.location.origin);
      if (parsed.origin === window.location.origin || parsed.hostname === 'bf-shoes.vercel.app') {
        return parsed.pathname + parsed.search + parsed.hash;
      }
      return parsed.protocol === 'https:' ? parsed.href : '/assets/bf-product-placeholder.svg';
    } catch {
      return value.startsWith('/') ? value : '/assets/bf-product-placeholder.svg';
    }
  };
  const collection = root.dataset.bfCollection || 'all';
  const matches = product => {
    const category = String(product.category || '').toLowerCase();
    const audience = String(product.audience || '').toLowerCase();
    const type = String(product.product_type || '').toLowerCase();
    const text = [product.name,product.slug,product.description,category,audience,type].join(' ').toLowerCase();
    if (collection === 'all') return true;
    if (collection === 'wishlist') {
      let ids=[]; try { ids=JSON.parse(localStorage.getItem('bf-shoes-wishlist') || '[]').map(String); } catch {}
      return ids.includes(String(product.id));
    }
    if (collection === 'men') return audience === 'men' || audience === 'male' || /(^|[\\s_-])men(?:$|[\\s_-])/.test(category + ' ' + type + ' ' + String(product.slug || '').toLowerCase());
    if (collection === 'kids') return audience === 'kids' || /kids|children/.test(type + ' ' + String(product.slug || '').toLowerCase());
    if (collection === 'women') return audience === 'women' || audience === 'female' || /(^|[\\s_-])women(?:$|[\\s_-])/.test(category + ' ' + type + ' ' + String(product.slug || '').toLowerCase());
    if (collection === 'sports') return /sport|athletic|training/.test(text);
    if (collection === 'running') return /run|jog|performance/.test(text);
    if (collection === 'casual') return /casual|everyday|loafer|slip.on/.test(text);
    if (collection === 'sneakers') return /sneaker|trainer|court/.test(text);
    if (collection === 'formal') return /formal|office|loafer|dress/.test(text);
    if (collection === 'sandals') return /sandal|slide|slipper/.test(text);
    if (collection === 'watches') return /watch|timepiece/.test(text);
    if (collection === 'eyewear') return /eyewear|glasses|sunglass|spectacle/.test(text);
    return true;
  };
  async function load() {
    const market = marketSelect?.value || (() => { try { return localStorage.getItem('bf-market') === 'AE' ? 'AE' : 'IN'; } catch { return 'IN'; } })();
    const currency = currencyFor(market);
    if (status) status.textContent = 'Loading the current BF SHOES collection…';
    if (grid) grid.replaceChildren();
    try {
      const response = await fetch('/api/v1/store/products?market=' + encodeURIComponent(market), {cache:'no-store'});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Products are temporarily unavailable.');
      let products = (body.data || []).filter(p => p.currency === currency && matches(p));
      if (root.dataset.sort === 'new') products.sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      if (!products.length) {
        if (status) status.textContent = collection === 'wishlist' ? 'No saved products are available in this market yet.' : 'No products match this collection right now.';
        return;
      }
      for (const product of products) {
        const card = document.createElement('article'); card.className = 'store-page-product';
        const image = document.createElement('img'); image.src = safeImage(product.image_url); image.alt = product.name || 'BF SHOES product'; image.loading = 'lazy'; image.decoding = 'async';
        const title = document.createElement('h3'); title.textContent = product.name || 'BF SHOES';
        const description = document.createElement('p'); description.textContent = String(product.short_description || product.description || 'Explore product details in the BF SHOES store.').slice(0,150);
        const price = document.createElement('strong'); price.textContent = product.price_verified ? money(product.price_cents,currency) : 'Price verification pending';
        const stock = (product.variants || []).some(v => v.stock_verified && Number(v.stock_qty) > 0);
        const availability = document.createElement('div'); availability.className='store-page-status'; availability.textContent = stock ? 'Verified stock shown in the store' : 'Stock availability requires verification';
        const link = document.createElement('a'); link.className='store-page-button'; link.href='/?market=' + market + '#shop'; link.textContent='Explore in store';
        card.append(image,title,description,price,availability,link); grid.append(card);
      }
      if (status) status.textContent = products.length + ' product' + (products.length === 1 ? '' : 's') + ' in this collection · ' + currency;
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not load the collection. Please try again.';
      if (grid) { const note=document.createElement('div'); note.className='store-page-empty'; note.textContent='The catalogue could not be reached. You can return to the main BF SHOES store and retry.'; grid.append(note); }
    }
  }
  if (marketSelect) {
    const requestedMarket = new URLSearchParams(window.location.search).get('market');
    let initialMarket = requestedMarket === 'AE' ? 'AE' : 'IN';
    try {
      if (requestedMarket === 'IN' || requestedMarket === 'AE') localStorage.setItem('bf-market', initialMarket);
      else initialMarket = localStorage.getItem('bf-market') === 'AE' ? 'AE' : 'IN';
    } catch {}
    marketSelect.value = initialMarket;
    marketSelect.addEventListener('change', () => {
      try { localStorage.setItem('bf-market', marketSelect.value); } catch {}
      load();
    });
  }
  load();
})();
