const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let DATA = null;
let editing = null;   // товар в окне редактирования (копия)

const API = document.body.dataset.api;
const csrf = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';

async function api(path, method = 'GET', body) {
  const r = await fetch(API + path, {
    method, credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf()},
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) { location.reload(); throw new Error('auth'); }
  if (!r.ok) throw new Error(d.error || 'Ошибка сервера');
  return d;
}

function toast(t, bad) {
  const el = $('#toast');
  el.textContent = t; el.className = 'toast on' + (bad ? ' bad' : '');
  clearTimeout(el._t); el._t = setTimeout(() => el.className = 'toast', 2000);
}

async function start() {
  try {
    DATA = await api('data');
  } catch (e) {
    if (e.message !== 'auth') toast(e.message, true);
    return;
  }
  $('#app').hidden = false;
  const opts = DATA.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#catFilter').innerHTML = '<option value="">Все категории</option>' + opts;
  $('#eCat').innerHTML = opts;
  $('#oStatus').innerHTML = Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#oSource').innerHTML = Object.entries(SOURCE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#prodList').innerHTML = DATA.products.flatMap(p => p.options.map(o => `<option value="${esc(itemTitle(p.name, o.label))}"></option>`)).join('');
  $('#infoLink').href = DATA.infoUrl;
  fillShop();
  renderList();
  loadSite();
  await loadCrm();
  if (!crmTimer) crmTimer = setInterval(() => loadCrm().catch(() => {}), 30000);
}

const catName = id => (DATA.categories.find(c => c.id === id) || {}).name || id;

function renderList() {
  const q = $('#q').value.trim().toLowerCase();
  const cat = $('#catFilter').value;
  const items = DATA.products.filter(p => (!cat || p.cat === cat) && (!q || p.name.toLowerCase().includes(q)));
  $('#list').innerHTML = items.map(p => `
    <div class="row${p.active ? '' : ' off'}" data-id="${p.id}">
      ${p.img ? `<img class="thumb" src="${esc(p.img)}" alt="">` : '<div class="thumb none">🌷</div>'}
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="cat">${esc(catName(p.cat))}${p.hit ? ' · ⭐ хит' : ''}</div>
        <div class="prices">${p.options.map((o, i) => `
          <label class="pr">${o.label ? `<span>${esc(o.label)}</span>` : ''}<input type="number" min="0" step="10" inputmode="numeric" value="${o.price}" data-i="${i}" aria-label="Цена ${esc(o.label)}"><em>сом</em></label>`).join('')}
        </div>
        <div class="flags"><label><input type="checkbox" data-flag="active" ${p.active ? 'checked' : ''}> На сайте</label><label><input type="checkbox" data-flag="hit" ${p.hit ? 'checked' : ''}> Хит</label></div>
      </div>
      <div class="acts">
        <button class="btn btn-pink" data-save disabled>Сохранить</button>
        <button class="btn btn-line" data-edit>Изменить</button>
      </div>
    </div>`).join('') || '<p class="hint">Ничего не найдено</p>';
}

$('#list').addEventListener('input', e => {
  const row = e.target.closest('.row');
  if (row) { row.classList.add('dirty'); row.querySelector('[data-save]').disabled = false; }
});

$('#list').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('.pr input')) e.target.closest('.row').querySelector('[data-save]').click();
});

