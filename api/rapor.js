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
  'account-misc-noreply@google.com', 'forwarding-noreply@google.com'
];
// NOT: kişisel hesap/abonelik/sistem bildirimleri (Apple, Google hesap bildirimleri,
// Claude.ai giriş linki vb.) iş yazışması değil, sales@/info@/mb@ kutularına karışan
// kişisel/sistemsel gürültü - yeni bir tanesi fark edilirse buraya eklenmeye devam edilecek.
// NOT: sales@euromsg.net rapor taramasından hariç ama Gmail inbox'ta HİÇ engellenmiyor -
// Cullinan Belek'in stop-sale kanalı, çok önemli, silinmemeli/bloklanmamalı.
// NOT: Cornelia veya caryagolf.com ile ilgili hiçbir adres buraya eklenmemeli - gerçek ortaklar.

const OUR_DOMAIN = 'belkagolf.com';

const HOTEL_DOMAINS = [
  'maxxroyal.com', 'cajabymaxxroyal.com', 'corneliadiamond.com', 'regnumhotels.com',
  'cullinanhotels.com', 'cullinanlinksgolfclub.com', 'sueno.com.tr', 'kayahotels.com.tr',
  'titanic-hotels.com', 'gloria.com.tr', 'kempinski.com', 'robinson.com', 'sirene.com.tr',
  'voyagehotel.com', 'swandorhotels.com', 'caryagolf.com', 'guvenok.com.tr',
  'mardanpalace.com', 'euromsg.net'
];

