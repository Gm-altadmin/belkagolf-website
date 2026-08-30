// İç kullanım (personel) fiyat arama API'si.
// Belirli bir giriş tarihi + gece sayısı (+ round + kişi sayısı) için TÜM otelleri
// hotel-packages.xlsx üzerinde tarar, uygun olanları en ucuzdan pahalıya sıralar.
// Aynı şifre (RAPOR_SIFRE) ile korunur - /rapor.html'deki "Fiyat Arama" sekmesi buraya bağlanır.
//
// 30.08.2026 refactor: HP_MARKUP/HP_MARKUP_EXCLUDED_HOTELS/veri okuma artık api/_lib/
// hotel-pricing.js'den içe aktarılıyor - hotelpackage.js ile manuel senkron tutma riski
// ortadan kalktı (önceden üç dosyada birebir kopyalanmış haldeydi).

const path = require('path');
const fs = require('fs');
const { loadHotelPackageData, HP_MARKUP, HP_MARKUP_EXCLUDED_HOTELS } = require('./_lib/hotel-pricing');

let cachedCampaigns = null;
function loadCampaigns() {
  if (cachedCampaigns) return cachedCampaigns;
  try {
    const filePath = path.join(__dirname, 'data', 'campaigns.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    cachedCampaigns = raw.campaigns.filter(c => c.autoApply);
  } catch (e) {
    cachedCampaigns = [];
  }
  return cachedCampaigns;
}

function parseDateDMY(str) {
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

// Belirli bir otel + giriş tarihi için AKTİF (bugün rezervasyon penceresinde VE
// giriş tarihi konaklama döneminde) kampanya var mı - varsa döndürür.
function findActiveCampaign(hotel, checkDate) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const campaigns = loadCampaigns();
  for (const c of campaigns) {
    if (c.hotel !== hotel) continue;
    const bookingStart = parseDateDMY(c.bookingStart);
    const bookingEnd = parseDateDMY(c.bookingEnd);
    if (today < bookingStart || today > bookingEnd) continue;
    const stayStart = parseDateDMY(c.stayStart);
    const stayEnd = parseDateDMY(c.stayEnd);
    if (checkDate < stayStart || checkDate > stayEnd) continue;
    return c;
  }
  return null;
}

let cachedData = null;

// Ortak loadHotelPackageData() TÜM otelleri döner (Belka Golf Residence dahil) - burada
// (personel iç fiyat arama) o ayrı site paket satışı yapmadığı için hariç tutuluyor.
// Bu filtre SADECE burada var, hotelpackage.js/hotelpackage-all.js'de yok (bilinçli fark).
function loadData() {
  if (cachedData) return cachedData;
  cachedData = loadHotelPackageData().filter((row) => row.hotel !== 'Belka Golf Residence');
  return cachedData;
}

function parseDate(str) {
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = (req, res) => {
  try {
    const { password, date, nights, rounds, pax, hotels, views } = req.query;

    if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
      res.status(401).json({ error: 'Şifre hatalı.' });
      return;
    }
    if (!date) {
      res.status(400).json({ error: 'missing_date' });
      return;
    }

    let data = loadData();
    if (hotels) {
      const hotelSet = new Set(hotels.split('|'));
      data = data.filter(row => hotelSet.has(row.hotel));
    }
    if (views) {
      const viewList = views.split('|');
      const wantsNone = viewList.includes('__NONE__');
      const viewSet = new Set(viewList.filter(v => v !== '__NONE__'));
      data = data.filter(row => {
        if (row.view === null) return wantsNone;
        return viewSet.has(row.view);
      });
    }
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

    let fallbackNote = null;
    let anyNightsFallback = false;
    let anyRoundsDeficit = false;

    // Tarihte satılan tüm satırlar (otel/oda tipi filtresi zaten data'ya uygulanmış durumda).
    const dateRows = data.filter(row => dateMatch(row));

    // Otel bazında en iyi eşleşmeyi bul: her otel kendi içinde değerlendirilir,
    // bir otelin tam eşleşmesi diğer otelleri ASLA elemez (eski hatalı davranış buydu -
    // Kaya Palazzo 6 round sattığı için Sueno'nun 4 round'luk, Cornelia'nın 2 round'luk
    // paketleri tamamen gizleniyordu). Round karşılanamıyorsa fark not olarak eklenir -
    // eksik round'lar personel tarafından başka golf kulüplerinden manuel tamamlanır.
    const hotelNames = [...new Set(dateRows.map(r => r.hotel))];
    let matches = [];

    for (const hotel of hotelNames) {
      let hotelRows = dateRows.filter(r => r.hotel === hotel);
      let nightsFallbackUsed = false;

      if (nightsNum !== null) {
        const exactNights = hotelRows.filter(r => r.nights === nightsNum);
        if (exactNights.length) {
          hotelRows = exactNights;
        } else {
          nightsFallbackUsed = true; // gece sayısı bu otelde tam yok, tüm gece seçenekleri havuzda kalır
        }
      }

      let chosenRows, roundsUsed, roundsDeficit;

      if (roundsReq === null) {
        chosenRows = hotelRows;
        roundsUsed = null;
        roundsDeficit = 0;
      } else {
        const exactRounds = hotelRows.filter(r =>
          String(r.rounds) === String(roundsReq) || String(r.rounds) === 'Sınırsız'
        );
        if (exactRounds.length) {
          chosenRows = exactRounds;
          roundsUsed = roundsReq;
          roundsDeficit = 0;
        } else {
          const numericRows = hotelRows.filter(r => !isNaN(Number(r.rounds)));
          const belowOrEqual = numericRows.filter(r => Number(r.rounds) <= roundsReq);
          if (belowOrEqual.length) {
            const maxRound = Math.max(...belowOrEqual.map(r => Number(r.rounds)));
            chosenRows = belowOrEqual.filter(r => Number(r.rounds) === maxRound);
            roundsUsed = maxRound;
            roundsDeficit = roundsReq - maxRound;
          } else if (numericRows.length) {
            // Bu otelde istenenden düşük/eşit round seçeneği hiç yok - en düşük
            // (istenenin üzerindeki en küçük) seçeneği göster, eksik yok say.
            const minRound = Math.min(...numericRows.map(r => Number(r.rounds)));
            chosenRows = numericRows.filter(r => Number(r.rounds) === minRound);
            roundsUsed = minRound;
            roundsDeficit = 0;
          } else {
            chosenRows = [];
            roundsUsed = null;
            roundsDeficit = 0;
          }
        }
      }

      if (nightsFallbackUsed) anyNightsFallback = true;
      if (roundsDeficit > 0) anyRoundsDeficit = true;

      for (const row of chosenRows) {
        matches.push({ row, nightsFallbackUsed, roundsUsed, roundsDeficit });
      }
    }

    const noteParts = [];
    if (anyNightsFallback) noteParts.push('bazı otellerde istenen gece sayısı tam bulunamadı (en yakın gösteriliyor)');
    if (anyRoundsDeficit) noteParts.push('bazı otellerde istenen round sayısına ulaşılamadı - eksik round\'lar başka bir golf kulübünden ayrıca eklenmelidir ("+N round" notuna bakın)');
    if (noteParts.length) {
      fallbackNote = noteParts.join('; ') + '.';
    }

    const results = matches.map(({ row: m, roundsUsed, roundsDeficit }) => {
      const markup = HP_MARKUP_EXCLUDED_HOTELS.has(m.hotel) ? 0 : HP_MARKUP;
      const single = m.single !== null ? m.single + markup : null;
      const dbl = m.dbl !== null ? m.dbl + markup : null;
      const group71 = m.group71 !== null ? m.group71 + markup : null;

      // Kampanya varsa: indirim HAM kontrat fiyatına uygulanır, sonra üzerine
      // her zamanki kâr payımız eklenir - yani kampanya bizim marjımızı
      // değiştirmez, sadece otelin net fiyatını düşürür.
      const campaign = findActiveCampaign(m.hotel, checkDate);
      let campaignSingle = null, campaignDouble = null, campaignGroup71 = null;
      if (campaign) {
        const f = 1 - campaign.discountPercent / 100;
        campaignSingle = m.single !== null ? Math.round(m.single * f) + markup : null;
        campaignDouble = m.dbl !== null ? Math.round(m.dbl * f) + markup : null;
        campaignGroup71 = m.group71 !== null ? Math.round(m.group71 * f) + markup : null;
      }

      let sortPrice;
      const effectiveSingle = campaignSingle !== null ? campaignSingle : single;
      const effectiveDouble = campaignDouble !== null ? campaignDouble : dbl;
      const effectiveGroup71 = campaignGroup71 !== null ? campaignGroup71 : group71;
      if (groupSize >= 8 && effectiveGroup71 !== null) sortPrice = effectiveGroup71;
      else if (groupSize >= 2) sortPrice = effectiveDouble;
      else sortPrice = effectiveSingle;

      return {
        hotel: m.hotel,
        view: m.view,
        nights: m.nights,
        rounds: m.rounds,
        roundsDeficit,
        single, double: dbl, group71,
        campaignSingle, campaignDouble, campaignGroup71,
        campaignDiscountPercent: campaign ? campaign.discountPercent : null,
        campaignSource: campaign ? campaign.source : null,
        sortPrice,
        nDiff: nightsDiff(m),
        buggyFree: m.buggyFree,
        tokenFree: m.tokenFree,
        transferFree: m.transferFree,
        periodStart: m.start,
        periodEnd: m.end
      };
    }).filter(r => r.sortPrice !== null)
      .sort((a, b) => {
        // Eksik round'u olmayanlar (tam veya en iyi eşleşme) önce, sonra fiyata göre.
        if (a.roundsDeficit !== b.roundsDeficit) return a.roundsDeficit - b.roundsDeficit;
        if (a.nDiff !== b.nDiff) return a.nDiff - b.nDiff;
        return a.sortPrice - b.sortPrice;
      });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      count: results.length,
      fallbackNote,
      results: results.slice(0, 150)
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
};