$('#list').addEventListener('click', async e => {
  const row = e.target.closest('.row');
  if (!row) return;
  const p = DATA.products.find(x => x.id === row.dataset.id);
  if (e.target.closest('[data-edit]')) return openEditor(p);
  if (!e.target.closest('[data-save]')) return;
  const upd = structuredClone(p);
  row.querySelectorAll('.pr input').forEach(inp => { upd.options[+inp.dataset.i].price = Math.max(0, Math.round(+inp.value || 0)); });
  row.querySelectorAll('[data-flag]').forEach(cb => { upd[cb.dataset.flag] = cb.checked; });
  try {
    Object.assign(p, await api('products/' + p.id, 'PUT', upd));
    toast('Сохранено ✓');
    renderList();
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
});

$('#q').oninput = renderList;
$('#catFilter').onchange = renderList;

/* окно товара */
function openEditor(p) {
  editing = p ? structuredClone(p) : {id: null, cat: $('#catFilter').value || DATA.categories[0].id, name: '', desc: '', img: '', options: [{label: '', price: 0}], hit: false, active: true};
  $('#dlgTitle').textContent = p ? 'Изменить товар' : 'Новый товар';
  $('#eName').value = editing.name;
  $('#eCat').value = editing.cat;
  $('#eDesc').value = editing.desc;
  $('#eActive').checked = editing.active;
  $('#eHit').checked = editing.hit;
  $('#delBtn').hidden = !p;
  renderPhoto(); renderOpts();
  $('#dlg').showModal();
}

function renderPhoto() {
  $('#photoPrev').innerHTML = editing.img ? `<img src="${esc(editing.img)}" alt="">` : '<div class="none">🌷</div>';
}

function renderOpts() {
  $('#eOpts').innerHTML = editing.options.map((o, i) => `
    <div class="opt-row">
      <input placeholder="Напр.: 25 шт, 50 см, M" value="${esc(o.label)}" data-l="${i}">
      <input type="number" min="0" step="10" inputmode="numeric" value="${o.price}" data-p="${i}" aria-label="Цена, сом">
      <button type="button" class="del-opt" data-del="${i}" aria-label="Удалить вариант" ${editing.options.length < 2 ? 'disabled' : ''}>✕</button>
    </div>`).join('');
}

$('#eOpts').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.l) editing.options[+t.dataset.l].label = t.value;
  if (t.dataset.p) editing.options[+t.dataset.p].price = Math.max(0, Math.round(+t.value || 0));
});
$('#eOpts').addEventListener('click', e => {
  const b = e.target.closest('[data-del]');
  if (b && editing.options.length > 1) { editing.options.splice(+b.dataset.del, 1); renderOpts(); }
});
$('#addOpt').onclick = () => { if (editing.options.length < 8) { editing.options.push({label: '', price: 0}); renderOpts(); } };
$('#noPhoto').onclick = () => { editing.img = ''; renderPhoto(); };
$('#cancelBtn').onclick = () => $('#dlg').close();

// Сжимаем фото в браузере: с телефона приходят снимки по 5–10 МБ
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1200 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Не получилось открыть фото'));
    img.src = URL.createObjectURL(file);
  });
}

$('#file').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    toast('Загружаю фото…');
    editing.img = (await api('upload', 'POST', {data: await shrink(f)})).img;
    renderPhoto();
    toast('Фото загружено ✓');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
};

