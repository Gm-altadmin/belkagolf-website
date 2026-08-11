// Stop Sale / Open Sale takip API'si (v2, 10.08.2026 - ileri tarihe göre yeniden yazıldı).
//
// İLK VERSİYONDAKİ HATA: maili ALMA tarihine göre sıralıyordu (geriye dönük) -
// ama personelin ihtiyacı "hangi İLERİ konaklama tarihinde satış durduruldu/açıldı"
// bilgisidir. Bu versiyon mail GÖVDESİNDEN etkilenen tarih(ler)i çıkarır, sadece
// BUGÜNDEN İLERİ olanları gösterir, en yakın tarihi en üste koyar.
//
// Format çeşitliliği: otelden otele tablo sütun sırası bile değişiyor (bazısı
// Market/Tarih/Oda/Durum, bazısı Pazar/Oda/Tarih/Durum). Sabit sütun pozisyonuna
// güvenmek yerine, her satırda tarih deseni + stop/open anahtar kelimesini ayrı ayrı
// arayıp eşleştiriyoruz - bu hem tablo hem düz metin formatlarında çalışır.

function decodeBase64Url(data) {
  const b64 = (data || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function findBodyText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === 'text/plain' && p.body && p.body.data) return decodeBase64Url(p.body.data);
    }
    for (const p of payload.parts) {
      const r = findBodyText(p);
      if (r) return r;
    }
  }
  if (payload.mimeType === 'text/html' && payload.body && payload.body.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }
  return '';
}

const HOTEL_DOMAIN_MAP = [
  { domains: ['maxxroyal.com', 'cajabymaxxroyal.com'], hotel: 'Maxx Royal Belek Golf Resort' },
  { domains: ['corneliadiamond.com'], hotel: 'Cornelia Diamond Golf Resort & Spa' },
  { domains: ['regnumhotels.com'], hotel: 'Regnum Carya / Regnum The Crown' },
  { domains: ['cullinanhotels.com', 'cullinanlinksgolfclub.com', 'euromsg.net'], hotel: 'Cullinan Belek' },
  { domains: ['sueno.com.tr'], hotel: 'Sueno Hotels Golf/DeLuxe Belek' },
  { domains: ['kayahotels.com.tr'], hotel: 'Kaya Palazzo / Kaya Belek' },
  { domains: ['titanic-hotels.com'], hotel: 'Titanic Deluxe Golf Belek' },
  { domains: ['gloria.com.tr'], hotel: 'Gloria Serenity/Golf/Verde' },
  { domains: ['swandorhotels.com'], hotel: 'Lykia World Antalya' },
  { domains: ['kempinski.com'], hotel: 'Kempinski Hotel The Dome' },
  { domains: ['robinson.com'], hotel: 'Robinson Club Nobilis' },
  { domains: ['sirene.com.tr'], hotel: 'Sirene Belek Golf Hotel' },
  { domains: ['voyagehotel.com'], hotel: 'Voyage Belek Golf & Spa' },
  { domains: ['agc.com.tr'], hotel: 'Antalya GC' },
  { domains: ['nationalturkey.com', 'caryagolf.com'], hotel: 'National Golf Club / Carya' },
  { domains: ['mardanpalace.com'], hotel: 'Mardan Palace' },
  { domains: ['rixos.com'], hotel: 'Rixos (Belek dışı - kontrol edin)' }
];

function hotelFromSender(addr) {
  const a = (addr || '').toLowerCase();
  const found = HOTEL_DOMAIN_MAP.find(h => h.domains.some(d => a.includes(d)));
  return found ? found.hotel : (a.split('@')[1] || 'Bilinmeyen');
}

// DD.MM.YY veya DD.MM.YYYY, tekli ya da "DD.MM.YY-DD.MM.YY" aralık.
const DATE_RANGE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4}))?/;

function toDate(d, m, y) {
  const yr = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  return new Date(yr, parseInt(m, 10) - 1, parseInt(d, 10));
}

