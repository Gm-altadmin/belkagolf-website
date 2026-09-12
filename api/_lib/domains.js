// Paylaşılan domain sabitleri (30.08.2026 refactor - rapor.js/noise.js/stopsale.js'de
// birebir kopyalanmış haldeydi, tek yere taşındı). Bu dosya bir Vercel fonksiyonu
// export ETMİYOR (sadece plain fonksiyon/sabit export ediyor) - bu yüzden 12-fonksiyon
// sınırına dahil DEĞİL, diğer api/ dosyaları buradan require() ile içe aktarır.

const OUR_DOMAIN = 'belkagolf.com';

// (11.09.2026 eklendi) Bazı iç yazışmalar/kampanya gönderimleri (özellikle Growth OS B2B
// teklif kampanyası) kurumsal @belkagolf.com adresleri yerine kişisel bir Gmail hesabından
// (mbeyzadeoglubelka@gmail.com) gönderiliyor. isOurDomain() bu adresi tanımadığı için,
// bu adresten giden HER mesaj yanlışlıkla "müşteriden/karşı taraftan gelen mesaj" sanılıyor
// - bu da handleGrowthOsScan içinde şirketin kendi gönderdiği kampanya maillerinin "müşteri
// cevabı" gibi Claude'a sınıflandırmaya gönderilmesine (ve rastgele positive/referral/other
// etiketi almasına), messageColor() içinde de yanlış renk (sarı yerine yeşil/pembe olması
// gerekirken) atanmasına yol açıyordu. Bu liste, kurumsal domain dışında "bizim" sayılması
// gereken ek/istisnai adresleri tutar - yeni bir kişisel/istisnai gönderici adresi fark
// edilirse buraya eklenmeye devam edilecek.
const OUR_EXTRA_ADDRESSES = [
  'mbeyzadeoglubelka@gmail.com'
];

const HOTEL_DOMAINS = [
  'maxxroyal.com', 'cajabymaxxroyal.com', 'corneliadiamond.com', 'regnumhotels.com',
  'cullinanhotels.com', 'cullinanlinksgolfclub.com', 'sueno.com.tr', 'kayahotels.com.tr',
  'titanic-hotels.com', 'gloria.com.tr', 'kempinski.com', 'robinson.com', 'sirene.com.tr',
  'voyagehotel.com', 'swandorhotels.com', 'caryagolf.com', 'guvenok.com.tr',
  'mardanpalace.com', 'euromsg.net', 'agc.com.tr', 'nationalturkey.com'
];

function isOurDomain(addr) {
  const a = (addr || '').toLowerCase();
  if (a.includes(OUR_DOMAIN)) return true;
  return OUR_EXTRA_ADDRESSES.some((extra) => a.includes(extra));
}

function isHotelDomain(addr) {
  const a = (addr || '').toLowerCase();
  return HOTEL_DOMAINS.some((d) => a.includes(d));
}

module.exports = { OUR_DOMAIN, OUR_EXTRA_ADDRESSES, HOTEL_DOMAINS, isOurDomain, isHotelDomain };