$('#saveBtn').onclick = async () => {
  editing.name = $('#eName').value.trim();
  editing.cat = $('#eCat').value;
  editing.desc = $('#eDesc').value.trim();
  editing.active = $('#eActive').checked;
  editing.hit = $('#eHit').checked;
  if (!editing.name) { $('#eName').focus(); return toast('Напишите название', true); }
  try {
    if (editing.id) {
      const saved = await api('products/' + editing.id, 'PUT', editing);
      Object.assign(DATA.products.find(x => x.id === editing.id), saved);
    } else {
      DATA.products.unshift(await api('products', 'POST', editing));
    }
    $('#dlg').close();
    renderList();
    toast('Сохранено ✓');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
};

$('#delBtn').onclick = async () => {
  if (!confirm(`Удалить «${editing.name}» с сайта?`)) return;
  try {
    await api('products/' + editing.id, 'DELETE');
    DATA.products = DATA.products.filter(x => x.id !== editing.id);
    $('#dlg').close();
    renderList();
    toast('Товар удалён');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
};
$('#addBtn').onclick = () => openEditor(null);

/* заказы */
const STATUS = {new: 'Новый', confirmed: 'Подтверждён', making: 'Собираем', ready: 'Готов', done: 'Выполнен', canceled: 'Отменён'};
const SOURCE = {site: 'Сайт', whatsapp: 'WhatsApp', instagram: 'Instagram', phone: 'Звонок', shop: 'В магазине'};
const ACTIVE = ['new', 'confirmed', 'making', 'ready'];
const som = n => (n || 0).toLocaleString('ru-RU') + ' сом';
const itemTitle = (name, label) => (label ? `${name} (${label})` : name);
const dateText = ts => new Date(ts * 1000).toLocaleString('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const waDigits = phone => {
  const d = String(phone).replace(/\D/g, '');
  return d.length === 10 && d[0] === '0' ? '996' + d.slice(1) : d.length === 9 ? '996' + d : d;
};
let CRM = {orders: [], clients: {}};
let crmTimer = null;
let orderFilter = 'all';
let ordEditing = null;
let clEditing = null;

async function loadCrm() {
  const known = new Set(CRM.orders.map(o => o.id));
  const first = !known.size;
  CRM = await api('crm');
  const fresh = CRM.orders.filter(o => !known.has(o.id)).length;
  if (fresh && !first) toast(`Новых заказов: ${fresh}`);
  renderCrm();
}

function renderCrm() {
  renderStats();
  renderOrders();
  renderClients();
  const n = CRM.orders.filter(o => o.status === 'new').length;
  $('#newDot').textContent = n; $('#newDot').hidden = !n;
}

function renderStats() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const done = CRM.orders.filter(o => o.status === 'done' && o.ts >= monthStart);
  const sum = done.reduce((s, o) => s + o.total, 0);
  const cards = [
    [CRM.orders.filter(o => o.ts >= dayStart && o.status !== 'canceled').length, 'заказов сегодня'],
    [CRM.orders.filter(o => ACTIVE.includes(o.status)).length, 'в работе'],
    [som(sum), 'выручка за месяц'],
    [som(done.length ? Math.round(sum / done.length) : 0), 'средний чек'],
  ];
  $('#stats').innerHTML = cards.map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${s}</span></div>`).join('');
}

function renderOrders() {
  $('#statusChips').innerHTML = [['all', 'Все'], ['active', 'В работе'], ...Object.entries(STATUS)]
    .map(([k, v]) => `<button class="chip" data-st="${k}" aria-pressed="${orderFilter === k}">${v}</button>`).join('');
  const q = $('#oq').value.trim().toLowerCase();
  const list = CRM.orders.filter(o =>
    (orderFilter === 'all' || (orderFilter === 'active' ? ACTIVE.includes(o.status) : o.status === orderFilter)) &&
    (!q || `${o.n} ${o.name} ${o.phone} ${o.items.map(i => i.name).join(' ')}`.toLowerCase().includes(q)));
  $('#orders').innerHTML = list.map(o => `
    <article class="ord${o.status === 'new' ? ' is-new' : ''}${o.status === 'canceled' ? ' is-off' : ''}" data-id="${o.id}">
      <div>
        <h3>№${o.n} · ${esc(o.name || 'Без имени')}</h3>
        <div class="meta">${dateText(o.ts)} · ${esc(SOURCE[o.source] || o.source)}${o.phone ? ' · ' + esc(o.phone) : ''}${o.when ? ' · к: ' + esc(o.when) : ''}</div>
        <div class="what">${o.items.map(i => `${esc(itemTitle(i.name, i.label))} × ${i.q}`).join(', ')}</div>
        ${o.how ? `<div class="meta">${esc(o.how)}${o.addr ? ': ' + esc(o.addr) : ''}</div>` : ''}
      </div>
      <div class="ord-side">
        <div class="sum">${som(o.total)}</div>
        <select data-status aria-label="Статус заказа">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === o.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
        ${waDigits(o.phone) ? `<a class="btn btn-line" data-wa href="https://wa.me/${waDigits(o.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      </div>
    </article>`).join('') || `<p class="hint">${CRM.orders.length ? 'Ничего не найдено' : 'Заказов пока нет. Они появятся здесь, когда покупатель отправит корзину в WhatsApp. Заказ по телефону или из Instagram можно добавить кнопкой «Новый заказ».'}</p>`;
}

$('#statusChips').addEventListener('click', e => {
  const b = e.target.closest('[data-st]');
  if (b) { orderFilter = b.dataset.st; renderOrders(); }
});
$('#oq').oninput = renderOrders;

$('#orders').addEventListener('click', e => {
  if (e.target.closest('[data-status],[data-wa]')) return;
  const card = e.target.closest('.ord');
  if (card) openOrder(CRM.orders.find(o => o.id === card.dataset.id));
});

$('#orders').addEventListener('change', async e => {
  if (!e.target.matches('[data-status]')) return;
  const o = CRM.orders.find(x => x.id === e.target.closest('.ord').dataset.id);
  try {
    Object.assign(o, await api('orders/' + o.id, 'PUT', {...o, status: e.target.value}));
    toast('Статус обновлён ✓');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
  renderCrm();
});

function openOrder(o, preset) {
  ordEditing = o ? structuredClone(o) : {id: null, status: 'confirmed', source: 'whatsapp', name: '', phone: '', when: '', how: '', addr: '', card: '', note: '', memo: '', items: [{name: '', label: '', q: 1, price: 0}], ...preset};
  // Название и вариант редактируются одной строкой
  ordEditing.items = ordEditing.items.map(i => ({...i, name: itemTitle(i.name, i.label), label: ''}));
  $('#ordTitle').textContent = o ? `Заказ №${o.n}` : 'Новый заказ';
  [['oStatus', 'status'], ['oSource', 'source'], ['oName', 'name'], ['oPhone', 'phone'], ['oWhen', 'when'], ['oHow', 'how'],
   ['oAddr', 'addr'], ['oCard', 'card'], ['oNote', 'note'], ['oMemo', 'memo']].forEach(([id, k]) => { $('#' + id).value = ordEditing[k]; });
  $('#oDel').hidden = !o;
  renderItems();
  $('#ordDlg').showModal();
}

function renderItems() {
  $('#oItems').innerHTML = ordEditing.items.map((it, i) => `
    <div class="item-row">
      <input list="prodList" placeholder="Букет, игрушка…" value="${esc(it.name)}" data-n="${i}" aria-label="Название">
      <input type="number" min="1" value="${it.q}" data-q="${i}" aria-label="Количество">
      <input type="number" min="0" step="10" value="${it.price}" data-p="${i}" aria-label="Цена за штуку, сом">
      <button type="button" class="del-opt" data-del="${i}" aria-label="Удалить позицию" ${ordEditing.items.length < 2 ? 'disabled' : ''}>✕</button>
    </div>`).join('');
  renderOrderTotal();
}

function renderOrderTotal() {
  $('#oTotal').textContent = som(ordEditing.items.reduce((s, i) => s + i.q * i.price, 0));
}

function catalogPrice(title) {
  for (const p of DATA.products) for (const o of p.options) if (itemTitle(p.name, o.label) === title) return o.price;
  return null;
}

$('#oItems').addEventListener('input', e => {
  const t = e.target, d = t.dataset;
  if (d.n) {
    const it = ordEditing.items[+d.n];
    it.name = t.value;
    const price = catalogPrice(t.value);
    if (price !== null) { it.price = price; t.closest('.item-row').querySelector('[data-p]').value = price; }
  }
  if (d.q) ordEditing.items[+d.q].q = Math.max(1, Math.round(+t.value || 1));
  if (d.p) ordEditing.items[+d.p].price = Math.max(0, Math.round(+t.value || 0));
  renderOrderTotal();
});
$('#oItems').addEventListener('click', e => {
  const b = e.target.closest('[data-del]');
  if (b && ordEditing.items.length > 1) { ordEditing.items.splice(+b.dataset.del, 1); renderItems(); }
});
$('#addItem').onclick = () => { if (ordEditing.items.length < 30) { ordEditing.items.push({name: '', label: '', q: 1, price: 0}); renderItems(); } };
$('#oCancel').onclick = () => $('#ordDlg').close();
$('#addOrder').onclick = () => openOrder(null);

$('#oSave').onclick = async () => {
  const body = {...ordEditing, status: $('#oStatus').value, source: $('#oSource').value, name: $('#oName').value, phone: $('#oPhone').value,
    when: $('#oWhen').value, how: $('#oHow').value, addr: $('#oAddr').value, card: $('#oCard').value, note: $('#oNote').value, memo: $('#oMemo').value};
  try {
    if (body.id) await api('orders/' + body.id, 'PUT', body);
    else await api('orders', 'POST', body);
    $('#ordDlg').close();
    await loadCrm();
    toast('Сохранено ✓');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
};

$('#oDel').onclick = async () => {
  if (!confirm(`Удалить заказ №${ordEditing.n}? Вернуть его будет нельзя.`)) return;
  try {
    await api('orders/' + ordEditing.id, 'DELETE');
    $('#ordDlg').close();
    await loadCrm();
    toast('Заказ удалён');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
};

/* клиенты: собираем из заказов, один человек — один номер телефона */
function clientList() {
  const map = new Map();
  for (const o of CRM.orders) {   // заказы идут от новых к старым
    if (!o.key) continue;
    if (!map.has(o.key)) map.set(o.key, {key: o.key, name: o.name, phone: o.phone, orders: [], sum: 0, last: o.ts});
    const c = map.get(o.key);
    c.name = c.name || o.name; c.phone = c.phone || o.phone;
    c.orders.push(o);
    if (o.status !== 'canceled') c.sum += o.total;
  }
  return [...map.values()].sort((a, b) => b.last - a.last);
}

function renderClients() {
  const q = $('#cq').value.trim().toLowerCase();
  const list = clientList().filter(c => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q));
  $('#clients').innerHTML = list.map(c => `
    <article class="ord cl" data-key="${esc(c.key)}">
      <div>
        <h3>${esc(c.name || 'Без имени')}</h3>
        <div class="meta">${c.phone ? esc(c.phone) + ' · ' : ''}заказов: ${c.orders.length} · последний ${dateText(c.last)}</div>
        ${(CRM.clients[c.key] || {}).note ? `<div class="what">${esc(CRM.clients[c.key].note)}</div>` : ''}
      </div>
      <div class="sum">${som(c.sum)}</div>
    </article>`).join('') || `<p class="hint">${CRM.orders.length ? 'Ничего не найдено' : 'Клиенты появятся здесь автоматически из заказов.'}</p>`;
}

$('#cq').oninput = renderClients;
$('#clients').addEventListener('click', e => {
  const card = e.target.closest('.ord');
  if (!card) return;
  clEditing = clientList().find(c => c.key === card.dataset.key);
  $('#clName').textContent = clEditing.name || 'Без имени';
  $('#clInfo').textContent = `${clEditing.phone || 'Телефона нет'} · заказов: ${clEditing.orders.length} · всего ${som(clEditing.sum)}`;
  $('#clNote').value = (CRM.clients[clEditing.key] || {}).note || '';
  $('#clHist').innerHTML = clEditing.orders.map(o => `<div><span>№${o.n} · ${dateText(o.ts)} · ${esc(STATUS[o.status])}</span><b>${som(o.total)}</b></div>`).join('');
  $('#clDlg').showModal();
});
$('#clCancel').onclick = () => $('#clDlg').close();
$('#clNew').onclick = () => {
  $('#clDlg').close();
  openOrder(null, {name: clEditing.name, phone: clEditing.phone});
};
$('#clSave').onclick = async () => {
  try {
    await api('client', 'PUT', {key: clEditing.key, note: $('#clNote').value});
    CRM.clients[clEditing.key] = {note: $('#clNote').value.trim()};
    $('#clDlg').close();
    renderClients();
    toast('Сохранено ✓');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
};

/* инфо-сайт */
let SITE = null;

function loadSite() {
  SITE = structuredClone(DATA.site);
  renderSite();
}

function shot(path, src) {
  return `<div class="shot">
    ${src ? `<img src="${esc(src)}" alt="">` : '<div class="none">🌷</div>'}
    <label class="btn btn-line">Своё фото<input type="file" accept="image/*" hidden data-photo="${path}"></label>
  </div>`;
}

function catSelect(path, value) {
  return `<select data-f="${path}" aria-label="Раздел каталога">${DATA.categories.map(c => `<option value="${c.id}"${c.id === value ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
}

function linkSelect(i, b) {
  const items = DATA.products.flatMap(p => p.options.map((o, k) => {
    const value = `${p.id}:${k}`;
    const on = b.product === p.id && (b.opt || 0) === k;
    return `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(itemTitle(p.name, o.label))} — ${som(o.price)}${p.active ? '' : ' (скрыт)'}</option>`;
  }));
  return `<select data-link="${i}"><option value="">Своя цена</option>${items.join('')}</select>`;
}

function linkNotice(b) {
  if (!b.product) return '';
  const p = DATA.products.find(x => x.id === b.product);
  const o = p && p.options[b.opt || 0];
  if (!o) return '<div class="hint" style="padding:0;color:var(--bad)">Товар удалён из каталога, цена на сайте не показывается. Выберите другой.</div>';
  if (!p.active) return '<div class="hint" style="padding:0;color:var(--bad)">Товар скрыт в каталоге, цена на сайте не показывается.</div>';
  return `<div class="hint" style="padding:0">На сайте: ${som(o.price)}. Цена меняется во вкладке «Товары и цены».</div>`;
}

function renderSite() {
  $('#siteForm').innerHTML = `
    <section class="block">
      <h2>Букеты</h2>
      <p>Цена берётся из выбранного товара каталога и меняется вместе с ним. Если выбрать «Своя цена», её можно задать здесь, а при 0 цены на карточке не будет.</p>
      ${SITE.bouquets.map((b, i) => `<div class="edit-card">
        ${shot('bouquets.' + i + '.img', b.img)}
        <div class="fields">
          <label>Название<input data-f="bouquets.${i}.name" value="${esc(b.name)}" maxlength="80"></label>
          <label>Описание<input data-f="bouquets.${i}.desc" value="${esc(b.desc)}" maxlength="160"></label>
          <label>Товар из каталога${linkSelect(i, b)}</label>
          ${linkNotice(b)}
          ${b.product ? '' : `<div class="two">
            <label>Цена, сом<input type="number" min="0" step="10" inputmode="numeric" data-f="bouquets.${i}.price" data-num value="${b.price}"></label>
            <label>Кнопка «Заказать» ведёт в раздел${catSelect('bouquets.' + i + '.cat', b.cat)}</label>
          </div>`}
          ${SITE.bouquets.length > 1 ? `<div><button type="button" class="btn btn-bad" data-rm="${i}">Убрать букет</button></div>` : ''}
        </div>
      </div>`).join('')}
    </section>
    <section class="block">
      <h2>Главное фото</h2>
      <div class="edit-card">${shot('hero', SITE.hero)}<div class="hint">Размытый фон на первом экране сайта.</div></div>
    </section>
    <section class="block">
      <h2>Плитки</h2>
      ${SITE.tiles.map((t, i) => `<div class="edit-card">
        ${shot('tiles.' + i + '.img', t.img)}
        <div class="fields">
          <label>Заголовок<input data-f="tiles.${i}.title" value="${esc(t.title)}" maxlength="60"></label>
          <label>Текст<input data-f="tiles.${i}.text" value="${esc(t.text)}" maxlength="160"></label>
          <label>Ведёт в раздел${catSelect('tiles.' + i + '.cat', t.cat)}</label>
        </div>
      </div>`).join('')}
    </section>
    <section class="block">
      <h2>Лента фотографий</h2>
      <div class="strip-grid">${SITE.strip.map((p, i) => shot('strip.' + i, p)).join('')}</div>
    </section>`;
}

function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], SITE)[last] = value;
}

const siteDirty = () => { $('#saveSite').disabled = false; };

$('#siteForm').addEventListener('input', e => {
  const t = e.target;
  if (!t.dataset.f) return;
  setPath(t.dataset.f, 'num' in t.dataset ? Math.max(0, Math.round(+t.value || 0)) : t.value);
  siteDirty();
});

$('#siteForm').addEventListener('click', e => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  SITE.bouquets.splice(+b.dataset.rm, 1);
  renderSite(); siteDirty();
});

$('#siteForm').addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.link) {
    const b = SITE.bouquets[+t.dataset.link];
    const [product, opt] = t.value.split(':');
    b.product = product || ''; b.opt = +opt || 0;
    renderSite(); siteDirty();
    return;
  }
  if (!t.dataset.photo) return;
  const f = t.files[0];
  if (!f) return;
  try {
    toast('Загружаю фото…');
    setPath(t.dataset.photo, (await api('upload', 'POST', {data: await shrink(f)})).img);
    renderSite(); siteDirty();
    toast('Фото загружено. Нажмите «Сохранить изменения»');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
});

