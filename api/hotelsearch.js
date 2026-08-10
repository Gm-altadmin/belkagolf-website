// İç kullanım (personel) fiyat arama API'si.
// Belirli bir giriş tarihi + gece sayısı (+ round + kişi sayısı) için TÜM otelleri
// hotel-packages.xlsx üzerinde tarar, uygun olanları en ucuzdan pahalıya sıralar.
// Aynı şifre (RAPOR_SIFRE) ile korunur - /rapor.html'deki "Fiyat Arama" sekmesi buraya bağlanır.
//
// NOT: HP_MARKUP ve HP_MARKUP_EXCLUDED_HOTELS burada api/hotelpackage.js ile AYNI
// tutulmalı - biri değişirse diğeri de güncellenmeli (iki dosyada da manuel senkron).

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
    if (String(r[0]).trim() === 'Belka Golf Residence') continue; // ayrı site, paket satışı yok
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

const HP_MARKUP = 98;
const HP_MARKUP_EXCLUDED_HOTELS = new Set([
  'Gloria Serenity Resort',
  'Gloria Golf Resort',
  'Gloria Verde Resort & Spa',
  'Robinson Club Nobilis'
]);

module.exports = (req, res) => {
  try {
    const { password, date, nights, rounds, pax } = req.query;

    if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
      res.status(401).json({ error: 'Şifre hatalı.' });
      return;
    }
    if (!date) {
      res.status(400).json({ error: 'missing_date' });
      return;
    }

    const data = loadData();
    const checkDate = new Date(date + 'T00:00:00');
    const nightsNum = nights ? Number(nights) : null;
    const roundsReq = rounds || null;
    const groupSize = pax ? Number(pax) : 2;

    function dateMatch(row) {
      const start = parseDate(row.start);
      const end = parseDate(row.end);
      return checkDate >= start && checkDate <= end;
    }

    // Gece/round "uzaklığı": istenenle ne kadar örtüşüyor. 'Sınırsız' round her zaman
    // istenen round sayısını karşılar (uzaklık 0) - unlimited golf her ihtiyacı çözer.
    function nightsDiff(row) {
      if (nightsNum === null) return 0;
      return Math.abs(row.nights - nightsNum);
    }
    function roundsDiff(row) {
      if (roundsReq === null) return 0;
      if (String(row.rounds) === 'Sınırsız') return 0;
      const rn = Number(row.rounds);
      const reqN = Number(roundsReq);
      if (isNaN(rn) || isNaN(reqN)) return 999;
      return Math.abs(rn - reqN);
    }

    let isExactFallback = false;
    let fallbackNote = null;

    // 1. deneme: gece + round tam eşleşme
    let matches = data.filter(row =>
      dateMatch(row) &&
      (nightsNum === null || row.nights === nightsNum) &&
      (roundsReq === null || String(row.rounds) === String(roundsReq))
    );

    // Fallback: tam eşleşme yoksa, tarihte satılan TÜM satırları al ve istenen
    // gece/round sayısına EN YAKIN olanları öne çıkar (sadece fiyata göre değil -
    // fiyata göre sıralamak alakasız/çok kısa-konaklama paketlerini öne çıkarıp
    // yanıltıcı oluyordu).
    if (matches.length === 0) {
      matches = data.filter(row => dateMatch(row));
      isExactFallback = true;
      const parts = [];
      if (nightsNum !== null) parts.push('gece sayısı');
      if (roundsReq !== null) parts.push('round sayısı');
      if (parts.length) {
        fallbackNote = `İstenen ${parts.join(' ve ')} bu tarihte tam bulunamadı — en yakın seçenekler gösteriliyor (gece/round sütunlarına dikkat edin).`;
      }
    }

    const results = matches.map(m => {
      const markup = HP_MARKUP_EXCLUDED_HOTELS.has(m.hotel) ? 0 : HP_MARKUP;
      const single = m.single !== null ? m.single + markup : null;
      const dbl = m.dbl !== null ? m.dbl + markup : null;
      const group71 = m.group71 !== null ? m.group71 + markup : null;
      let sortPrice;
      if (groupSize >= 8 && group71 !== null) sortPrice = group71;
      else if (groupSize >= 2) sortPrice = dbl;
      else sortPrice = single;
      return {
        hotel: m.hotel,
        view: m.view,
        nights: m.nights,
        rounds: m.rounds,
        single, double: dbl, group71,
        sortPrice,
        nDiff: nightsDiff(m),
        rDiff: roundsDiff(m),
        buggyFree: m.buggyFree,
        tokenFree: m.tokenFree,
        transferFree: m.transferFree,
        periodStart: m.start,
        periodEnd: m.end
      };
    }).filter(r => r.sortPrice !== null)
      .sort((a, b) => {
        // Tam eşleşme modunda (fallback değil) doğrudan fiyata göre sırala.
        // Fallback modunda önce istenen gece/round'a en yakın olan öne çıksın,
        // eşit yakınlıkta olanlar arasında fiyat belirleyici olsun.
        if (isExactFallback) {
          if (a.nDiff !== b.nDiff) return a.nDiff - b.nDiff;
          if (a.rDiff !== b.rDiff) return a.rDiff - b.rDiff;
        }
        return a.sortPrice - b.sortPrice;
      });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      count: results.length,
      fallbackNote,
      results: results.slice(0, 60)
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
};
