// Şifre ile korunan rapor API'si.
// /rapor.html buraya şifreyi gönderir, doğruysa son 8 günün
// sales@/info@ trafiğini Gmail'den çekip BİRİKİMLİ RENK İZİ ile döner.
//
// RENK MANTIĞI (futbol benzetmesi, kullanıcı tanımlı 03.08.2026):
// "Top" (aksiyon) her zaman mesajın gittiği tarafın rengini yakar.
//   -> Bize gelen HER mesaj (müşteriden veya otelden fark etmez) : SARI
//   -> Bizden otele giden mesaj                                   : YEŞİL
//   -> Bizden müşteriye giden mesaj                                : PEMBE
// Faz/geçmiş bayrağı YOK - basit ve sabit: alıcıya göre renk belirlenir.
// Noktalar hiç silinmeden, mesaj sırasına göre soldan sağa birikir.
// ❌/✅ anahtar kelimeyle ayrıca kontrol edilir, varsa trail'in sonuna eklenir.

const NOISE_SENDERS = [
  'stopsale@maxxroyal.com', 'opensale@maxxroyal.com',
  'stopsale@voyagehotel.com', 'opensale@voyagehotel.com',
  'stopsale@cajabymaxxroyal.com', 'opensale@cajabymaxxroyal.com',
  'sales@euromsg.net', 'email@email.qnb.com.tr',
  'noreply@mail.manus.im', 'bulten@rafinemedya.info',
  'newsletter@tourexpimail.com', 'top20@de.travelzoo.com',
  'exclusive@de.travelzoo.com', 'info@platformgolf.com',
  'david@miasportstechnology.com', 'partners@partners.yemeksepeti.com',
  'info@e.thelifecoshop.com', 'info@golfinitaly.com',
  'barisgedik@qral.tech', 'sasha@choosevamoostravelapp.com',
  'email.apple.com', 'mail.anthropic.com',
  'account-misc-noreply@google.com', 'forwarding-noreply@google.com',
  'stopsale@regnumhotels.com', 'gm@belkagolf.com', 'post@runnersworld.no'
];
// NOT: kişisel hesap/abonelik/sistem bildirimleri (Apple, Google hesap bildirimleri,
// Claude.ai giriş linki vb.) iş yazışması değil, sales@/info@/mb@ kutularına karışan
// kişisel/sistemsel gürültü - yeni bir tanesi fark edilirse buraya eklenmeye devam edilecek.
// NOT: sales@euromsg.net rapor taramasından hariç ama Gmail inbox'ta HİÇ engellenmiyor -
// Cullinan Belek'in stop-sale kanalı, çok önemli, silinmemeli/bloklanmamalı.
// NOT: Cornelia veya caryagolf.com ile ilgili hiçbir adres buraya eklenmemeli - gerçek ortaklar.
// NOT (10.08.2026): gm@belkagolf.com şirket sahibinin kendi adresi - müşteri/otel talebi
// değil, bu adresten gelen/CC'lenen hiçbir mail rapora müşteri talebi gibi girmemeli.
//
// NOT (10.08.2026, önemli): Birçok otel stop-sale bültenlerini KİŞİSEL ÇALIŞAN
// adreslerinden gönderiyor (jenerik stopsale@ değil) - örn. Kaya Hotels, Kempinski,
// Gloria, Cornelia, Sueno, Mardan Palace hep farklı personel adresleri kullanıyor.
// Bunların bazıları AYNI ZAMANDA gerçek fiyat tekliflerini de gönderiyor (örn. Sirene'de
// aizek.chekirova@sirene.com.tr hem stop-sale hem gerçek teklif gönderiyor) - bu yüzden
// bu adresleri NOISE_SENDERS'a eklemek gerçek işi de filtreler (Cornelia hatasının aynısı).
// Çözüm: adres yerine KONU BAŞLIĞI bazlı filtre (aşağıdaki sorguda -subject:"stop sale"
// -subject:"open sale") kullanılıyor - gerçek müşteri talepleri hiçbir zaman konu
// başlığında bu ifadeleri geçirmiyor, o yüzden bu güvenli ve adres listesinden çok daha
// kapsamlı bir çözüm.

const OUR_DOMAIN = 'belkagolf.com';

