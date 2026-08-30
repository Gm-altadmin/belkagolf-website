// Paylaşılan hotel-packages.xlsx okuma mantığı + fiyat sabitleri (30.08.2026 refactor -
// hotelpackage.js/hotelpackage-all.js/hotelsearch.js'de birebir kopyalanmış haldeydi,
// tek yere taşındı - üçünü de senkron tutma riski ortadan kalktı). Bu dosya bir Vercel
// fonksiyonu export ETMİYOR - 12-fonksiyon sınırına dahil DEĞİL.

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const HP_MARKUP = 98; // Tek/Çift/7+1 fiyatlarına eklenen sabit kâr payı (€)

// Bu oteller zaten kendi kaynak fiyatlarında kâr marjı içeriyor - HP_MARKUP eklenmez.
const HP_MARKUP_EXCLUDED_HOTELS = new Set([
  'Gloria Serenity Resort',
  'Gloria Golf Resort',
  'Gloria Verde Resort & Spa',
  'Robinson Club Nobilis'
]);

let cachedData = null;

function parseSheetRows(rows) {
  const headerIdx = rows.findIndex((r) => r && r[0] === 'Otel');
  if (headerIdx === -1) return []; // veri tablosu olmayan sayfa (örn. Özet-Index)

  const data = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !r[1] || !r[2]) continue;
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
  return data;
}

// Ham veriyi döner (TÜM otelleri içerir, Belka Golf Residence dahil). hotelsearch.js gibi
// bunu istemeyen çağıranlar, dönen diziyi kendileri filtrelemeli - bu fonksiyon herkes
// için aynı, tarafsız ham veriyi vermeli.
function loadHotelPackageData() {
  if (cachedData) return cachedData;
  const filePath = path.join(__dirname, '..', 'data', 'hotel-packages.xlsx');
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });

  // Dosyadaki TÜM sayfaları tara (her otel kendi sayfasında olabilir).
  let data = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
    data = data.concat(parseSheetRows(rows));
  }

  cachedData = data;
  return data;
}

module.exports = { loadHotelPackageData, parseSheetRows, HP_MARKUP, HP_MARKUP_EXCLUDED_HOTELS };
