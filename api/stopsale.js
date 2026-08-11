// Stop Sale / Open Sale takip API'si (v3, 11.08.2026 - HTML tablo tabanlı yeniden yazım).
//
// v2'DEKİ HATA: mail gövdesini düz metne çevirip SATIR SATIR tarih+durum arıyordu.
// Ama bazı oteller (Gloria, Regnum - Word/Outlook üretimi HTML) tarihi tek hücrede
// veriyor, "Stop Sale" ifadesi satır başına değil sadece bir kere BÖLÜM BAŞLIĞINDA
// geçiyor (örn. "GLORIA SERENITY RESORT" başlığından sonra 6 tarih satırı, hiçbirinde
// "stop sale" yazmıyor). Satır bazlı arama bu durumda ya tarihi kaçırıyor ya da yanlış
// bir metne bağlıyordu.
//
// v3 ÇÖZÜMÜ: mail HTML'ini SIRALI olarak tarar (regex ile <tr>...</tr> bloklarını VE
// "stop sale"/"open sale" başlık kelimelerini karışık sırada, orijinal doküman
// sırasında bulur). Bir başlık kelimesi görülünce "geçerli tip" güncellenir; bir
// tablo satırı görülünce o satırın TÜM <td> hücreleri birleştirilip (tek "satır metni"
// oluşturulur - hücre içindeki <p>/<br> bölünmeleri artık sorun olmaz) o satırdan tarih
// aralığı çıkarılır ve o an geçerli olan tipe atanır. Satırın kendi içinde de bir
// stop/open kelimesi varsa (Voyage/Kempinski gibi), o öncelikli kullanılır.
// Ayrıca otel alt-adı başlıkları (örn. "GLORIA SERENITY RESORT") ayrıca takip edilip
// generic "Gloria Serenity/Golf/Verde" etiketi yerine doğru alt-otel adı kullanılıyor.
//
// Düz metne (plaintextBody) HİÇ güvenilmiyor artık - tablo yapısı kaybolduğunda satır
// sınırları güvenilmez hale geliyordu. Sadece HTML'den, tablo satırı bazlı çıkarım var.
// Hiç <tr> bulunamayan mailler (örn. sadece PDF ekli, gövdede tablo yok) için tarih
// üretilmez - "Tarih otomatik çıkarılamadı" ile gösterilir, YANLIŞ TARİH ÜRETİLMEZ.

function decodeBase64Url(data) {
  const b64 = (data || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function findHtmlBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === 'text/html' && p.body && p.body.data) return decodeBase64Url(p.body.data);
    }
    for (const p of payload.parts) {
      const r = findHtmlBody(p);
      if (r) return r;
    }
  }
  return '';
}

function findPlainBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === 'text/plain' && p.body && p.body.data) return decodeBase64Url(p.body.data);
    }
    for (const p of payload.parts) {
      const r = findPlainBody(p);
      if (r) return r;
    }
  }
  return '';
}

function cellText(td) {
  return td
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const DATE_RANGE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4}))?/;

function toDate(d, m, y) {
  const yr = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  return new Date(yr, parseInt(m, 10) - 1, parseInt(d, 10));
}

