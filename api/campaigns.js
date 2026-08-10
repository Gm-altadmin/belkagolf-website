// Kampanya (süreli EB indirim) bilgisi API'si.
// Veri kaynağı: api/data/campaigns.json - Claude'un otel partner maillerinden
// (Kaya Hotels, Gloria Hotels vb.) okuyup elle güncellediği yapılandırılmış liste.
// NEDEN OTOMATİK MAIL-OKUMA DEĞİL: kampanya mailleri otelden otele çok farklı
// formatlarda geliyor (Kaya/Gloria düzenli tablo/liste, Voyage/Maxx Royal uzun
// iç-içe yanıt zincirleri) - genel bir metin-ayrıştırıcı yanlış yüzde okuyup
// müşteriye yanlış fiyat gösterme riski taşır. Bu yüzden Claude chat'te
// "kampanya kontrol" ile malları okuyup bu JSON'u güncelliyor (yarı-otomatik,
// ama güvenilir). autoApply:true olan kampanyalar Fiyat Arama'da fiyata
// otomatik yansıtılıyor (api/hotelsearch.js), watchOnly listesi sadece bilgi.

const fs = require('fs');
const path = require('path');

function parseDate(str) {
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = (req, res) => {
  try {
    const { password } = req.query;
    if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
      res.status(401).json({ error: 'Şifre hatalı.' });
      return;
    }

    const filePath = path.join(__dirname, 'data', 'campaigns.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const campaigns = raw.campaigns.map(c => {
      const bookingStart = parseDate(c.bookingStart);
      const bookingEnd = parseDate(c.bookingEnd);
      const isActive = today >= bookingStart && today <= bookingEnd;
      return { ...c, isActive };
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      campaigns,
      watchOnly: raw.watchOnly,
      lastUpdatedByClaude: raw.lastUpdatedByClaude,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
};
