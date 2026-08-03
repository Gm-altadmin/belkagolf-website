// Şifre ile korunan rapor API'si.
// /rapor.html buraya şifreyi gönderir, doğruysa son 10 günün
// sales@/info@ trafiğini Gmail'den çekip BİRİKİMLİ RENK İZİ ile döner.
//
// Renkler emoji DEĞİL, düz metin kod olarak dönülüyor (yellow/green/pink/
// cancel/confirm) - render tarafı (rapor.html) bunları CSS ile çizilmiş
// renkli noktalara çeviriyor.

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

function daysBetween(date) {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getHeaderFrom(msg, name) {
  const headers = msg.payload ? msg.payload.headers || [] : [];
  return (headers.find((h) => h.name === name) || {}).value || '';
}

function buildTrail(msgs) {
  let offerSent = false;
  const trail = [];
  let lastIsFromUs = false;

  for (const msg of msgs) {
    const from = getHeaderFrom(msg, 'From');
    const to = getHeaderFrom(msg, 'To');

    if (isOurDomain(from)) {
      lastIsFromUs = true;
      if (isHotelDomain(to)) {
        trail.push('green');
      } else {
        trail.push('pink');
        offerSent = true;
      }
    } else if (isHotelDomain(from)) {
      lastIsFromUs = false;
      trail.push('yellow');
    } else {
      lastIsFromUs = false;
      trail.push(offerSent ? 'pink' : 'yellow');
    }
  }

  return { trail, lastIsFromUs };
}

function classify({ snippet, subject, trail, lastIsFromUs, daysWaiting, isUrgentKw }) {
  const text = (snippet + ' ' + subject).toLowerCase();

  if (/\biptal\b|cancel|no show|no-show|no longer/i.test(text)) {
    return { trail: [...trail, 'cancel'], label: 'İptal / Kayıp', priority: -100 };
  }
  if (/konfirme|confirmed|onayland[ıi]/i.test(text)) {
    return { trail: [...trail, 'confirm'], label: 'Onaylandı / Konfirme', priority: -50 };
  }

  if (!lastIsFromUs) {
    let priority = daysWaiting * 2;
    if (isUrgentKw) priority += 100;
    return { trail, label: `Bizim sıramız (${daysWaiting} gün)`, priority };
  }
  let priority = daysWaiting;
  if (isUrgentKw) priority += 50;
  const lastColor = trail[trail.length - 1];
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
    const q = `(from:sales@belkagolf.com OR to:sales@belkagolf.com OR from:info@belkagolf.com OR to:info@belkagolf.com) after:${dateStr} ${noiseExcl}`;

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
      const isUrgentKw = /urgent|acil/i.test(combinedText);

      const daysWaiting = date ? daysBetween(new Date(date)) : 0;
      const { trail: rawTrail, lastIsFromUs } = buildTrail(msgs);
      const status = classify({ snippet, subject, trail: rawTrail, lastIsFromUs, daysWaiting, isUrgentKw });

      let oneri = '—';
      if (!lastIsFromUs) {
        oneri = 'Yanıt gönderilmeli' + (daysWaiting >= 2 ? ' (gecikme var)' : '');
      } else if (daysWaiting >= 5) {
        oneri = 'Hatırlatma gönderilebilir';
      }
      if (groupSize && groupSize >= 6) {
        oneri += (oneri === '—' ? '' : ' — ') + `Büyük grup (${groupSize} kişi)`;
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
        messageCount: msgs.length
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
