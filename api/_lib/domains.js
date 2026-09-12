// Paylaşılan domain sabitleri (30.08.2026 refactor - rapor.js/noise.js/stopsale.js'de
// birebir kopyalanmış haldeydi, tek yere taşındı). Bu dosya bir Vercel fonksiyonu
// export ETMİYOR (sadece plain fonksiyon/sabit export ediyor) - bu yüzden 12-fonksiyon
// sınırına dahil DEĞİL, diğer api/ dosyaları buradan require() ile içe aktarır.

const OUR_DOMAIN = 'belkagolf.com';

// Ham Gmail hesabının kendisi (mbeyzadeoglubelka@gmail.com) - info@/sales@/mb@/gm@/
// muhasebe@belkagolf.com hepsi bu hesaba POP3 ile düşüyor, ve bu hesap Growth OS'un
// info@ Send-As takma adı için de kullanılıyor. "belkagolf.com" içermediği için eskiden
// isOurDomain() bunu YAKALAMIYORDU - bir mesajda bu ham adres "Kimden" olarak göründüğünde
// (örn. bir yönlendirme/kopya) sistem bunu YANLIŞLIKLA dış/müşteri mesajı sanıyordu
// (09.09.2026'da Growth OS Yanıtları'nda gerçek bir örnekle bulundu - kullanıcının kendi
// hesabı "müşteri" diye sınıflandırılmıştı).
const OUR_RAW_ACCOUNTS = ['mbeyzadeoglubelka@gmail.com'];

const HOTEL_DOMAINS = [
  'maxxroyal.com', 'cajabymaxxroyal.com', 'corneliadiamond.com', 'regnumhotels.com',
  'cullinanhotels.com', 'cullinanlinksgolfclub.com', 'sueno.com.tr', 'kayahotels.com.tr',
  'titanic-hotels.com', 'gloria.com.tr', 'kempinski.com', 'robinson.com', 'sirene.com.tr',
  'voyagehotel.com', 'swandorhotels.com', 'caryagolf.com', 'guvenok.com.tr',
  'mardanpalace.com', 'euromsg.net', 'agc.com.tr', 'nationalturkey.com'
];

function isOurDomain(addr) {
  const a = (addr || '').toLowerCase();
  return a.includes(OUR_DOMAIN) || OUR_RAW_ACCOUNTS.some((acc) => a.includes(acc));
}

function isHotelDomain(addr) {
  const a = (addr || '').toLowerCase();
  return HOTEL_DOMAINS.some((d) => a.includes(d));
}

module.exports = { OUR_DOMAIN, OUR_RAW_ACCOUNTS, HOTEL_DOMAINS, isOurDomain, isHotelDomain };