// Gürültü Kontrolü sekmesinde onaylanıp GitHub'a otomatik commit edilen ek
// göndericileri okur (api/mark-noise.js tarafından güncellenir). Dosya yoksa
// veya bozuksa sessizce boş liste döner - sabit NOISE_SENDERS listesi zaten çalışmaya devam eder.
function loadPersistedNoiseSenders() {
  try {
    const path = require('path');
    const fs = require('fs');
    const filePath = path.join(__dirname, 'data', 'noise-senders.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw.senders) ? raw.senders : [];
  } catch (e) {
    return [];
  }
}
const PERSISTED_NOISE_SENDERS = loadPersistedNoiseSenders();

const HOTEL_DOMAINS = [
  'maxxroyal.com', 'cajabymaxxroyal.com', 'corneliadiamond.com', 'regnumhotels.com',
  'cullinanhotels.com', 'cullinanlinksgolfclub.com', 'sueno.com.tr', 'kayahotels.com.tr',
  'titanic-hotels.com', 'gloria.com.tr', 'kempinski.com', 'robinson.com', 'sirene.com.tr',
  'voyagehotel.com', 'swandorhotels.com', 'caryagolf.com', 'guvenok.com.tr',
  'mardanpalace.com', 'euromsg.net', 'agc.com.tr', 'nationalturkey.com'
];function isOurDomain(addr) {
  return (addr || '').toLowerCase().includes(OUR_DOMAIN);
}
function isHotelDomain(addr) {
  const a = (addr || '').toLowerCase();
  return HOTEL_DOMAINS.some((d) => a.includes(d));
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await r.json();
  if (!data.access_token) {
    throw new Error('Access token alınamadı - GMAIL_REFRESH_TOKEN kurulu mu? Detay: ' + JSON.stringify(data));
  }
  return data.access_token;
}

function extractGroupSize(text) {
  const m = text.match(/(\d{1,2})\s?(pax|kişi|kisi|pers\.?|person|people)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Kriter 5 (tahmini rezervasyon değeri) - gece sayısı, pax ile birlikte kabaca büyüklük fikri verir.
function extractNights(text) {
  const m = text.match(/(\d{1,2})\s?(night|nights|gece)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Kriter 7 (sadakat sinyali) - geçmiş raporlarda tekrar eden, kaybedilmesi maliyetli müşteriler.
const LOYAL_CUSTOMER_NAMES = [
  'gramstad', 'sønsteby', 'sonsteby', 'noman zia'
];
function isLoyalCustomer(text) {
  const t = text.toLowerCase();
  return LOYAL_CUSTOMER_NAMES.some((n) => t.includes(n));
}

// AYNI-MÜŞTERİ BİRLEŞTİRME: Roger'ın konu başlıkları hep "Mr. X" / "Mrs. X" formatında
// sabit. Bu ismi çekip normalize ederek aynı müşterinin farklı thread'lerini (rezervasyon
// + tee-time + invoice gibi ayrı konu başlıklarıyla açılmış olsa bile) tek müşteri
// anahtarında gruplamak için kullanılır. Sadece büyük harfle başlayan ardışık kelimeleri
// (isim/soyisim, max 4 kelime) yakalıyor.
function extractCustomerKey(subject) {
  const m = (subject || '').match(/Mrs?\.?\s+((?:[A-ZÆØÅÄÖÜÇĞİÖŞÜ][\p{L}'-]*\s*){1,4})/u);
  if (!m) return null;
  let name = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
  return name.length >= 3 ? name : null;
}

// YEDEK BİRLEŞTİRME ANAHTARI: "Mr./Mrs. X" ismi geçmeyen konu başlıkları için (özellikle
// otellerin isim kullanmadan gönderdiği tekrar mailler). Konu başlığını normalize ederek
// (baştaki TÜM yanıt/yönlendirme önekleri - İngilizce RE:/FW:/Fwd: VE Türkçe Ynt:/Yn:/
// Yanıt:/Yönlendirilen: - hepsi, art arda birikmiş olsalar bile art arda temizlenir)
// ikinci bir anahtar olarak kullanır. extractCustomerKey bir isim bulduysa ona öncelik
// verilir - bu sadece isim YOKSA devreye giren bir yedek.
function extractSubjectKey(subject) {
  let s = (subject || '').trim();
  if (!s) return null;
  const prefixRe = /^(re|fw|fwd|sv|ynt|yn|yanıt|yanit|yönlendirilen|yonlendirilen)\s*:\s*/i;
  while (prefixRe.test(s)) {
    s = s.replace(prefixRe, '');
  }
  s = s.toLowerCase().replace(/\s+/g, ' ').trim();
  return s.length >= 8 ? 'subj:' + s : null;
}

function daysBetween(date) {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getHeaderFrom(msg, name) {
  const headers = msg.payload ? msg.payload.headers || [] : [];
  return (headers.find((h) => h.name === name) || {}).value || '';
}

function messageColor(from, to) {
  if (isOurDomain(from)) {
    return isHotelDomain(to) ? 'green' : 'pink';
  }
  return 'yellow';
}

function buildTrail(msgs) {
  const trail = [];
  let lastColor = null;

  for (const msg of msgs) {
    const from = getHeaderFrom(msg, 'From');
    const to = getHeaderFrom(msg, 'To');
    const color = messageColor(from, to);
    trail.push(color);
    lastColor = color;
  }

  return { trail, lastColor };
}

// ESKİ regex/kelime-bazlı sınıflandırma - artık birincil yöntem DEĞİL, sadece
// Claude API çağrısı başarısız olursa (rate limit, ağ hatası vb.) YEDEK olarak kullanılıyor.
// Bilinen kırılganlığı var (bkz. "konfirmedir" false-positive regresyon geçmişi) - bu yüzden
// birincil yöntem 29.08.2026'da Claude Haiku'ya taşındı (classifyBatchWithClaude).
function classifyFallback({ snippet, subject, trail, lastColor, daysWaiting, isUrgentKw }) {
  const text = (snippet + ' ' + subject).toLowerCase();

  if (/\biptal\b|cancel|no show|no-show|no longer|reddet|red edi|vazgeç|istemiyoruz|istemiyorum|başka (bir )?(firma|teklif|otel)i? (ile|tercih)|artık ilgilenmiyor|close (the |this )?request|kapat(ınız|abilirsiniz)? (bu |bu\s*)?(talebi|isteği)|talebi kapat/i.test(text)) {
    return { trail: [...trail, 'cancel'], label: 'Reddedildi / İptal / Kayıp', priority: -100, closed: true, oneri: '—', isNoise: false };
  }
  if (/konfirmedir|confirmed|onayland[ıi]|kabul (ediyoruz|ediyorum|ettik)|find attached reservation|attached reservation|reservation attached|hesap numar|iban|banka bilgi|banka hesap|send.*(bank|account) details|payment details|proforma.*(gönder|ekte)/i.test(text)) {
    return { trail: [...trail, 'confirm'], label: 'Kabul Edildi / Onaylandı', priority: -50, closed: true, oneri: '—', isNoise: false };
  }

  if (lastColor === 'yellow') {
    let priority = daysWaiting * 2;
    if (isUrgentKw) priority += 100;
    const oneri = daysWaiting === 0 ? 'Yanıt gönderilmeli (bugün geldi)'
      : daysWaiting === 1 ? '⚠️ 1 gündür yanıtsız - bugün cevaplanmalı'
      : `🚨 ${daysWaiting} GÜNDÜR YANITSIZ - hemen cevaplanmalı`;
    return { trail, label: `Bizim sıramız (${daysWaiting} gün)`, priority, closed: false, oneri, isNoise: false };
  }

  let priority = daysWaiting;
  if (isUrgentKw) priority += 50;
  const bekleyen = lastColor === 'green' ? 'Otelden cevap bekleniyor' : 'Müşteriden cevap bekleniyor';
  let oneri = '—';
  if (daysWaiting >= 1) {
    oneri = lastColor === 'green'
      ? 'Otelden yanıt gecikti — müşteriyi bilgilendir veya oteli ara'
      : 'Hatırlatma gönderilebilir — müşteri kaybı riski';
  }
  return { trail, label: `${bekleyen} (${daysWaiting} gün)`, priority, closed: false, oneri, isNoise: false };
}

// BİRİNCİL sınıflandırma yöntemi (29.08.2026): regex yerine Claude Haiku, tüm talepleri
// gerçek anlam bazlı değerlendiriyor - durum (onaylandı/iptal/aktif), Türkçe öneri metni,
// VE olası gürültü tespiti (personel görüp "Gürültü Kontrolü" sekmesinden kalıcı olarak
// ekleyebilir - burada OTOMATİK gizleme yapılmıyor, sadece işaretleniyor).
// Maliyet/hız için 20'li gruplar halinde PARALEL Claude çağrısı yapılıyor.
async function classifyBatchWithClaude(items) {
  if (!process.env.ANTHROPIC_API_KEY || items.length === 0) {
    return items.map((it) => ({ index: it.index, ...classifyFallback(it) }));
  }

  const CHUNK_SIZE = 20;
  const chunks = chunk(items, CHUNK_SIZE);

  const systemPrompt = `Sen bir golf tatili acentesinin (Belka Golf, Belek/Antalya) müşteri talebi takip
sistemisin. Sana bir dizi mail-thread özeti verilecek. Her biri için üç şeyi belirle:

1. "status": "confirmed" (BELİRLİ bir müşterinin rezervasyonu/talebi gerçekten onaylanmış - isim,
   tarih, ödeme gibi somut detaylar var), "cancelled" (iptal edilmiş, reddedilmiş, müşteri vazgeçmiş,
   başka firma tercih etmiş), veya "active" (hâlâ açık, taraflardan biri yanıt bekliyor).

   ÖNEMLİ - "confirmed" ile KARIŞTIRILMAMASI GEREKENLER (bunlar "active" olmalı):
   - Genel kampanya/indirim/fiyat duyuruları (örn. "15% discount for Lykia sales" gibi genel
     bilgilendirme mailleri - burada onaylanan bir rezervasyon YOK, sadece bilgi paylaşımı var).
   - Fiyat teklifi/liste paylaşımı (henüz bir onay değil, sadece bilgi).
   - "Sales", "discount", "confirm" gibi kelimeler geçse bile, eğer mail BELİRLİ bir müşterinin
     rezervasyonunu somut şekilde onaylamıyorsa "confirmed" DEĞİLDİR.
   Şüphedeysen "active" seç - yanlışlıkla "confirmed" işaretlemek gerçek bir talebi kaybetmemize sebep olabilir.

2. "oneri": personelin ŞİMDİ ne yapması gerektiğini anlatan KISA (max 15 kelime) Türkçe öneri.
   "lastColor" alanına göre üç farklı durum var:
   - "yellow": talep BİZE gelmiş, bizim cevaplamamız gerekiyor. "daysWaiting"e göre: 0="bugün geldi,
     yanıt gönderilmeli", 1="1 gündür yanıtsız - bugün cevaplanmalı", 2+="X GÜNDÜR YANITSIZ - hemen
     cevaplanmalı".
   - "pink": biz müşteriye göndermişiz, müşteriden yanıt bekleniyor. daysWaiting=0 ise "—" (henüz
     erken, bekle). daysWaiting>=1 ise "Hatırlatma gönderilebilir — müşteri kaybı riski" gibi bir
     hatırlatma öner (müşteri sessizliği ciddiye alınmalı, günler geçtikçe müşteri kaybetme riski artar).
   - "green": biz otele göndermişiz, otelden yanıt bekleniyor. Oteller birkaç saat içinde cevap
     vermeyebilir, bu normaldir - daysWaiting=0 ise "—" (henüz normal bekleme süresi). daysWaiting>=1
     ise "Otelden yanıt gecikti — müşteriyi bilgilendir veya oteli ara" gibi bir uyarı ver (bir günü
     aşan otel sessizliği, müşteriyi bilgisiz bırakıp kaybetme riski taşır).
   "isUrgentKw" true ise önerinin başına "URGENT —" ekle. status "confirmed" veya "cancelled" ise
   oneri her zaman "—" olsun (kapanmış talepler için öneri gerekmez).

3. "isNoise": bu aslında gerçek bir müşteri talebi veya otel/kulüp iş yazışması DEĞİL de
   (bülten, reklam, otomatik sistem bildirimi, spam, alakasız toplu mail) gürültü mü? true/false.
   Emin değilsen false yaz - yanlışlıkla gerçek bir talebi gürültü işaretlemek daha kötü bir hata.

SADECE JSON dizisi döndür, başka hiçbir metin/açıklama/markdown ekleme:
[{"index":1,"status":"active","oneri":"...","isNoise":false}, ...]`;

  const results = await Promise.all(
    chunks.map(async (group) => {
      const listText = group
        .map((it) => `${it.index}. Konu: ${it.subject}\n   Özet: ${it.snippet.slice(0, 250)}\n   lastColor: ${it.lastColor}\n   daysWaiting: ${it.daysWaiting}\n   isUrgentKw: ${it.isUrgentKw}`)
        .join('\n\n');

      try {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: 'user', content: listText }]
          })
        });
        if (!apiRes.ok) throw new Error('anthropic_api_error');

        const data = await apiRes.json();
        const rawText = (data.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) throw new Error('not_array');

        const byIndex = new Map(parsed.map((p) => [p.index, p]));
        return group.map((it) => {
          const r = byIndex.get(it.index);
          if (!r) return { index: it.index, ...classifyFallback(it) };
          const closed = r.status === 'confirmed' || r.status === 'cancelled';
          const trail = r.status === 'confirmed' ? [...it.trail, 'confirm']
            : r.status === 'cancelled' ? [...it.trail, 'cancel']
            : it.trail;
          const label = r.status === 'confirmed' ? 'Kabul Edildi / Onaylandı'
            : r.status === 'cancelled' ? 'Reddedildi / İptal / Kayıp'
            : it.lastColor === 'yellow' ? `Bizim sıramız (${it.daysWaiting} gün)`
            : it.lastColor === 'green' ? `Otelden cevap bekleniyor (${it.daysWaiting} gün)`
            : `Müşteriden cevap bekleniyor (${it.daysWaiting} gün)`;
          return {
            index: it.index, trail, label, closed,
            oneri: closed ? '—' : (r.oneri || '—'),
            isNoise: !!r.isNoise,
            priority: 0
          };
        });
      } catch (e) {
        // Bu grup için Claude başarısız oldu - eski regex yöntemine düş, rapor tamamen çökmesin.
        return group.map((it) => ({ index: it.index, ...classifyFallback(it) }));
      }
    })
  );

  return results.flat();
}

// Küçük bir dizi elemanı BATCH_SIZE'lık parçalara böler - Gmail API'ye aşırı paralel
// istek atıp rate-limit yememek için, ama yine de seri fetch'ten çok daha hızlı olur.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Aynı isimdeki (customerKey) birden fazla thread bulunduğunda, hepsinin GERÇEKTEN
// aynı devam eden talep mi yoksa aynı isimli müşteriden gelen FARKLI/bağımsız talepler
// mi olduğunu Claude'a sorar. Sadece aynı kümeye (cluster) atananlar birleştirilecek -
// customerKey'e küme numarası eklenerek (örn. "roger::c1" / "roger::c2") mevcut
// birleştirme mantığı hiç değişmeden doğru şekilde ayırt eder. API hatası olursa
// güvenli varsayım: hepsi aynı kabul edilir (eski davranış - hepsi birleşir).
async function resolveRequestClusters(items) {
  const groupedByKey = new Map();
  for (const it of items) {
    if (!it.customerKey) continue;
    if (!groupedByKey.has(it.customerKey)) groupedByKey.set(it.customerKey, []);
    groupedByKey.get(it.customerKey).push(it);
  }
  const candidateGroups = [...groupedByKey.entries()].filter(([, arr]) => arr.length > 1);
  if (candidateGroups.length === 0 || !process.env.ANTHROPIC_API_KEY) return;

  const systemPrompt = `Aynı isimdeki bir müşteriden gelen birden fazla mail-thread özeti göreceksin.
Bunlar GERÇEKTEN aynı devam eden talebin/rezervasyonun parçası mı (birbirine cevap niteliğinde,
aynı tarih/konu/detaylar üzerinden ilerliyor), yoksa BİRBİRİNDEN BAĞIMSIZ, farklı talepler mi
(farklı tarihler, farklı gruplar, alakasız konular - sadece aynı isimde başka bir kişi ya da aynı
müşterinin tamamen ayrı bir yeni talebi)?

Her birine bir küme numarası ata - aynı küme numarası = aynı talep/negotiation. Emin değilsen
AYNI kümede tut (yanlışlıkla ayırmak, yanlışlıkla birleştirmekten daha az zararlıdır - ayrılan
talepler raporda iki ayrı satır olur, bu kabul edilebilir).

SADECE JSON dizisi döndür, başka hiçbir metin ekleme:
[{"index":1,"cluster":1},{"index":2,"cluster":1},{"index":3,"cluster":2}]`;

  await Promise.all(candidateGroups.map(async ([key, arr]) => {
    try {
      const listText = arr
        .map((it, i) => `${i + 1}. Tarih: ${it.date}\n   Konu: ${it.subject}\n   Özet: ${it.snippet.slice(0, 200)}`)
        .join('\n\n');

      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: 'user', content: listText }]
        })
      });
      if (!apiRes.ok) throw new Error('anthropic_api_error');

      const data = await apiRes.json();
      const rawText = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error('not_array');

      const clusterByIndex = new Map(parsed.map((p) => [p.index, p.cluster]));
      arr.forEach((it, i) => {
        const clusterNum = clusterByIndex.get(i + 1) ?? 1;
        if (clusterNum !== 1) {
          it.customerKey = `${key}::c${clusterNum}`;
        }
      });
    } catch (e) {
      // Hata olursa dokunma - hepsi aynı customerKey ile kalır (eski, güvenli davranış).
    }
  }));
}