function fmtDate(d) {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

function lineType(line) {
  const l = line.toLowerCase();
  const isStop = /stop sale|satışa kapalı|satisa kapali|durdurulmasını|durdurmanızı/.test(l);
  const isOpen = /open sale|satışa açık|satisa acik|açılmasını|açılmasına/.test(l);
  if (isStop && isOpen) return 'both';
  if (isStop) return 'stop';
  if (isOpen) return 'open';
  return null;
}

// Mail gövdesini satır satır tarayıp {dateStart, dateEnd, type, context} listesi çıkarır.
// Satırda hem tarih hem stop/open kelimesi varsa o satırdan; yoksa genel subject tipini kullanır.
function extractDatedEntries(bodyText, subjectType) {
  const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const m = line.match(DATE_RANGE_RE);
    if (!m) continue;
    const dateStart = toDate(m[1], m[2], m[3]);
    const dateEnd = m[4] ? toDate(m[4], m[5], m[6]) : dateStart;
    if (isNaN(dateStart.getTime())) continue;
    const type = lineType(line) || subjectType;
    // Bağlam metni: tarih ve durum ifadeleri çıkarılmış, kısaltılmış satır.
    let context = line
      .replace(DATE_RANGE_RE, '')
      .replace(/stop sale|open sale|satışa kapalı|satisa kapali|satışa açık|satisa acik|\(dahil\)|\(inc\)|\(incl\.?\)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (context.length > 70) context = context.slice(0, 70) + '…';
    entries.push({ dateStart, dateEnd, type, context: context || null });
  }
  return entries;
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

function getHeader(msg, name) {
  const h = (msg.payload && msg.payload.headers) || [];
  const f = h.find(x => x.name === name);
  return f ? f.value : '';
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function subjectType(subject) {
  const s = (subject || '').toLowerCase();
  if (s.includes('stop') && s.includes('open')) return 'both';
  if (s.includes('stop')) return 'stop';
  if (s.includes('open')) return 'open';
  return 'other';
}

export default async function handler(req, res) {
  const password = req.query.password || (req.body && req.body.password) || '';
  if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
    res.status(401).json({ error: 'Şifre hatalı.' });
    return;
  }
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    res.status(500).json({ error: 'Sistem henüz kurulmadı: GMAIL_REFRESH_TOKEN eksik.' });
    return;
  }

  try {
    const accessToken = await getAccessToken();
    // Alma tarihine göre 45 gün geriye kadar TARA (eski bir mail hâlâ ileri
    // tarihli bir stop-sale anlatıyor olabilir) - ama SONUÇTA sadece bugünden
    // ileri konaklama tarihlerini göstereceğiz.
    const searchWindowAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const dateStr = `${searchWindowAgo.getFullYear()}/${searchWindowAgo.getMonth() + 1}/${searchWindowAgo.getDate()}`;
    const q = `(subject:"stop sale" OR subject:"open sale" OR subject:"stop&open sale") after:${dateStr}`;

    let threads = [];
    let pageToken = '';
    for (let i = 0; i < 2; i++) {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(q)}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const listData = await listRes.json();
      threads = threads.concat(listData.threads || []);
      if (!listData.nextPageToken || threads.length >= 80) break;
      pageToken = listData.nextPageToken;
    }

    const threadList = threads.slice(0, 80);
    const detailResults = [];
    for (const group of chunk(threadList, 8)) {
      const dets = await Promise.all(
        group.map(th =>
          fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ).then(r => r.json())
        )
      );
      detailResults.push(...dets);
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rows = [];

    for (const det of detailResults) {
      const msgs = det.messages || [];
      for (const msg of msgs) {
        const subject = getHeader(msg, 'Subject');
        const from = getHeader(msg, 'From');
        const sType = subjectType(subject);
        const bodyText = findBodyText(msg.payload);
        const entries = extractDatedEntries(bodyText, sType);

        const hotel = hotelFromSender(from);
        const futureEntries = entries.filter(e => e.dateEnd >= today);

        if (futureEntries.length > 0) {
          for (const e of futureEntries) {
            rows.push({
              hotel, subject,
              dateStart: fmtDate(e.dateStart),
              dateEnd: fmtDate(e.dateEnd),
              dateStartSort: e.dateStart.getTime(),
              type: e.type,
              context: e.context
            });
          }
        } else {
          // Tarih hiç çıkarılamadıysa (nadiren, farklı bir format) - yine de
          // görünür kalsın ki personel mail'e bakabilsin, en sona sıralanır.
          rows.push({
            hotel, subject,
            dateStart: null, dateEnd: null, dateStartSort: Infinity,
            type: sType, context: 'Tarih otomatik çıkarılamadı — mail\'e bakın'
          });
        }
      }
    }

    // Aynı otel+tarih+tip+bağlam kombinasyonu tekrar ediyorsa (aynı mail birden
    // fazla alıcıya gitmiş olabilir) tekilleştir.
    const seen = new Set();
    const deduped = rows.filter(r => {
      const key = r.hotel + '|' + r.dateStart + '|' + r.dateEnd + '|' + r.type + '|' + r.context;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => a.dateStartSort - b.dateStartSort);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      count: deduped.length,
      generatedAt: new Date().toISOString(),
      items: deduped
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
}
