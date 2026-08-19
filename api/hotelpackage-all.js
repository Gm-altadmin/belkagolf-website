// "Tüm Oteller" modu için: belirli tarih+gece+kişi sayısına göre 18 otelin
// TAMAMINI tarar, her otel için en ucuz eşleşen seçeneği alır, fiyata göre
// en ucuzdan en pahalıya sıralı döner. api/hotelpackage.js ile aynı veri/mantığı
// kullanır (markup, oda görünümü, round dahil) - sadece tek otel yerine hepsini
// tarayıp sıralar. Şifre GEREKMEZ - bu da hotelpackage.js gibi herkese açık.
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
    if (!r || !r[0] || !r[1] || !r[2]) continue;
    data.push({
      hotel: String(r[0]).trim(),
      start: r[1], end: r[2],
      nights: Number(r[3]),
      rounds: r[4],
      view: r[5] || null,
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

function parseDate(str) {
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

// api/hotelpackage.js ile AYNI liste tutulmalı - biri değişirse diğeri de.
const HP_MARKUP_EXCLUDED_HOTELS = new Set([
  'Gloria Serenity Resort',
  'Gloria Golf Resort',
  'Gloria Verde Resort & Spa',
  'Robinson Club Nobilis'
]);

module.exports = (req, res) => {
  try {
    const { date, nights, group } = req.query;
    if (!date) {
      res.status(400).json({ error: 'missing_params' });
      return;
    }
    const data = loadData();
    const checkDate = new Date(date + 'T00:00:00');
    const nightsNum = nights ? Number(nights) : null;
    const groupSize = group ? Number(group) : 1;
    const HP_MARKUP = 98;

    const hotels = [...new Set(data.map(r => r.hotel))];
    const results = [];

    for (const hotel of hotels) {
      const matches = data.filter(row => {
        if (row.hotel !== hotel) return false;
        if (nightsNum !== null && row.nights !== nightsNum) return false;
        const start = parseDate(row.start);
        const end = parseDate(row.end);
        return checkDate >= start && checkDate <= end;
      });
      if (matches.length === 0) continue;

      const markupForThisHotel = HP_MARKUP_EXCLUDED_HOTELS.has(hotel) ? 0 : HP_MARKUP;
      // Bu otel için en ucuz eşleşen seçeneği bul (fiyat türü kişi sayısına göre).
      let best = null;
      let bestPrice = null;
      for (const m of matches) {
        let raw;
        if (groupSize >= 8 && m.group71 !== null) raw = m.group71;
        else if (groupSize >= 2) raw = m.dbl;
        else raw = m.single;
        if (raw === null || raw === undefined) continue;
        const price = raw + markupForThisHotel;
        if (bestPrice === null || price < bestPrice) { bestPrice = price; best = m; }
      }
      if (best === null) continue;

      let priceType = groupSize >= 8 && best.group71 !== null ? 'group71' : (groupSize >= 2 ? 'double' : 'single');
      results.push({
        hotel,
        nights: best.nights,
        rounds: best.rounds,
        view: best.view,
        priceType,
        price: bestPrice + ' €',
        priceNum: bestPrice,
        single: best.single !== null ? (best.single + markupForThisHotel) + ' €' : null,
        double: best.dbl !== null ? (best.dbl + markupForThisHotel) + ' €' : null,
        group71: best.group71 !== null ? (best.group71 + markupForThisHotel) + ' €' : null,
        buggyFree: best.buggyFree,
        tokenFree: best.tokenFree,
        transferFree: best.transferFree
      });
    }

    results.sort((a, b) => a.priceNum - b.priceNum);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ results });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
};