// --- Hatırlatma maili: taslak oluşturma + gönderme (30.08.2026 eklendi) ---
// Vercel Hobby planının 12-fonksiyon sınırına takılmamak için AYRI bir dosya açılmadı,
// bu iki yeni işlev mevcut rapor.js'e "action" parametresiyle eklendi (bkz. handler
// içindeki yönlendirme). action olmadan istek gelirse eskisi gibi tam rapor üretilir.

function getHeaderVal(msg, name) {
  const headers = msg.payload ? msg.payload.headers || [] : [];
  return (headers.find((h) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
}

function extractEmailAddr(headerValue) {
  const m = (headerValue || '').match(/<([^>]+)>/);
  return m ? m[1].toLowerCase() : (headerValue || '').trim().toLowerCase();
}

// Bir thread'in son mesajını + hangi kendi adresimizin (sales@/info@) bu yazışmada
// kullanıldığını + karşı tarafın adresini belirler - hatırlatma taslağı ve gönderimi
// için gereken tüm bağlamı tek yerde toplar.
async function getThreadContext(accessToken, threadId) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const msgs = data.messages || [];
  if (msgs.length === 0) throw new Error('Thread boş veya bulunamadı.');
  const last = msgs[msgs.length - 1];

  const subject = getHeaderVal(last, 'Subject');
  const fromAddr = extractEmailAddr(getHeaderVal(last, 'From'));
  const toAddr = extractEmailAddr(getHeaderVal(last, 'To'));
  const messageIdHeader = getHeaderVal(last, 'Message-ID') || getHeaderVal(last, 'Message-Id');
  const snippet = last.snippet || '';

  // Hangi kendi adresimiz (sales@/info@) bu yazışmada geçiyor - hatırlatmayı da o
  // adresten göndermek için. İkisi de yoksa varsayılan sales@ kullanılır.
  let ourAddress = 'sales@belkagolf.com';
  if (fromAddr.includes('info@belkagolf.com') || toAddr.includes('info@belkagolf.com')) {
    ourAddress = 'info@belkagolf.com';
  }

  // Karşı taraf (alıcı) - bizim adresimiz olmayan taraf.
  const recipient = isOurDomain(fromAddr) ? toAddr : fromAddr;

  return { subject, snippet, ourAddress, recipient, messageIdHeader, threadId };
}

async function handleDraftReminder(req, res, accessToken) {
  const { threadId } = req.body || {};
  if (!threadId) {
    res.status(400).json({ error: 'threadId eksik' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'api_key_missing' });
    return;
  }

  const ctx = await getThreadContext(accessToken, threadId);

  const systemPrompt = `Sen Belka Golf (Belek, Antalya - golf tatili acentesi) adına kısa, kibar,
profesyonel bir hatırlatma maili taslağı yazan bir asistansın. Sana bir mail thread'inin konusu
ve son mesajın özeti verilecek. Bu, YANITSIZ kalmış bir talep - karşı taraftan (otel veya müşteri
olabilir, kime yazıldığından anla) yanıt bekleniyor.

DİL KURALI - ÇOK ÖNEMLİ, KESİNLİKLE UY: Sana verilen "Konu" ve "Son mesaj özeti" metninin dilini
tespit et ve YANITINI O DİLDE yaz - Türkçe, İngilizce, Almanca, İsveççe, Rusça ya da başka
hangi dildeyse. Kaynak metin Türkçe DEĞİLSE, senin yazacağın taslak da KESİNLİKLE Türkçe
OLMAMALI - varsayılan olarak Türkçe'ye asla dönme. Örnek: kaynak metin İngilizce ise ("Hello...",
"unfortunately...") taslağın da tamamen İngilizce olmalı, tek bir Türkçe kelime bile geçmemeli.

Kısa, nazik bir hatırlatma maili yaz - selamlama + 2-3 cümlelik nazik hatırlatma + kapanış
yeterli, uzatma. SADECE mail gövdesini döndür, başka hiçbir açıklama/başlık ekleme.`;

  const userMsg = `Konu: ${ctx.subject}\nSon mesaj özeti: ${ctx.snippet.slice(0, 300)}`;

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }]
    })
  });
  if (!apiRes.ok) throw new Error('Anthropic API hatası: ' + (await apiRes.text()).slice(0, 300));

  const data = await apiRes.json();
  const draft = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

  res.status(200).json({
    draft,
    to: ctx.recipient,
    from: ctx.ourAddress,
    subject: ctx.subject.toLowerCase().startsWith('re:') ? ctx.subject : `Re: ${ctx.subject}`
  });
}

