// "Tüm Oteller" modu için: belirli tarih+gece+kişi sayısına göre 18 otelin
// TAMAMINI tarar, her otel için en ucuz eşleşen seçeneği alır, fiyata göre
// en ucuzdan en pahalıya sıralı döner. api/hotelpackage.js ile aynı veri/mantığı
// kullanır (markup, oda görünümü, round dahil) - sadece tek otel yerine hepsini
// tarayıp sıralar. Şifre GEREKMEZ - bu da hotelpackage.js gibi herkese açık.
const { loadHotelPackageData, HP_MARKUP, HP_MARKUP_EXCLUDED_HOTELS } = require('./_lib/hotel-pricing');

function parseDate(str) {
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = (req, res) => {
  try {
    const { date, nights, group, rounds } = req.query;
    if (!date) {
      res.status(400).json({ error: 'missing_params' });
      return;
    }
    const data = loadHotelPackageData();
    const checkDate = new Date(date + 'T00:00:00');
    const nightsNum = nights ? Number(nights) : null;
    const groupSize = group ? Number(group) : 1;

    const hotels = [...new Set(data.map(r => r.hotel))];
    const results = [];

    for (const hotel of hotels) {
      const matches = data.filter(row => {
        if (row.hotel !== hotel) return false;
        if (nightsNum !== null && row.nights !== nightsNum) return false;
        // Round filtresi (19.08.2026 eklendi): kullanıcı belirli bir round sayısı
        // istediyse SADECE o otelin o sayıya sahip satırlarını dahil et - böylece
        // farklı otellerin farklı round sayılarındaki fiyatları karşılaştırılmaz
        // (örn. birinin 3 round'luk en ucuz paketi, diğerinin 1 round'luk paketiyle
        // yan yana gösterilmesin). Belirtilmezse eski davranış: round fark etmez.
        if (rounds) { if (String(row.rounds) !== String(rounds)) return false; }
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
