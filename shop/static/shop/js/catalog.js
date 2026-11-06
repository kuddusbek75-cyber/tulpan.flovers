const FLOWER = '<svg viewBox="0 0 64 64" fill="currentColor"><path d="M32 6c5 6 5 14 0 20-5-6-5-14 0-20Zm0 20c6-5 14-5 20 0-6 5-14 5-20 0Zm0 0c-6-5-14-5-20 0 6 5 14 5 20 0Zm0 0c5 6 5 14 0 20-5-6-5-14 0-20Z" opacity=".9"/><circle cx="32" cy="26" r="4" fill="#1c161a"/><path d="M32 46v14" stroke="currentColor" stroke-width="2.5"/><path d="M32 54c4-4 9-5 13-4-3 4-8 5-13 4Z"/></svg>';
const PRICES = [
  {id: 'all', name: 'Любая цена', test: () => true},
  {id: 'p3', name: 'до 3 000', test: p => p <= 3000},
  {id: 'p6', name: '3 000 – 6 000', test: p => p > 3000 && p <= 6000},
  {id: 'p9', name: '6 000 – 9 000', test: p => p > 6000 && p <= 9000},
  {id: 'p10', name: 'от 9 000', test: p => p > 9000},
];
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const som = n => n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' сом';
const minPrice = p => Math.min(...p.options.map(o => o.price));

let DATA = {shop: {}, categories: [], products: []};
const state = {cat: 'all', price: 'all', q: ''};
const picked = {};   // id товара -> выбранный вариант
let cart = [];
let orderRid = '';   // метка заказа: повторное нажатие не создаёт дубль в CRM
try { cart = JSON.parse(localStorage.getItem('tulpan-cart') || '[]'); } catch (e) {}

function photo(p) {
  return p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">` : FLOWER;
}

function card(p) {
  const i = picked[p.id] || 0;
  const opts = p.options.length > 1 || p.options[0].label
    ? `<div class="opts">${p.options.map((o, k) => `<button class="opt" data-opt="${p.id}:${k}" aria-pressed="${k === i}">${esc(o.label || '—')}</button>`).join('')}</div>` : '';
  return `<article class="card">
    <div class="ph${p.img ? '' : ' empty'}">${photo(p)}${p.hit ? '<span class="hit">Хит</span>' : ''}</div>
    <div class="body">
      <h3>${esc(p.name)}</h3>
      ${p.desc ? `<p class="d">${esc(p.desc)}</p>` : ''}
      ${opts}
      <div class="price">${som(p.options[i].price)}</div>
      <button class="add" data-add="${p.id}">В корзину</button>
    </div>
  </article>`;
}

function renderCats() {
  const tiles = DATA.categories.map(c => {
    const items = DATA.products.filter(p => p.cat === c.id);
    if (!items.length) return '';
    const withImg = items.find(p => p.hit && p.img) || items.find(p => p.img);
    return `<button class="cat" data-go="${c.id}">
      <div class="ph${withImg ? '' : ' empty'}">${withImg ? `<img src="${esc(withImg.img)}" alt="" loading="lazy">` : FLOWER}</div>
      <span>${esc(c.name)} <span aria-hidden="true">→</span></span></button>`;
  }).join('');
  $('#cats').innerHTML = tiles;
  $('#footCats').innerHTML = DATA.categories.map(c => `<li><a href="#catalog" data-go="${c.id}">${esc(c.name)}</a></li>`).join('');
  $('#catChips').innerHTML = [{id: 'all', name: 'Всё'}, ...DATA.categories]
    .map(c => `<button class="chip" data-cat="${c.id}" aria-pressed="${state.cat === c.id}">${esc(c.name)}</button>`).join('');
  $('#priceChips').innerHTML = PRICES.map(p => `<button class="chip" data-price="${p.id}" aria-pressed="${state.price === p.id}">${p.name}</button>`).join('');
}