function isOurDomain(addr) {
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

// YEDEK BİRLEŞTİRME ANAHTARI (06.08.2026 eklendi): "Mr./Mrs. X" ismi geçmeyen konu
// başlıkları için (özellikle otellerin isim kullanmadan gönderdiği tekrar mailler, örn.
// "RE: Tee time müsaitliği talebi//GLORIA//03.09.2026-06.09.2026- 3 pax" - aynı otel aynı
// tarihi 3 ayrı mail olarak göndermiş, aralarında isim yok ama konu birebir aynı). Bu
// durumda konu başlığını normalize ederek (RE:/FW:/Sv: önekleri, boşluk farkları temizlenir)
// ikinci bir anahtar olarak kullanıyoruz. extractCustomerKey bir isim bulduysa ona öncelik
// verilir - bu sadece isim YOKSA devreye giren bir yedek.
function extractSubjectKey(subject) {
  let s = (subject || '').trim();
  if (!s) return null;
  // Baştaki RE:/FW:/Fwd:/Sv: öneklerini (birden fazla olabilir) temizle.
  s = s.replace(/^(re|fw|fwd|sv)\s*:\s*/gi, '');
  while (/^(re|fw|fwd|sv)\s*:\s*/i.test(s)) {
    s = s.replace(/^(re|fw|fwd|sv)\s*:\s*/i, '');
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

function buildTrail(msgs) {
  const trail = [];
  let lastColor = null;

  for (const msg of msgs) {
    const from = getHeaderFrom(msg, 'From');
    const to = getHeaderFrom(msg, 'To');

    let color;
    if (isOurDomain(from)) {
      color = isHotelDomain(to) ? 'green' : 'pink';
    } else {
      color = 'yellow';
    }
    trail.push(color);
    lastColor = color;
  }

  return { trail, lastColor };
}

// İptal/onay anahtar kelime kontrolü yöne bakmaz (her mesaj kontrol edilir); regex
// bilerek daraltılmış - bare "konfirme" (istek fiili, "...etmenizi rica ederiz") değil,
// sadece "konfirmedir" (durum bildirimi) eşleşir, "confirmed" zaten sadece durum
// bildirimlerinde geçtiği için ek değişiklik gerekmedi.
function classify({ snippet, subject, trail, lastColor, daysWaiting, isUrgentKw }) {
  const text = (snippet + ' ' + subject).toLowerCase();

  if (/\biptal\b|cancel|no show|no-show|no longer|reddet|red edi|vazgeç|istemiyoruz|istemiyorum|başka (bir )?(firma|teklif|otel)i? (ile|tercih)|artık ilgilenmiyor/i.test(text)) {
    return { trail: [...trail, 'cancel'], label: 'Reddedildi / İptal / Kayıp', priority: -100, closed: true };
  }
  if (/konfirmedir|confirmed|onayland[ıi]|kabul (ediyoruz|ediyorum|ettik)|find attached reservation|attached reservation|reservation attached|hesap numar|iban|banka bilgi|banka hesap|send.*(bank|account) details|payment details|proforma.*(gönder|ekte)/i.test(text)) {
    return { trail: [...trail, 'confirm'], label: 'Kabul Edildi / Onaylandı', priority: -50, closed: true };
  }

  if (lastColor === 'yellow') {
    let priority = daysWaiting * 2;
    if (isUrgentKw) priority += 100;
    return { trail, label: `Bizim sıramız (${daysWaiting} gün)`, priority, closed: false };
  }

  let priority = daysWaiting;
  if (isUrgentKw) priority += 50;
  const bekleyen = lastColor === 'green' ? 'Otelden cevap bekleniyor' : 'Müşteriden cevap bekleniyor';
  return { trail, label: `${bekleyen} (${daysWaiting} gün)`, priority, closed: false };
}

// Küçük bir dizi elemanı BATCH_SIZE'lık parçalara böler - Gmail API'ye aşırı paralel
// istek atıp rate-limit yememek için, ama yine de seri fetch'ten çok daha hızlı olur.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

  try {
    const accessToken = await getAccessToken();

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const dateStr = `${eightDaysAgo.getFullYear()}/${eightDaysAgo.getMonth() + 1}/${eightDaysAgo.getDate()}`;
    const noiseExcl = NOISE_SENDERS.map((s) => `-from:${s}`).join(' ');
    const q = `(from:sales@belkagolf.com OR to:sales@belkagolf.com OR from:info@belkagolf.com OR to:info@belkagolf.com OR to:mb@belkagolf.com OR cc:mb@belkagolf.com) after:${dateStr} ${noiseExcl}`;

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

    const items = [];
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
      const status = classify({ snippet, subject, trail: rawTrail, lastColor, daysWaiting, isUrgentKw });
      if (isPriceShopping && status.priority > 0) {
        status.priority += 20;
      }
      if (loyal && status.priority > 0) {
        status.priority += 30;
      }
      if (groupSize && nights && groupSize * nights >= 30 && status.priority > 0) {
        status.priority += 15;
      }

      let oneri = '—';
      let isLate = false;
      if (status.closed) {
        oneri = '—';
      } else if (lastColor === 'yellow') {
        if (daysWaiting === 0) {
          oneri = 'Yanıt gönderilmeli (bugün geldi)';
        } else if (daysWaiting === 1) {
          oneri = '⚠️ 1 gündür yanıtsız - bugün cevaplanmalı';
          isLate = true;
        } else {
          oneri = `🚨 ${daysWaiting} GÜNDÜR YANITSIZ - GELİR KAYBI RİSKİ, hemen cevaplanmalı`;
          isLate = true;
        }
      } else if (daysWaiting >= 5) {
        oneri = 'Hatırlatma gönderilebilir';
      }
      if (!status.closed) {
        if (groupSize && groupSize >= 6) {
          oneri += (oneri === '—' ? '' : ' — ') + `Büyük grup (${groupSize} kişi)`;
        }
        if (groupSize && nights && groupSize * nights >= 30) {
          oneri += (oneri === '—' ? '' : ' — ') + `Yüksek değerli rezervasyon (${groupSize}p x ${nights}g)`;
        }
        if (loyal) {
          oneri += (oneri === '—' ? '' : ' — ') + 'Sadık/tekrar müşteri - kaybetmemeye dikkat';
        }
        if (isPriceShopping) {
          oneri += (oneri === '—' ? '' : ' — ') + 'Muhtemelen fiyat karşılaştırıyor, hızlı dönülmeli';
        }
        if (isUrgentKw) {
          oneri = 'URGENT — ' + (oneri === '—' ? 'öncelikli incelenmeli' : oneri);
        }
      }

      const nameKey = extractCustomerKey(subject);
      items.push({
        threadId: det.id,
        subject,
        from: lastFrom,
        date,
        snippet,
        trail: status.trail,
        statusLabel: status.label,
        oneri,
        priority: status.priority,
        groupSize,
        messageCount: msgs.length,
        isLate,
        // İsim bulunduysa onu kullan; yoksa konu başlığı bazlı yedek anahtara düş.
        customerKey: nameKey || extractSubjectKey(subject)
      });
    }

    // AYNI-MÜŞTERİ / AYNI-KONU BİRLEŞTİRME: customerKey aynıysa tek satırda birleştir.
    // En güncel thread'in durumu/trail'i/önerisi "birincil" kabul edilir; diğer thread'lerin
    // konu başlıkları "otherSubjects" listesinde saklanır, mergedCount kaç thread
    // birleştiğini gösterir. customerKey hiç bulunamayan itemlar birleştirilmeden kalır.
    const byCustomer = new Map();
    const standalone = [];
    for (const it of items) {
      if (!it.customerKey) {
        standalone.push(it);
        continue;
      }
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
    const finalItems = [...byCustomer.values(), ...standalone];

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
