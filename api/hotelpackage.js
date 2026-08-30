const { loadHotelPackageData, HP_MARKUP, HP_MARKUP_EXCLUDED_HOTELS } = require('./_lib/hotel-pricing');

// "26.08.2026" formatındaki tarihi karşılaştırılabilir hale getirir
function parseDate(str) {
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = (req, res) => {
  try {
    const { hotel, date, nights, group } = req.query;
    // "nights" artık zorunlu değil: verilmezse o otel+tarih için TÜM gece
    // seçenekleri döner, istemci taraf gece butonlarını buradan oluşturur.
    if (!hotel || !date) {
      res.status(400).json({ error: 'missing_params' });
      return;
    }
    const data = loadHotelPackageData();
    const checkDate = new Date(date + 'T00:00:00');
    const nightsNum = nights ? Number(nights) : null;
    const groupSize = group ? Number(group) : 1;
    const matches = data.filter(row => {
      if (row.hotel !== hotel) return false;
      if (nightsNum !== null && row.nights !== nightsNum) return false;
      const start = parseDate(row.start);
      const end = parseDate(row.end);
      return checkDate >= start && checkDate <= end;
    });
    if (matches.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const markupForThisHotel = HP_MARKUP_EXCLUDED_HOTELS.has(hotel) ? 0 : HP_MARKUP;
    const options = matches.map(m => {
      let price, priceType;
      if (groupSize >= 8 && m.group71 !== null) {
        price = m.group71 + markupForThisHotel;
        priceType = 'group71';
      } else if (groupSize >= 2) {
        price = m.dbl + markupForThisHotel;
        priceType = 'double';
      } else {
        price = m.single + markupForThisHotel;
        priceType = 'single';
      }
      return {
        nights: m.nights,
        rounds: m.rounds,
        view: m.view,
        price: price !== null ? price + ' €' : null,
        priceType,
        single: m.single !== null ? (m.single + markupForThisHotel) + ' €' : null,
        double: m.dbl !== null ? (m.dbl + markupForThisHotel) + ' €' : null,
        group71: m.group71 !== null ? (m.group71 + markupForThisHotel) + ' €' : null,
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
