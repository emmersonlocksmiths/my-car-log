// Converts rows from a My Car "Costs" export (xlsx/csv) into CarLog entries.
// Export columns: Date, Vehicle, Odometer, Event, Description, Sum, Notes, Driver

// Notes decide the category first ([type, category]); order matters.
const RULES = [
  [/^\s*(\d[\d,]*\s*(km)?\s*)?service\b/i, 'service', 'Scheduled service'],
  [/air ?con/i, 'service', 'Repairs'],
  [/tyre|tire|wheel (align|rot|bal)|wheel$|steering align/i, 'service', 'Tyres'],
  [/(brake|break) ?(globe|light|bulb)/i, 'service', 'Repairs'],
  [/brake|breaks/i, 'service', 'Brakes'],
  [/oil change/i, 'service', 'Oil change'],
  [/battery/i, 'expense', 'Other'],
  [/wiper/i, 'expense', 'Accessories'],
  [/roadworthy|road worthy|diagnostic/i, 'service', 'Repairs'],
  [/\brepair|replace|seal|pipe|headlight|lifter|alternator|coil|globe|bulb/i, 'service', 'Repairs'],
];
// My Car's own categories (the Description column) when the notes don't say.
const MYCAR_CATS = {
  'tax': ['expense', 'Registration'], 'registration': ['expense', 'Registration'], 'insurance': ['expense', 'Insurance'],
  'accessories': ['expense', 'Accessories'], 'parking': ['expense', 'Parking'], 'toll': ['expense', 'Tolls'],
  'fine': ['expense', 'Fines'], 'car wash': ['expense', 'Car wash'], 'washing': ['expense', 'Car wash'],
  'spare parts': ['service', 'Repairs'], 'repair': ['service', 'Repairs'], 'tires': ['service', 'Tyres'], 'tyres': ['service', 'Tyres'],
};

function toISODate(v) {
  if (v instanceof Date) return v.toLocaleDateString('en-CA');
  if (typeof v === 'number') { // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : +String(v).replace(/[^0-9.-]/g, '');
  return isNaN(n) ? null : n;
};

// Small stable hash so re-importing the same file doesn't create duplicates.
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

/**
 * rows: array of objects keyed by the export's header names.
 * Returns { vehicles: [name], entries: [{ importId, vehicleName, ...entry }], skipped: [{row, reason}] }
 */
export function parseMyCar(rows) {
  const entries = [], skipped = [], vehicles = new Set();
  rows.forEach((r, i) => {
    const get = (k) => r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()];
    const date = toISODate(get('Date'));
    const vehicleName = String(get('Vehicle') ?? '').trim() || 'Imported vehicle';
    const event = String(get('Event') ?? '').trim().toLowerCase();
    const cost = num(get('Sum'));
    let odo = num(get('Odometer'));
    if (!odo) odo = null; // My Car stores a blank odometer as 0
    const notes = String(get('Notes') ?? '').trim();
    if (!date) return skipped.push({ row: i + 2, reason: 'no date' });
    if (cost === null) return skipped.push({ row: i + 2, reason: 'no amount' });

    const yes = (v) => /^(y|yes|true|1)$/i.test(String(v ?? '').trim());
    const place = String(get('Place') ?? '').trim();
    const e = { vehicleName, date, odo, cost, notes, place, source: 'mycar' };
    if (event === 'refuel' || event === 'fuel') {
      const full = get('Full tank');
      Object.assign(e, {
        type: 'fuel', litres: num(get('Litres') ?? get('Quantity')),
        fullTank: full === null || full === undefined || full === '' ? true : yes(full),
        missed: yes(get('Missed previous fill')),
      });
    } else {
      // Only the user's own notes say what the job was; Description is My Car's generic label.
      const rule = notes ? RULES.find(([re]) => re.test(notes)) : null;
      const cat = MYCAR_CATS[String(get('Description') ?? '').trim().toLowerCase()];
      if (rule) Object.assign(e, { type: rule[1], category: rule[2] });
      else if (cat) Object.assign(e, { type: cat[0], category: cat[1] });
      else if (event === 'service') Object.assign(e, { type: 'service', category: 'Other service' });
      else Object.assign(e, { type: 'expense', category: 'Other' });
    }
    e.importId = 'mc_' + hash([vehicleName, String(get('Date')), odo, cost, event, notes].join('|'));
    vehicles.add(vehicleName);
    entries.push(e);
  });
  return { vehicles: [...vehicles], entries, skipped };
}