function fmtDate(d) {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

const STOP_RE = /stop sale|satışa kapalı|satisa kapali/i;
const OPEN_RE = /open sale|satışa açık|satisa acik/i;

// Bilinen otel alt-marka isimleri (tek hücreli, colspan başlık satırlarında görülür
// - Gloria/Regnum gibi Word tabanlı maillerde). Voyage gibi bazı oteller alt-otel
// adını SADECE subject'te veriyor, tablo içinde hiç geçmiyor - o yüzden subject'ten
// de ayrıca bakılıyor (extractFromHtml çağrılmadan önce).
const SUBHOTEL_NAMES = [
  'GLORIA SERENITY RESORT', 'GLORIA GOLF RESORT', 'GLORIA VERDE RESORT',
  'REGNUM CARYA', 'REGNUM THE CROWN', 'CAJA BY MAXX ROYAL', 'MAXX ROYAL BODRUM RESORT',
  'MAXX ROYAL BELEK GOLF RESORT', 'VOYAGE BELEK', 'VOYAGE SORGUN', 'VOYAGE TORBA',
  'VOYAGE KUNDU', 'SUENO HOTELS GOLF BELEK', 'SUENO HOTELS DELUXE BELEK'
];

// Subject'ten alt-otel adı çıkarmayı dener (Voyage gibi tabloya otel adı koymayan
// oteller için). Bulamazsa null döner, extractFromHtml içindeki tablo başlıkları
// (varsa) bunu ezip geçebilir.
function subHotelFromSubject(subject) {
  const upper = (subject || '').toUpperCase();
  return SUBHOTEL_NAMES.find(n => upper.includes(n)) || null;
}

// Mail HTML'ini sırayla tarar: <tr>...</tr> bloklarını ve stop/open anahtar
// kelimelerini orijinal sırada bulup "geçerli tip" ve "geçerli alt-otel" durumunu
// güncelleyerek her tablo satırından {dateStart, dateEnd, type, context, subHotel} çıkarır.
function extractFromHtml(html, subjectType, initialSubHotel) {
  const tokenRe = /(<tr[\s\S]*?<\/tr>)|(stop sale|open sale|satışa kapalı|satisa kapali|satışa açık|satisa acik)/gi;
  let currentType = subjectType;
  let currentSubHotel = initialSubHotel || null;
  const entries = [];
  let m;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[1]) {
      // <tr> bloğu - hücreleri ayıkla
      const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => cellText(x[1]));
      const rowText = tds.join(' ').trim();
      if (!rowText) continue;

      // Bu satır aslında bir otel alt-adı başlığı mı? (tek anlamlı hücre, bilinen isim)
      const upper = rowText.toUpperCase();
      const subMatch = SUBHOTEL_NAMES.find(n => upper.includes(n));
      if (subMatch && !DATE_RANGE_RE.test(rowText)) {
        currentSubHotel = subMatch;
        continue;
      }

      const dm = rowText.match(DATE_RANGE_RE);
      if (!dm) continue;
      const dateStart = toDate(dm[1], dm[2], dm[3]);
      const dateEnd = dm[4] ? toDate(dm[4], dm[5], dm[6]) : dateStart;
      if (isNaN(dateStart.getTime())) continue;

      let rowType = currentType;
      if (STOP_RE.test(rowText)) rowType = 'stop';
      else if (OPEN_RE.test(rowText)) rowType = 'open';

      let context = rowText
        .replace(DATE_RANGE_RE, '')
        .replace(/stop sale|open sale|satışa kapalı|satisa kapali|satışa açık|satisa acik|\(dahil\)|\(inc\)|\(incl\.?\)|\(included\)/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (context.length > 60) context = context.slice(0, 60) + '…';

      entries.push({ dateStart, dateEnd, type: rowType, context: context || null, subHotel: currentSubHotel });
    } else if (m[2]) {
      currentType = STOP_RE.test(m[2]) ? 'stop' : 'open';
    }
  }
  return entries;
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

    // Kullanıcı isteğiyle geçici olarak dışarıda tutulanlar (11.08.2026):
    // Voyage Sorgun (sadece bu alt-otel, diğer Voyage'lar kalıyor) ve Mardan Palace
    // (tüm otel). İleride kaldırılmak istenirse burası düzenlenmeli.
    const EXCLUDED_SUBHOTELS = new Set(['VOYAGE SORGUN']);
    const EXCLUDED_SENDER_DOMAINS = ['mardanpalace.com'];

    for (const det of detailResults) {
      const msgs = det.messages || [];
      for (const msg of msgs) {
        const subject = getHeader(msg, 'Subject');
        const from = getHeader(msg, 'From');

        if (EXCLUDED_SENDER_DOMAINS.some(d => from.toLowerCase().includes(d))) continue;
        const subHotelFromSubj = subHotelFromSubject(subject);
        if (subHotelFromSubj && EXCLUDED_SUBHOTELS.has(subHotelFromSubj)) continue;

        const sType = subjectType(subject);
        const html = findHtmlBody(msg.payload);
        const baseHotel = hotelFromSender(from);

        let entries = html ? extractFromHtml(html, sType, subHotelFromSubj) : [];

        // HTML'de hiç tablo satırı bulunamadıysa (nadir - genelde sadece PDF ekli
        // maillerde), düz metinden TEK TARİH aralığı denemesi yapılır (son çare,
        // düşük güven) - ama satır bazlı çoklu-tarih taraması YAPILMAZ (o v2'nin hatasıydı).
        if (entries.length === 0) {
          const plain = findPlainBody(msg.payload);
          const dm = plain.match(DATE_RANGE_RE);
          if (dm) {
            const dateStart = toDate(dm[1], dm[2], dm[3]);
            const dateEnd = dm[4] ? toDate(dm[4], dm[5], dm[6]) : dateStart;
            if (!isNaN(dateStart.getTime())) {
              entries = [{ dateStart, dateEnd, type: sType, context: '(tek tarih, düşük güven - mail\'e bakın)', subHotel: null }];
            }
          }
        }

        const futureEntries = entries.filter(e => e.dateEnd >= today);

        if (futureEntries.length > 0) {
          for (const e of futureEntries) {
            rows.push({
              hotel: e.subHotel ? toTitleCase(e.subHotel) : baseHotel,
              subject,
              dateStart: fmtDate(e.dateStart),
              dateEnd: fmtDate(e.dateEnd),
              dateStartSort: e.dateStart.getTime(),
              type: e.type,
              context: e.context
            });
          }
        } else {
          rows.push({
            hotel: baseHotel, subject,
            dateStart: null, dateEnd: null, dateStartSort: Infinity,
            type: sType, context: 'Tarih otomatik çıkarılamadı — mail\'e bakın (PDF ekli olabilir)'
          });
        }
      }
    }

    function toTitleCase(s) {
      return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

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