function renderGrid() {
  const pr = PRICES.find(p => p.id === state.price);
  const q = state.q.toLowerCase();
  const list = DATA.products.filter(p =>
    (state.cat === 'all' || p.cat === state.cat) &&
    pr.test(minPrice(p)) &&
    (!q || (p.name + ' ' + p.desc).toLowerCase().includes(q)));
  $('#grid').innerHTML = list.map(card).join('') || '<p class="empty-msg">Ничего не нашлось — напишите нам в WhatsApp, соберём на заказ.</p>';
  $('#count').textContent = `${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')}`;
  document.querySelectorAll('#catChips .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.cat === state.cat));
  document.querySelectorAll('#priceChips .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.price === state.price));
}

function renderHits() {
  $('#hitsGrid').innerHTML = DATA.products.filter(p => p.hit).slice(0, 4).map(card).join('');
  $('#hits').hidden = !$('#hitsGrid').innerHTML;
}

function plural(n, a, b, c) {
  const m = n % 10, h = n % 100;
  return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c;
}

function renderShop() {
  const s = DATA.shop;
  const wa = `https://wa.me/${s.whatsapp}`;
  $('#waHero').href = wa; $('#waLink').href = wa;
  $('#igLink').href = `https://www.instagram.com/${s.instagram}/`;
  $('#igLink2').href = `https://www.instagram.com/${s.instagram2}/`;
  $('#igLink2').style.display = s.instagram2 ? '' : 'none';
  $('#hoursPerk').innerHTML = `${esc(s.hours)}<br>каждый день`;
  $('#hoursFoot').textContent = s.hours;
  $('#addr').innerHTML = s.addresses.map(a => `<li><a href="https://2gis.kg/search/${encodeURIComponent(a)}" target="_blank" rel="noopener">📍 ${esc(a)}</a></li>`).join('');
  $('#fHow').innerHTML = s.addresses.map(a => `<option>Самовывоз: ${esc(a)}</option>`).join('') + '<option value="delivery">Доставка</option>';
  $('#yr').textContent = new Date().getFullYear();
}

/* корзина */
function saveCart() {
  try { localStorage.setItem('tulpan-cart', JSON.stringify(cart)); } catch (e) {}
  orderRid = '';
  renderCart();
}

function cartLines() {
  // Цены берём из каталога заново: если хозяин поменял цену, в корзине будет новая
  return cart.map(c => {
    const p = DATA.products.find(x => x.id === c.id);
    const o = p && p.options[c.opt];
    return o ? {...c, p, o} : null;
  }).filter(Boolean);
}

function renderCart() {
  const lines = cartLines();
  const n = lines.reduce((s, l) => s + l.q, 0);
  $('#badge').textContent = n; $('#badge').hidden = !n;
  $('#total').textContent = som(lines.reduce((s, l) => s + l.q * l.o.price, 0));
  $('#lines').innerHTML = lines.length ? lines.map((l, i) => `<div class="line">
      <div class="ph${l.p.img ? '' : ' empty'}">${photo(l.p)}</div>
      <div><b>${esc(l.p.name)}</b><small>${l.o.label ? esc(l.o.label) + ' · ' : ''}${som(l.o.price)}</small></div>
      <div class="qty"><button data-q="${i}:-1" aria-label="Меньше">−</button><span>${l.q}</span><button data-q="${i}:1" aria-label="Больше">+</button></div>
    </div>`).join('') : '<p class="cart-empty">Корзина пуста — выберите букет в каталоге 🌷</p>';
  $('#orderForm').hidden = !lines.length;
  $('#send').disabled = !lines.length;
  $('#send').style.opacity = lines.length ? 1 : .5;
}

function addToCart(id) {
  const opt = picked[id] || 0;
  const found = cart.find(c => c.id === id && c.opt === opt);
  if (found) found.q++; else cart.push({id, opt, q: 1});
  saveCart();
  toast('Добавлено в корзину');
}

function toggleCart(open) {
  document.body.classList.toggle('cart-open', open);
  $('#drawer').setAttribute('aria-hidden', !open);
}

function sendOrder() {
  const lines = cartLines();
  if (!lines.length) return;
  const how = $('#fHow').value;
  const total = lines.reduce((s, l) => s + l.q * l.o.price, 0);
  const msg = [
    'Здравствуйте! Хочу сделать заказ с сайта:',
    ...lines.map(l => `• ${l.p.name}${l.o.label ? ' (' + l.o.label + ')' : ''} × ${l.q} — ${som(l.q * l.o.price)}`),
    `Итого: ${som(total)}`,
    $('#fName').value && `Имя: ${$('#fName').value}`,
    $('#fPhone').value && `Телефон: ${$('#fPhone').value}`,
    $('#fWhen').value && `Когда: ${$('#fWhen').value}`,
    how === 'delivery' ? `Доставка: ${$('#fAddr').value || 'адрес уточню'}` : how,
    $('#fCard').value && `Открытка: ${$('#fCard').value}`,
    $('#fNote').value && `Комментарий: ${$('#fNote').value}`,
  ].filter(Boolean).join('\n');
  // Заказ попадает в CRM; если запрос не прошёл, WhatsApp всё равно откроется
  orderRid = orderRid || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  fetch('/api/orders', {
    method: 'POST', keepalive: true,
    headers: {'Content-Type': 'application/json', 'X-CSRFToken': (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''},
    body: JSON.stringify({
      rid: orderRid, items: lines.map(l => ({id: l.id, opt: l.opt, q: l.q})),
      name: $('#fName').value, phone: $('#fPhone').value, when: $('#fWhen').value,
      how: how === 'delivery' ? 'Доставка' : how, addr: how === 'delivery' ? $('#fAddr').value : '',
      card: $('#fCard').value, note: $('#fNote').value,
    }),
  }).catch(() => {});
  window.open(`https://wa.me/${DATA.shop.whatsapp}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
}

let toastTimer;
function toast(t) {
  $('#toast').textContent = t; $('#toast').classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('on'), 1600);
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-opt],[data-add],[data-go],[data-cat],[data-price],[data-q]');
  if (!t) return;
  if (t.dataset.opt) {
    const [id, k] = t.dataset.opt.split(':');
    picked[id] = +k;
    renderGrid(); renderHits();
  } else if (t.dataset.add) {
    addToCart(t.dataset.add);
    t.classList.add('ok'); t.textContent = '✓ В корзине';
    setTimeout(() => { t.classList.remove('ok'); t.textContent = 'В корзину'; }, 1200);
  } else if (t.dataset.go) {
    e.preventDefault();
    state.cat = t.dataset.go; state.price = 'all';
    renderGrid();
    $('#catalog').scrollIntoView();
  } else if (t.dataset.cat) {
    state.cat = t.dataset.cat; renderGrid();
  } else if (t.dataset.price) {
    state.price = t.dataset.price; renderGrid();
  } else if (t.dataset.q) {
    const [i, d] = t.dataset.q.split(':').map(Number);
    const line = cartLines()[i];
    const c = cart.find(x => x.id === line.id && x.opt === line.opt);
    c.q += d;
    if (c.q < 1) cart.splice(cart.indexOf(c), 1);
    saveCart();
  }
});
$('#q').addEventListener('input', e => {
  state.q = e.target.value.trim();
  renderGrid();
  if (state.q && $('#catalog').getBoundingClientRect().top > innerHeight) $('#catalog').scrollIntoView();
});
$('#openCart').onclick = () => toggleCart(true);
$('#closeCart').onclick = $('#scrim').onclick = () => toggleCart(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleCart(false); });
$('#fHow').onchange = e => { $('#addrWrap').hidden = e.target.value !== 'delivery'; };
$('#send').onclick = sendOrder;

fetch('/api/products').then(r => r.json()).then(d => {
  DATA = d;
  renderShop(); renderCats(); renderHits(); renderGrid(); renderCart();
  const go = new URLSearchParams(location.search).get('cat');
  if (go && DATA.categories.some(c => c.id === go)) { state.cat = go; renderGrid(); $('#catalog').scrollIntoView(); }
}).catch(() => { $('#grid').innerHTML = '<p class="empty-msg">Не удалось загрузить каталог. Обновите страницу.</p>'; });