$('#addBq').onclick = () => {
  if (SITE.bouquets.length >= 12) return toast('Можно до 12 букетов', true);
  SITE.bouquets.push({name: 'Новый букет', desc: '', img: '', price: 0, cat: DATA.categories[0].id, product: '', opt: 0});
  renderSite(); siteDirty();
};

$('#saveSite').onclick = async () => {
  try {
    DATA.site = await api('site', 'PUT', SITE);
    loadSite();
    $('#saveSite').disabled = true;
    toast('Сохранено, сайт обновлён ✓');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
};

/* вкладки и данные магазина */
const TABS = ['orders', 'clients', 'products', 'site', 'shop'];
document.querySelectorAll('[data-tab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === t));
  TABS.forEach(name => { $('#tab-' + name).hidden = t.dataset.tab !== name; });
  if (t.dataset.tab === 'site') renderSite();   // цены товаров могли поменяться
});

function fillShop() {
  const f = $('#shopForm'), s = DATA.shop;
  f.name.value = s.name; f.whatsapp.value = s.whatsapp; f.instagram.value = s.instagram; f.instagram2.value = s.instagram2 || '';
  f.hours.value = s.hours; f.addresses.value = s.addresses.join('\n');
}

$('#shopForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    DATA.shop = await api('shop', 'PUT', {name: f.name.value, whatsapp: f.whatsapp.value, instagram: f.instagram.value, instagram2: f.instagram2.value,
      hours: f.hours.value, addresses: f.addresses.value.split('\n')});
    fillShop();
    toast('Сохранено ✓');
  } catch (err) { if (err.message !== 'auth') toast(err.message, true); }
};

start();
