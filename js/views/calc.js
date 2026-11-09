import { state } from '../db.js';
import { ICONS, attachMoney } from '../ui.js';
import { esc, rs, num } from '../util.js';
import { pageHead } from './parts.js';

// Calculator inputs are kept while the app is open.
const input = {
  pkg: 2, customRate: 0, days: 1,
  albums: 0, highlights: false, overtime: 0, km: 0, locations: 0,
  discPct: 0, discFlat: 0,
  fpd: 2, frate: 10000, albumCost: 0, otherCost: 0, minMargin: null,
};

const roundUp = (v, step = 500) => Math.ceil(v / step) * step;
const roundDown = (v, step = 500) => Math.floor(v / step) * step;

export function computeQuote(s, i) {
  const pkg = s.packages[i.pkg];
  const rate = pkg ? num(pkg.rate) : num(i.customRate);
  const days = Math.max(1, Math.round(num(i.days)));
  const base = rate * days;
  const multiDisc = days >= 4 ? num(s.multiDay4) : days === 3 ? num(s.multiDay3) : 0;
  const travelKm = Math.max(0, num(i.km) - num(s.freeKm));
  const addons = {
    album: num(i.albums) * num(s.addAlbum),
    highlights: i.highlights ? num(s.addHighlights) : 0,
    overtime: num(i.overtime) * num(s.addOvertime),
    travel: travelKm * num(s.addTravelPerKm),
    location: num(i.locations) * num(s.addLocation),
  };
  const addonTotal = Object.values(addons).reduce((a, b) => a + b, 0);
  const listPrice = Math.max(0, base - multiDisc + addonTotal);
  const negotiation = listPrice * num(i.discPct) / 100 + num(i.discFlat);
  const quote = Math.max(0, listPrice - negotiation);

  const cost = num(i.fpd) * num(i.frate) * days + num(i.albumCost) + num(i.otherCost);
  const minMargin = Math.min(95, Math.max(0, i.minMargin ?? num(s.minMargin)));
  const lowest = roundUp(cost / (1 - minMargin / 100));
  const profit = quote - cost;
  const margin = quote > 0 ? (profit / quote) * 100 : 0;

  const table = [0, 5, 10, 15, 20, 25].map((d) => {
    const price = Math.round(listPrice * (1 - d / 100));
    const p = price - cost;
    return { d, price, profit: p, margin: price > 0 ? (p / price) * 100 : 0, ok: price >= lowest };
  });

  const opening = roundUp(listPrice);
  const walkAway = lowest;
  const steps = opening > walkAway ? ladderSteps(opening, walkAway) : null;

  return { rate, days, base, multiDisc, addons, addonTotal, travelKm, listPrice, negotiation, quote, cost, minMargin, lowest, profit, margin, table, opening, walkAway, steps };
}

// Negotiation ladder: the two prices you offer between your opening price and your walk-away price.
// Step 1 = 10% off the opening price, Step 2 = 15% off (5% more).
// Rounded down to whole thousands of rupees and never below the walk-away price.
export const LADDER_PCT = [10, 15];
export function ladderSteps(opening, walkAway) {
  return LADDER_PCT.map((pct) => Math.max(walkAway, roundDown(opening * (1 - pct / 100), 1000)));
}

