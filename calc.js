// Pure calculation helpers — no Firebase, no DOM. Easy to test.

const num = (v) => (v === null || v === undefined || v === '' || isNaN(+v) ? null : +v);

function byOdoThenDate(a, b) {
  const ao = num(a.odo), bo = num(b.odo);
  if (ao !== null && bo !== null && ao !== bo) return ao - bo;
  return String(a.date).localeCompare(String(b.date));
}

/**
 * Fuel economy using the full-to-full method.
 * A segment runs from one full fill to the next full fill; every litre added
 * after the first full fill (including partial top-ups) counts towards it.
 * A fill marked `missed` (a fill-up before it wasn't logged) breaks the segment.
 * Returns one point per completed segment: { id, date, odo, distance, litres, l100 }.
 */
export function fuelEconomy(entries) {
  const fills = entries
    .filter((e) => e.type === 'fuel' && num(e.odo) !== null && num(e.litres) !== null)
    .sort(byOdoThenDate);
  const out = [];
  let lastFull = null, litres = 0, broken = false;
  for (const f of fills) {
    const full = f.fullTank !== false;
    if (!lastFull) {
      if (full) { lastFull = f; litres = 0; broken = false; }
      continue;
    }
    litres += +f.litres;
    if (f.missed) broken = true;
    if (full) {
      const distance = +f.odo - +lastFull.odo;
      if (!broken && distance > 0 && litres > 0) {
        out.push({ id: f.id, date: f.date, odo: +f.odo, distance, litres, l100: (litres / distance) * 100 });
      }
      lastFull = f; litres = 0; broken = false;
    }
  }
  return out;
}

export function averageEconomy(points) {
  const d = points.reduce((s, p) => s + p.distance, 0);
  const l = points.reduce((s, p) => s + p.litres, 0);
  return d > 0 ? (l / d) * 100 : null;
}

export function summary(entries) {
  const totals = { fuel: 0, service: 0, expense: 0 };
  let litres = 0, minOdo = null, maxOdo = null;
  for (const e of entries) {
    const c = num(e.cost) || 0;
    if (totals[e.type] !== undefined) totals[e.type] += c;
    if (e.type === 'fuel') litres += num(e.litres) || 0;
    const o = num(e.odo);
    if (o !== null) {
      minOdo = minOdo === null ? o : Math.min(minOdo, o);
      maxOdo = maxOdo === null ? o : Math.max(maxOdo, o);
    }
  }
  const total = totals.fuel + totals.service + totals.expense;
  const distance = minOdo !== null && maxOdo > minOdo ? maxOdo - minOdo : null;
  const points = fuelEconomy(entries);
  return {
    totals, total, litres, distance, lastOdo: maxOdo,
    costPerKm: distance ? total / distance : null,
    fuelCostPerKm: distance ? totals.fuel / distance : null,
    avgL100: averageEconomy(points),
    lastL100: points.length ? points[points.length - 1].l100 : null,
    economyPoints: points,
  };
}

const ym = (d) => String(d).slice(0, 7);

/** Spend per month for the last `months` months ending at `now` (a Date). */
export function monthly(entries, months = 12, now = new Date()) {
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const rows = Object.fromEntries(keys.map((k) => [k, { month: k, fuel: 0, service: 0, expense: 0 }]));
  for (const e of entries) {
    const r = rows[ym(e.date)];
    if (r && r[e.type] !== undefined) r[e.type] += num(e.cost) || 0;
  }
  return keys.map((k) => rows[k]);
}

/** Total spend per category, largest first. Fuel counts as one category. */
export function byCategory(entries) {
  const m = new Map();
  for (const e of entries) {
    const cat = e.type === 'fuel' ? 'Fuel' : e.category || (e.type === 'service' ? 'Service' : 'Other');
    m.set(cat, (m.get(cat) || 0) + (num(e.cost) || 0));
  }
  return [...m.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

/** Price per litre over time, for fills that have both cost and litres. */
export function pricePerLitre(entries) {
  return entries
    .filter((e) => e.type === 'fuel' && num(e.litres) > 0 && num(e.cost) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((e) => ({ date: e.date, ppl: +e.cost / +e.litres }));
}

/** Odometer sanity check: the highest odometer recorded on an earlier date. */
export function maxOdoBefore(entries, date, excludeId) {
  let m = null;
  for (const e of entries) {
    if (e.id === excludeId || num(e.odo) === null) continue;
    if (String(e.date) <= String(date)) m = m === null ? +e.odo : Math.max(m, +e.odo);
  }
  return m;
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(vehicleName, entries) {
  const head = ['Vehicle', 'Date', 'Type', 'Category', 'Odometer (km)', 'Litres', 'Price per litre', 'Cost', 'Full tank', 'Missed previous fill', 'Place', 'Notes'];
  const rows = [...entries]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((e) => [
      vehicleName, e.date, e.type, e.type === 'fuel' ? 'Fuel' : e.category || '', e.odo ?? '',
      e.litres ?? '', e.type === 'fuel' && e.litres > 0 && e.cost > 0 ? (e.cost / e.litres).toFixed(3) : '',
      e.cost ?? '', e.type === 'fuel' ? (e.fullTank !== false ? 'yes' : 'no') : '',
      e.type === 'fuel' ? (e.missed ? 'yes' : 'no') : '', e.place || '', e.notes || '',
    ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
