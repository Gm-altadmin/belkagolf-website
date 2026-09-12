// Paylaşılan domain sabitleri (30.08.2026 refactor - rapor.js/noise.js/stopsale.js'de
// birebir kopyalanmış haldeydi, tek yere taşındı). Bu dosya bir Vercel fonksiyonu
// export ETMİYOR (sadece plain fonksiyon/sabit export ediyor) - bu yüzden 12-fonksiyon
// sınırına dahil DEĞİL, diğer api/ dosyaları buradan require() ile içe aktarır.

const OUR_DOMAIN = 'belkagolf.com';

const HOTEL_DOMAINS = [
  'maxxroyal.com', 'cajabymaxxroyal.com', 'corneliadiamond.com', 'regnumhotels.com',
  'cullinanhotels.com', 'cullinanlinksgolfclub.com', 'sueno.com.tr', 'kayahotels.com.tr',
  'titanic-hotels.com', 'gloria.com.tr', 'kempinski.com', 'robinson.com', 'sirene.com.tr',
  'voyagehotel.com', 'swandorhotels.com', 'caryagolf.com', 'guvenok.com.tr',
  'mardanpalace.com', 'euromsg.net', 'agc.com.tr', 'nationalturkey.com'
];

function isOurDomain(addr) {
  return (addr || '').toLowerCase().includes(OUR_DOMAIN);
}

function isHotelDomain(addr) {
  const a = (addr || '').toLowerCase();
  return HOTEL_DOMAINS.some((d) => a.includes(d));
}

module.exports = { OUR_DOMAIN, HOTEL_DOMAINS, isOurDomain, isHotelDomain };
