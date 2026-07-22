const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

let cachedData = null;

function loadData() {
  if (cachedData) return cachedData;
  const filePath = path.join(__dirname, 'data', 'hotel-packages.xlsx');
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });

  const headerIdx = rows.findIndex(r => r && r[0] === 'Otel');
  const data = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !r[1] || !r[2]) continue; // otel adı + tarih olmayan (boş şablon) satırları atla
    data.push({
      hotel: String(r[0]).trim(),
      start: r[1], end: r[2],
      nights: Number(r[3]),
      rounds: r[4],                 // sayı ya da "Sınırsız"
      view: r[5] || null,           // "Land View" / "Golf View" / "Sea View" / null
      single: r[6] !== null ? Number(r[6]) : null,
      dbl: r[7] !== null ? Number(r[7]) : null,
      group71: r[8] !== null ? Number(r[8]) : null,
      buggyFree: r[9] === 'Evet',
      tokenFree: r[10] === 'Evet',
      transferFree: r[11] === 'Evet'
    });
  }
  cachedData = data;
  return data;
}

// "26.08.2026" formatındaki tarihi karşılaştırılabilir hale getirir
function parseDate(str) {
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = (req, res) => {
  try {
    const { hotel, date, nights, group } = req.query;
    if (!hotel || !date || !nights) {
      res.status(400).json({ error: 'missing_params' });
      return;
    }

    const data = loadData();
    const checkDate = new Date(date + 'T00:00:00');
    const nightsNum = Number(nights);
    const groupSize = group ? Number(group) : 1;

    const matches = data.filter(row => {
      if (row.hotel !== hotel) return false;
      if (row.nights !== nightsNum) return false;
      const start = parseDate(row.start);
      const end = parseDate(row.end);
      return checkDate >= start && checkDate <= end;
    });

    if (matches.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const options = matches.map(m => {
      let price, priceType;
      if (groupSize >= 8 && m.group71 !== null) {
        price = m.group71;
        priceType = 'group71';
      } else if (groupSize >= 2) {
        price = m.dbl;
        priceType = 'double';
      } else {
        price = m.single;
        priceType = 'single';
      }
      return {
        rounds: m.rounds,
        view: m.view,
        price: price !== null ? price + ' €' : null,
        priceType,
        single: m.single !== null ? m.single + ' €' : null,
        double: m.dbl !== null ? m.dbl + ' €' : null,
        group71: m.group71 !== null ? m.group71 + ' €' : null,
        buggyFree: m.buggyFree,
        tokenFree: m.tokenFree,
        transferFree: m.transferFree
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ options });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
};