export function renderCalc(view) {
  const s = state.settings;
  if (input.minMargin === null) input.minMargin = num(s.minMargin);
  const pkgOpts = s.packages.map((p, i) => `<option value="${i}"${input.pkg === i ? ' selected' : ''}>${esc(p.name)} · ${rs(p.rate)}/day</option>`).join('')
    + `<option value="-1"${input.pkg === -1 ? ' selected' : ''}>Custom rate</option>`;
  const money = (name, label) => `<label class="field"><span>${esc(label)}</span><div class="money"><em>Rs.</em><input name="${name}" inputmode="numeric" data-money value="${num(input[name]) ? num(input[name]).toLocaleString('en-US') : ''}" placeholder="0"></div></label>`;
  const count = (name, label, step = '1') => `<label class="field"><span>${esc(label)}</span><input name="${name}" inputmode="${step === '1' ? 'numeric' : 'decimal'}" value="${num(input[name]) || ''}" placeholder="0"></label>`;

  view.innerHTML = `
    ${pageHead('Rate calculator', { backTo: '#/more' })}
    <div class="calc">
      <form class="form" data-form onsubmit="return false">
        <div class="card">
          <h3>Package</h3>
          <div class="form">
            <label class="field"><span>Package</span><select name="pkg">${pkgOpts}</select></label>
            <div data-custom ${input.pkg === -1 ? '' : 'hidden'}>${money('customRate', 'Custom rate per day')}</div>
            ${count('days', 'Number of days')}
          </div>
        </div>
        <div class="card">
          <h3>Add ons</h3>
          <div class="form">
            <div class="grid2">${count('albums', `Extra 10 page albums (${rs(s.addAlbum)} each)`)}${count('overtime', `Overtime hours (${rs(s.addOvertime)}/hr)`)}</div>
            <div class="grid2">${count('km', `Travel distance (km)`)}${count('locations', `Location changes (${rs(s.addLocation)})`)}</div>
            <label class="field check"><input type="checkbox" name="highlights"${input.highlights ? ' checked' : ''}><span>Highlights film (${rs(s.addHighlights)})</span></label>
          </div>
        </div>
        <div class="card">
          <h3>Negotiation discount</h3>
          <div class="grid2">${count('discPct', 'Discount %', 'd')}${money('discFlat', 'Flat discount')}</div>
        </div>
        <div class="card">
          <h3>My costs</h3>
          <div class="form">
            <div class="grid2">${count('fpd', 'Freelancers per day')}${money('frate', 'Freelancer rate per day')}</div>
            <div class="grid2">${money('albumCost', 'Album printing')}${money('otherCost', 'Other costs')}</div>
            ${count('minMargin', 'My minimum margin %', 'd')}
          </div>
        </div>
      </form>
      <div data-out></div>
    </div>
  `;

  const form = view.querySelector('[data-form]');
  form.querySelectorAll('[data-money]').forEach(attachMoney);
  const out = view.querySelector('[data-out]');
  const update = () => {
    const el = form.elements;
    input.pkg = Number(el.pkg.value);
    view.querySelector('[data-custom]').hidden = input.pkg !== -1;
    for (const k of ['customRate', 'days', 'albums', 'overtime', 'km', 'locations', 'discPct', 'discFlat', 'fpd', 'frate', 'albumCost', 'otherCost']) input[k] = num(el[k].value);
    input.minMargin = el.minMargin.value === '' ? num(s.minMargin) : num(el.minMargin.value);
    input.highlights = el.highlights.checked;
    out.innerHTML = resultsHTML(computeQuote(s, input));
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}

function resultsHTML(r) {
  const pct = (v) => `${Math.round(v)}%`;
  const below = r.quote < r.lowest;
  const addonRows = [
    ['Extra albums', r.addons.album], ['Highlights film', r.addons.highlights], ['Overtime', r.addons.overtime],
    [`Travel (${r.travelKm} km)`, r.addons.travel], ['Location change', r.addons.location],
  ].filter(([, v]) => v > 0);

  return `
    <div class="card quote mt" style="background:var(--accent);color:var(--accent-ink);border-color:transparent">
      <small>Final quote</small><strong>${rs(r.quote)}</strong>
      <small>Profit ${rs(r.profit)} · Margin ${pct(r.margin)}</small>
    </div>
    ${below ? `<div class="banner bad">${ICONS.warn}<div>This quote is below your lowest price of ${rs(r.lowest)}.</div></div>` : ''}

    <div class="card mt">
      <h3>Breakdown</h3>
      <dl class="kv">
        <dt>${rs(r.rate)} × ${r.days} day${r.days > 1 ? 's' : ''}</dt><dd>${rs(r.base)}</dd>
        ${r.multiDisc ? `<dt>Multi day discount</dt><dd>- ${rs(r.multiDisc)}</dd>` : ''}
        ${addonRows.map(([l, v]) => `<dt>${esc(l)}</dt><dd>${rs(v)}</dd>`).join('')}
        <div class="sep"></div>
        <dt>Price before negotiation</dt><dd class="strong">${rs(r.listPrice)}</dd>
        ${r.negotiation ? `<dt>Negotiation discount</dt><dd>- ${rs(r.negotiation)}</dd>` : ''}
        <dt>Final quote</dt><dd class="strong">${rs(r.quote)}</dd>
        <div class="sep"></div>
        <dt>My cost</dt><dd>${rs(r.cost)}</dd>
        <dt>Profit</dt><dd class="strong">${rs(r.profit)}</dd>
        <dt>Margin</dt><dd>${pct(r.margin)}</dd>
        <dt>Lowest price to accept</dt><dd class="strong">${rs(r.lowest)}</dd>
      </dl>
      <p class="muted small" style="margin:8px 0 0">Lowest price keeps at least ${pct(r.minMargin)} margin on your cost.</p>
    </div>

    <div class="card mt">
      <h3>Discount check</h3>
      <table class="tbl">
        <thead><tr><th>Discount</th><th>Price</th><th>Profit</th><th></th></tr></thead>
        <tbody>${r.table.map((row) => `<tr>
          <td>${row.d}%</td><td>${rs(row.price).replace('Rs. ', '')}</td><td>${rs(row.profit).replace('Rs. ', '')}</td>
          <td><span class="badge ${row.ok ? 'ok' : 'bad'}">${row.ok ? 'OK' : 'Too low'}</span></td></tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="card mt">
      <h3>Negotiation ladder</h3>
      ${r.opening <= r.walkAway
        ? `<p class="muted small" style="margin:0">Your opening price is already at or below your walk away price. Raise the package or add ons.</p>`
        : `<ol class="ladder">
          <li><span>Opening price</span><strong>${rs(r.opening)}</strong></li>
          ${r.steps ? `<li><span>Step 1 (${LADDER_PCT[0]}% off)</span><strong>${rs(r.steps[0])}</strong></li><li><span>Step 2 (${LADDER_PCT[1]}% off)</span><strong>${rs(r.steps[1])}</strong></li>`
            : `<li><span>Steps 1 and 2</span><span class="small">Not set up yet</span></li>`}
          <li class="walk"><span>Final walk away price</span><strong>${rs(r.walkAway)}</strong></li>
        </ol>`}
    </div>
  `;
}