function buildMimeMessage({ from, to, subject, body, inReplyTo }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64'
  ];
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${inReplyTo}`);
  }
  const bodyB64 = Buffer.from(body, 'utf8').toString('base64');
  return headers.join('\r\n') + '\r\n\r\n' + bodyB64;
}

function toBase64Url(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function handleSendReminder(req, res, accessToken) {
  const { threadId, to, from, subject, body } = req.body || {};
  if (!threadId || !to || !from || !subject || !body) {
    res.status(400).json({ error: 'Eksik alan(lar) var (threadId/to/from/subject/body).' });
    return;
  }
  if (!ALLOWED_SEND_FROM.has(from)) {
    res.status(400).json({ error: `Bu adresten gönderim izinli değil: ${from}` });
    return;
  }

  const ctx = await getThreadContext(accessToken, threadId);
  const raw = buildMimeMessage({ from, to, subject, body, inReplyTo: ctx.messageIdHeader });

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: toBase64Url(raw), threadId })
  });

  if (!sendRes.ok) {
    const errText = await sendRes.text();
    res.status(502).json({ error: 'Gmail gönderim hatası', detail: errText.slice(0, 300) });
    return;
  }

  res.status(200).json({ success: true });
}

const ALLOWED_SEND_FROM = new Set(['sales@belkagolf.com', 'info@belkagolf.com']);

export default async function handler(req, res) {
  const password = req.query.password || (req.body && req.body.password) || '';

  if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
    res.status(401).json({ error: 'Şifre hatalı.' });
    return;
  }
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    res.status(500).json({ error: 'Sistem henüz kurulmadı: GMAIL_REFRESH_TOKEN eksik. Önce /api/auth-start adresini ziyaret edin.' });
    return;
  }

  const action = req.query.action || (req.body && req.body.action) || 'report';
  if (action === 'draft' || action === 'send') {
    try {
      const accessToken = await getAccessToken();
      if (action === 'draft') {
        await handleDraftReminder(req, res, accessToken);
      } else {
        await handleSendReminder(req, res, accessToken);
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  try {
    const accessToken = await getAccessToken();

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const dateStr = `${eightDaysAgo.getFullYear()}/${eightDaysAgo.getMonth() + 1}/${eightDaysAgo.getDate()}`;
    const noiseExcl = [...NOISE_SENDERS, ...PERSISTED_NOISE_SENDERS].map((s) => `-from:${s}`).join(' ');
    // KONU BAŞLIĞI BAZLI STOP/OPEN SALE FİLTRESİ (10.08.2026 eklendi): kişisel çalışan
    // adreslerinden gelen stop-sale bültenlerini de yakalar, adres listesine bağımlı
    // kalmadan. Gerçek müşteri talepleri konu başlığında bu ifadeleri hiç geçirmez.
    const subjectExcl = '-subject:"stop sale" -subject:"open sale" -subject:"stop&open sale"';
    const q = `(from:sales@belkagolf.com OR to:sales@belkagolf.com OR from:info@belkagolf.com OR to:info@belkagolf.com OR to:mb@belkagolf.com OR cc:mb@belkagolf.com) after:${dateStr} ${noiseExcl} ${subjectExcl}`;

    // maxResults 40 idi - yoğun trafikte 8 günlük pencerenin tamamı sığmıyordu.
    // Artık Gmail'in sayfalama (pageToken) mekanizmasıyla 150 thread'e kadar çekiliyor.
    let threads = [];
    let pageToken = '';
    for (let i = 0; i < 4; i++) {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(q)}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const listData = await listRes.json();
      threads = threads.concat(listData.threads || []);
      if (!listData.nextPageToken || threads.length >= 150) break;
      pageToken = listData.nextPageToken;
    }

    // Thread detayları 10'arlı gruplar halinde PARALEL çekiliyor (Promise.all) -
    // seri yöntemde 150 thread 45-75sn sürüp Vercel timeout riski taşıyordu.
    const threadList = threads.slice(0, 150);
    const detailResults = [];
    for (const group of chunk(threadList, 10)) {
      const group_dets = await Promise.all(
        group.map((th) =>
          fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ).then((r) => r.json())
        )
      );
      detailResults.push(...group_dets);
    }

    const rawItems = [];
    for (const det of detailResults) {
      const msgs = det.messages || [];
      const first = msgs[0];
      const last = msgs[msgs.length - 1];
      if (!last) continue;

      const subject = getHeaderFrom(last, 'Subject');
      const lastFrom = getHeaderFrom(last, 'From');
      const date = getHeaderFrom(last, 'Date');
      const snippet = last.snippet || '';

      const firstSnippet = first ? first.snippet || '' : '';
      const combinedText = subject + ' ' + snippet + ' ' + firstSnippet;
      const groupSize = extractGroupSize(combinedText);
      const nights = extractNights(combinedText);
      const loyal = isLoyalCustomer(subject + ' ' + lastFrom);
      const isUrgentKw = /urgent|acil|asap|hemen|acilen|önemli/i.test(combinedText);
      const isPriceShopping = /cheaper|best price|lowest price|alternative|compare|diğer seçenek|daha uygun fiyat|en uygun fiyat|fiyat karşılaştır|rakip/i.test(combinedText);

      const daysWaiting = date ? daysBetween(new Date(date)) : 0;
      const { trail: rawTrail, lastColor } = buildTrail(msgs);

      // Bu thread'in HER mesajının (tarih+kimden+kime) ham bilgisi saklanıyor - aynı
      // müşteriye ait FARKLI thread'ler (örn. asıl talep + bizim otelle ayrı yazışmamız)
      // birleştirilirken, tüm mesajlar tarihe göre karıştırılıp TEK bir kronolojik iz
      // oluşturulacak (bkz. aşağıdaki customerKey birleştirme adımı).
      const rawMsgs = msgs.map((m) => ({
        date: getHeaderFrom(m, 'Date'),
        from: getHeaderFrom(m, 'From'),
        to: getHeaderFrom(m, 'To')
      }));

      const nameKey = extractCustomerKey(subject);
      rawItems.push({
        index: rawItems.length + 1,
        threadId: det.id,
        subject, from: lastFrom, date, snippet,
        trail: rawTrail, lastColor, daysWaiting, isUrgentKw, isPriceShopping,
        groupSize, nights, loyal, messageCount: msgs.length, rawMsgs,
        customerKey: nameKey || extractSubjectKey(subject)
      });
    }

    // Durum (onaylandı/iptal/aktif) + Öneri metni + gürültü tespiti artık Claude Haiku
    // ile toplu (20'li paralel gruplar) yapılıyor - bkz. classifyBatchWithClaude yorumu.
    const classifications = await classifyBatchWithClaude(rawItems);
    const classByIndex = new Map(classifications.map((c) => [c.index, c]));

    const items = [];
    for (const it of rawItems) {
      const cls = classByIndex.get(it.index) || classifyFallback(it);
      let priority = cls.priority || 0;
      if (!cls.closed) {
        if (it.isPriceShopping) priority += 20;
        if (it.loyal) priority += 30;
        if (it.groupSize && it.nights && it.groupSize * it.nights >= 30) priority += 15;
      }
      const isLate = !cls.closed && it.lastColor === 'yellow' && it.daysWaiting >= 1;

      items.push({
        threadId: it.threadId,
        subject: it.subject,
        from: it.from,
        date: it.date,
        snippet: it.snippet,
        trail: cls.trail,
        rawMsgs: it.rawMsgs,
        statusLabel: cls.label,
        oneri: cls.oneri,
        isNoise: cls.isNoise || false,
        priority,
        groupSize: it.groupSize,
        messageCount: it.messageCount,
        isLate,
        customerKey: it.customerKey
      });
    }

    // AYNI-MÜŞTERİ / AYNI-KONU BİRLEŞTİRME: customerKey aynıysa tek satırda birleştir.
    // Önce Claude'a "bunlar gerçekten aynı talep mi" diye sorulup, farklıysa customerKey
    // küme numarasıyla ayrılıyor (bkz. resolveRequestClusters) - böylece aynı isimdeki
    // FARKLI talepler yanlışlıkla birleştirilmiyor.
    await resolveRequestClusters(items);

    // En güncel thread'in durumu/önerisi "birincil" kabul edilir; diğer thread'lerin
    // konu başlıkları "otherSubjects" listesinde saklanır, mergedCount kaç thread
    // birleştiğini gösterir. customerKey hiç bulunamayan itemlar birleştirilmeden kalır.
    const byCustomer = new Map();
    const allMsgsByCustomer = new Map(); // customerKey -> tüm birleşen thread'lerin TÜM mesajları
    const standalone = [];
    for (const it of items) {
      if (!it.customerKey) {
        standalone.push(it);
        continue;
      }
      if (!allMsgsByCustomer.has(it.customerKey)) allMsgsByCustomer.set(it.customerKey, []);
      allMsgsByCustomer.get(it.customerKey).push(...(it.rawMsgs || []));

      const existing = byCustomer.get(it.customerKey);
      if (!existing) {
        byCustomer.set(it.customerKey, { ...it, otherSubjects: [], mergedCount: 1 });
      } else {
        existing.mergedCount += 1;
        existing.otherSubjects.push(it.subject);
        if (new Date(it.date) > new Date(existing.date)) {
          const otherSubjects = [...existing.otherSubjects, existing.subject];
          const mergedCount = existing.mergedCount;
          Object.assign(existing, it);
          existing.otherSubjects = otherSubjects;
          existing.mergedCount = mergedCount;
        }
      }
    }

    // Aynı müşteriye ait BİRDEN FAZLA thread birleştiyse (örn. müşterinin asıl talebi + bizim
    // otelle ayrı yazışmamız), tek thread'in izi yerine TÜM mesajlar tarihe göre kronolojik
    // sıraya dizilip TEK birleşik iz oluşturuluyor - müşteri(sarı)→biz(yeşil,otele sorduk)→
    // otel(sarı)→biz(pembe,müşteriye ilettik)→müşteri(sarı,itiraz)→biz(yeşil,tekrar sorduk)...
    // gibi tam kronoloji tek satırda görünür. Durum/öneri metni değişmiyor - hâlâ en güncel
    // mesajdan (birincil item) geliyor, sadece GÖRSEL iz genişletiliyor.
    const MAX_TRAIL_DOTS = 40; // aşırı uzun geçmişlerde satır genişliği taşmasın diye üst sınır
    for (const [key, merged] of byCustomer.entries()) {
      if (merged.mergedCount <= 1) continue;
      const allMsgs = allMsgsByCustomer.get(key) || [];
      const sorted = allMsgs
        .filter((m) => m.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      if (sorted.length === 0) continue;
      let combinedTrail = sorted.map((m) => messageColor(m.from, m.to));
      if (combinedTrail.length > MAX_TRAIL_DOTS) {
        combinedTrail = combinedTrail.slice(-MAX_TRAIL_DOTS);
      }
      merged.trail = combinedTrail;
    }

    const finalItems = [...byCustomer.values(), ...standalone]
      .map(({ rawMsgs, ...rest }) => rest); // rawMsgs sadece iz birleştirme için gerekliydi, istemciye gönderilmiyor

    finalItems.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: finalItems.length,
      items: finalItems
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
