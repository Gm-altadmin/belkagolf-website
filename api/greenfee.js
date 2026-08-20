const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const GF_MARKUP = 11;       // Green Fee / Otel Misafiri fiyatına eklenen sabit kâr payı (€)
const GF_SHUTTLE_PRICE = 30; // Gidiş-dönüş shuttle ücreti (€)
const AI_TRUE_VALUES = ['evet', 'yes', 'dahil', 'included', 'da', 'ja'];

let cachedData = null;

function parseSheetRows(rows) {
  const headerIdx = rows.findIndex(r => r && r[0] === 'Golf Sahası');
  if (headerIdx === -1) return []; // bu sayfada veri tablosu yok (örn. Özet-Index sayfası)

  const data = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !r[1] || !r[2]) continue;
    const start = new Date(r[1]);
    const end = new Date(r[2]);
    if (isNaN(start) || isNaN(end)) continue;
    data.push({
      course: String(r[0]).trim(),
      start, end,
      greenFee: r[3],
      specialRate: r[4],
      hotelRate: r[5],
      token: r[6],
      buggy: r[7],
      trolley: r[8],
      allInclusive: r[9]
    });
  }
  return data;
}

function loadData() {
  if (cachedData) return cachedData;
  const filePath = path.join(__dirname, 'data', 'greenfee-prices.xlsx');
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });

  // Dosyadaki TÜM sayfaları tara (her golf kulübü/sahası kendi sayfasında olabilir).
  // "Golf Sahası" başlıklı veri tablosu içermeyen sayfalar (örn. Özet-Index) otomatik atlanır.
  let data = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
    data = data.concat(parseSheetRows(rows));
  }

  cachedData = data;
  return data;
}

function fmtPrice(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!isNaN(n) && v !== '') return n + ' €';
  return String(v);
}
function markedNumeric(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return n + GF_MARKUP;
}
function fmtMarked(v) {
  const n = markedNumeric(v);
  if (n !== null) return n + ' €';
  if (v === null || v === undefined || v === '') return null;
  return String(v); // "Dahil" vb. metinlere kâr payı eklenemez
}

module.exports = (req, res) => {
  try {
    const { course, date, shuttle } = req.query;
    if (!course || !date) {
      res.status(400).json({ error: 'missing_params' });
      return;
    }

    const data = loadData();
    const d = new Date(date + 'T00:00:00');
    const match = data.find(row => row.course === course && d >= row.start && d <= row.end);

    if (!match) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const gfNumeric = markedNumeric(match.greenFee) ?? markedNumeric(match.specialRate);
    const gfText = fmtMarked(match.greenFee) || fmtMarked(match.specialRate);
    const hotelText = fmtMarked(match.hotelRate);
    const aiVal = match.allInclusive ? String(match.allInclusive).trim().toLowerCase() : '';
    const allInclusive = AI_TRUE_VALUES.includes(aiVal);

    let total = null;
    if (shuttle === '1' && gfNumeric !== null) total = (gfNumeric + GF_SHUTTLE_PRICE) + ' €';

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      greenFee: gfText || null,
      total,
      hotelRate: hotelText,
      token: fmtPrice(match.token),
      buggy: fmtPrice(match.buggy),
      trolley: fmtPrice(match.trolley),
      allInclusive
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
};
