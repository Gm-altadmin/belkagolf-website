// Şifre ile korunan rapor API'si.
// /rapor.html buraya şifreyi gönderir, doğruysa son 10 günün
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
  'noreply@mail.manus.im', 'bulten@rafinemedya.info'
];

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
// Bu liste zaman içinde büyütülebilir - yeni bir tekrar müşteri fark edilince buraya eklenir.
const LOYAL_CUSTOMER_NAMES = [
  'gramstad', 'sønsteby', 'sonsteby', 'noman zia'
];
function isLoyalCustomer(text) {
  const t = text.toLowerCase();
  return LOYAL_CUSTOMER_NAMES.some((n) => t.includes(n));
}

function daysBetween(date) {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getHeaderFrom(msg, name) {
  const headers = msg.payload ? msg.payload.headers || [] : [];
  return (headers.find((h) => h.name === name) || {}).value || '';
}

// Thread'deki tüm mesajları işleyip birikimli renk izini kurar.
// Kural: her mesajın rengi, mesajı ALAN tarafa göre belirlenir (top kimdeyse o renk).
function buildTrail(msgs) {
  const trail = [];
  let lastColor = null; // son mesajın rengi = topun şu an kimde olduğu

  for (const msg of msgs) {
    const from = getHeaderFrom(msg, 'From');
    const to = getHeaderFrom(msg, 'To');

    let color;
    if (isOurDomain(from)) {
      // Biz gönderdik - kime?
      color = isHotelDomain(to) ? 'green' : 'pink';
    } else {
      // Bize geldi (müşteriden veya otelden) - top bizde, her zaman sarı.
      color = 'yellow';
    }
    trail.push(color);
    lastColor = color;
  }

  return { trail, lastColor };
}

function classify({ snippet, subject, trail, lastColor, daysWaiting, isUrgentKw }) {
  const text = (snippet + ' ' + subject).toLowerCase();

  // Kriter 4 (kayıp-müşteri paterni) + genel "iş bitti, kayıp" sinyalleri.
  if (/\biptal\b|cancel|no show|no-show|no longer|reddet|red edi|vazgeç|istemiyoruz|istemiyorum|başka (bir )?(firma|teklif|otel)i? (ile|tercih)|artık ilgilenmiyor/i.test(text)) {
    return { trail: [...trail, 'cancel'], label: 'Reddedildi / İptal / Kayıp', priority: -100 };
  }
  // "İş bitti, onaylandı" sinyalleri - rezervasyon konfirme, kabul, VEYA ödeme aşamasına geçmiş
  // (hesap numarası/IBAN istemi = ödemeye geçilmiş, iş kapanmış demektir).
  if (/konfirme|confirmed|onayland[ıi]|kabul (ediyoruz|ediyorum|ettik)|find attached reservation|attached reservation|reservation attached|hesap numar|iban|banka bilgi|banka hesap|send.*(bank|account) details|payment details|proforma.*(gönder|ekte)/i.test(text)) {
    return { trail: [...trail, 'confirm'], label: 'Kabul Edildi / Onaylandı', priority: -50 };
  }

  if (lastColor === 'yellow') {
    // Top bizde - bizim sıramız, aksiyon gerekiyor.
    let priority = daysWaiting * 2;
    if (isUrgentKw) priority += 100;
    return { trail, label: `Bizim sıramız (${daysWaiting} gün)`, priority };
  }

  // Top otelde (green) veya müşteride (pink) - onların sırası, biz bekliyoruz.
  let priority = daysWaiting;
  if (isUrgentKw) priority += 50;
  const bekleyen = lastColor === 'green' ? 'Otelden cevap bekleniyor' : 'Müşteriden cevap bekleniyor';
  return { trail, label: `${bekleyen} (${daysWaiting} gün)`, priority };
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

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const dateStr = `${tenDaysAgo.getFullYear()}/${tenDaysAgo.getMonth() + 1}/${tenDaysAgo.getDate()}`;
    const noiseExcl = NOISE_SENDERS.map((s) => `-from:${s}`).join(' ');
    const q = `(from:sales@belkagolf.com OR to:sales@belkagolf.com OR from:info@belkagolf.com OR to:info@belkagolf.com OR to:mb@belkagolf.com OR cc:mb@belkagolf.com) after:${dateStr} ${noiseExcl}`;

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(q)}&maxResults=40`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const listData = await listRes.json();
    const threads = listData.threads || [];

    const items = [];
    for (const th of threads.slice(0, 35)) {
      const detRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const det = await detRes.json();
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
      // Kriter 2 (URGENT bayrağı) - daha geniş kelime kapsamı.
      const isUrgentKw = /urgent|acil|asap|hemen|acilen|önemli/i.test(combinedText);
      // Kriter 8 (fiyat-karşılaştırma / rakip firmalardan alışveriş sinyali).
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
      if (lastColor === 'yellow') {
        // Sarı = bizim sorumluluğumuz. Mailin cevapsız kalması doğrudan gelir kaybı riski -
        // bu yüzden kademeli, gitgide sertleşen bir uyarı metni kullanıyoruz.
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

      items.push({
        threadId: th.id,
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
        isLate
      });
    }

    items.sort((a, b) => b.priority - a.priority);

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: items.length,
      items
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
