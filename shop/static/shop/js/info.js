const CATALOG = '/catalog/';
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const catUrl = cat => (cat ? `${CATALOG}?cat=${encodeURIComponent(cat)}` : CATALOG);
const pic = p => p;

function setLinks() {
  $$('[data-catalog]').forEach(a => { a.href = catUrl(a.dataset.catalog); });
}

function setWhatsapp(number) {
  $$('[data-wa]').forEach(a => { a.href = `https://wa.me/${number}`; });
}

// Если запрос не пройдёт, на странице останется то, что записано в HTML
function applySite({shop, site}) {
  setWhatsapp(shop.whatsapp);
  $('#waText').textContent = `WhatsApp: +${shop.whatsapp.replace(/^(\d{3})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4')}`;
  $('#igText').href = `https://www.instagram.com/${encodeURIComponent(shop.instagram)}/`;
  $('#igText').textContent = `Instagram: @${shop.instagram}`;
  $('#igItem2').hidden = !shop.instagram2;
  $('#igText2').href = `https://www.instagram.com/${encodeURIComponent(shop.instagram2)}/`;
  $('#igText2').textContent = `Instagram (второй филиал): @${shop.instagram2}`;
  $('#hours').textContent = shop.hours;
  $('#addr').innerHTML = shop.addresses.map(a => `<li><a href="https://2gis.kg/search/${encodeURIComponent(a)}" target="_blank" rel="noopener">📍 ${esc(a)}</a></li>`).join('');
  $('.hero-bg').style.backgroundImage = `url("${pic(site.hero)}")`;
  $('#bqs').innerHTML = site.bouquets.map(b => `<article class="bq">
      <div class="pic">${b.img ? `<img src="${esc(pic(b.img))}" alt="${esc(b.name)}" loading="lazy">` : ''}</div>
      <h3>${esc(b.name)}</h3>
      <p>${esc(b.desc)}</p>
      ${b.price ? `<p class="cost">${b.price.toLocaleString('ru-RU')} сом</p>` : ''}
      <a class="btn btn-line" data-catalog="${esc(b.cat)}" href="#">Заказать</a>
    </article>`).join('');
  $$('.more .tile').forEach((el, i) => {
    const t = site.tiles[i];
    if (!t) return;
    el.dataset.catalog = t.cat;
    el.querySelector('img').src = pic(t.img);
    el.querySelector('img').alt = t.title;
    el.querySelector('h3').textContent = t.title;
    el.querySelector('p').textContent = t.text;
  });
  $$('.strip img').forEach((el, i) => { if (site.strip[i]) el.src = pic(site.strip[i]); });
  setLinks();
}

setLinks();
setWhatsapp('996700633602');
fetch('/api/site').then(r => r.json()).then(applySite).catch(() => {});
