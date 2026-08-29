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
// Düz metne (plaintextBody) artık SINIRLI ve KALIP-BAZLI güveniliyor (v4, 29.08.2026):
// sadece extractFromPlainTextLines'daki çok spesifik "TARİH(-TARİH) tarihinde/tarihleri
// dahil ... STOP/OPEN SALE" satır kalıbına uyan satırlar kabul ediliyor - v2'nin genel-amaçlı,
// hataya açık satır taramasından farklı. HTML tablo (1. çare) her zaman önceliklidir; bu
// sadece HTML'de hiç <tr> yokken (Sueno gibi düz-metin mailler) devreye giren 2. çaredir.
// Hâlâ hiçbir kalıp eşleşmezse (örn. sadece PDF ekli, gövdede hiç yapı yok), 3. çare olarak
// TEK TARİH aralığı denemesi yapılır - "Tarih otomatik çıkarılamadı" ile gösterilir, YANLIŞ
// TARİH ÜRETİLMEZ.

// v5 EKLEMESİ (29.08.2026): bazı oteller (Sueno gibi) mail'e RENK-KODLU EXCEL TAKVİMİ
// ekliyor - her gün ayrı sütun (28.08.2026-31.12.2027 arası, ~494 gün!), her oda tipi
// ayrı satır, durum METİN değil HÜCRE RENGİYLE kodlanmış (kırmızı=STOP, yeşil=OPEN,
// turuncu=LIMITED). Mail metni sadece "önceki tablodan değişenler" (delta) listeliyor -
// asıl güncel/tam tablo bu Excel'de. extractFromColorCalendar bu ek varsa indirip
// (fetchAttachmentData) SheetJS ile (cellStyles:true - hücre dolgu rengini okumak için
// şart) satır satır tarar, ardışık aynı-renkli günleri tek tarih aralığına birleştirir.
// "open" (yeşil/müsait) günler aksiyon gerektirmediği için rapora dahil edilmez, sadece
// stop/limited kayıtları üretilir. Bu kaynak, HTML/düz-metin ayrıştırıcılarına EK olarak
// (onların yerine değil) devreye girer - ikisi birbirini tamamlar.

import * as XLSX from 'xlsx';

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
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const DATE_RANGE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4}))?/;

function toDate(d, m, y) {
  const yr = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  return new Date(yr, parseInt(m, 10) - 1, parseInt(d, 10));
}

function fmtDate(d) {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

const STOP_RE = /stop sale|satışa kapalı|satisa kapali/i;
const OPEN_RE = /open sale|satışa açık|satisa acik/i;

// v4 EKLEMESİ (29.08.2026): bazı oteller (Sueno gibi) stop-sale bilgisini HTML TABLOSU
// olarak DEĞİL, düz paragraf/satır metni olarak gönderiyor - örn:
//   "SUENO GOLF HOTEL BELEK
//    24.09.2026 tarihinde standart golf view oda tipi STOP SALE
//    15.10-18.10.2026 tarihleri dahil standart golf view oda tipi STOP SALE"
// extractFromHtml hiç <tr> bulamayınca (entries=[]), v3 tasarımı direkt "tek tarih,
// düşük güven" son çareye düşüyordu - bu, birden fazla tarih/oda tipi içeren mailleri
// tek bir belirsiz kayda indirgiyordu (Sueno örneğinde 11 gerçek kayıt yerine 1).
// Bu yeni ara katman, SATIR SATIR "TARİH(-TARİH) tarihinde/tarihleri dahil ... STOP/OPEN
// SALE" kalıbını tanır (v2'nin genel-amaçlı satır taramasından farklı - burada kalıp çok
// spesifik, yanlış eşleşme riski düşük) ve büyük harf başlık satırlarını (örn. "SUENO
// DELUXE HOTEL BELEK") alt-otel adı olarak takip eder.
const LINE_DATE_SALE_RE = /(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?:\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4}))?\s*tarih(?:inde|leri\s+dahil)\s+(.+?)\s+(STOP\s*SALE|OPEN\s*SALE|SATIŞA\s*KAPALI|SATIŞA\s*AÇIK)/i;

function isHeaderLine(line) {
  if (!line || line.length < 3 || line.length > 60) return false;
  if (/\d/.test(line)) return false;
  if (!/^[A-ZÇĞİÖŞÜ&/.,\- ]+$/.test(line)) return false;
  if (!/[A-ZÇĞİÖŞÜ]/.test(line)) return false;
  return true;
}

function extractFromPlainTextLines(text) {
  const lines = (text || '').split(/\r?\n/);
  let currentSubHotel = null;
  const entries = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(LINE_DATE_SALE_RE);
    if (m) {
      const d1 = parseInt(m[1], 10), mo1 = parseInt(m[2], 10);
      let y1 = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : null;
      let dateEnd;
      if (m[4]) {
        const d2 = parseInt(m[4], 10), mo2 = parseInt(m[5], 10);
        const y2 = m[6].length === 2 ? 2000 + parseInt(m[6], 10) : parseInt(m[6], 10);
        dateEnd = new Date(y2, mo2 - 1, d2);
        if (y1 === null) y1 = y2; // aralığın ilk tarihinde yıl yoksa bitiş tarihinden ödünç al
      }
      if (y1 === null) continue; // yıl hiç çıkarılamadıysa güvenli tarafta kal, atla
      const dateStart = new Date(y1, mo1 - 1, d1);
      if (!dateEnd) dateEnd = dateStart;
      if (isNaN(dateStart.getTime()) || isNaN(dateEnd.getTime())) continue;

      const saleKw = m[8].toUpperCase();
      const type = /STOP|KAPALI/.test(saleKw) ? 'stop' : 'open';
      let context = m[7].trim();
      if (context.length > 60) context = context.slice(0, 60) + '…';

      entries.push({ dateStart, dateEnd, type, context, subHotel: currentSubHotel });
    } else if (isHeaderLine(line)) {
      currentSubHotel = line;
    }
  }
  return entries;
}

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

// --- Renk-kodlu Excel takvimi (v5, bkz. yukarıdaki dosya başı yorumu) ---

const CALENDAR_COLOR_TYPE = [
  { rgbs: ['FF0000'], type: 'stop' },
  { rgbs: ['92D050'], type: 'open' },
  { rgbs: ['FFC000'], type: 'limited' }
];

function colorToCalendarType(rgb) {
  if (!rgb) return null;
  const clean = rgb.toUpperCase().slice(-6); // baştaki alpha kanalını (FF) at, sadece RRGGBB kalsın
  const found = CALENDAR_COLOR_TYPE.find((c) => c.rgbs.includes(clean));
  return found ? found.type : null;
}

function isSpreadsheetPart(part) {
  return part.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || (part.filename && /\.xlsx$/i.test(part.filename));
}

// MIME ağacında (nested multipart olabilir) gerçek ek (attachmentId'li) parçaları bulur.
function findAttachmentParts(payload, results = []) {
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.filename && p.body && p.body.attachmentId) results.push(p);
      findAttachmentParts(p, results);
    }
  }
  return results;
}

async function fetchAttachmentBuffer(accessToken, messageId, attachmentId) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!data.data) return null;
  return Buffer.from(decodeBase64Url(data.data), 'base64');
}

// Takvimi tarar: önce "başlık satırı"nı (art arda birden fazla gerçek Excel-tarih hücresi
// içeren ilk satır) bulur, o satırdan sütun->tarih haritası çıkarır. Sonraki her satırda
// A sütunu (otel adı, boşsa bir önceki dolu değer geçerli sayılır - forward-fill) ve B
// sütunu (oda/kategori adı) okunur; C sütunundan sonraki tarih sütunlarında ardışık
// aynı-renkli günler tek aralığa birleştirilir. Sadece stop/limited (aksiyon gerektiren)
// kayıtlar üretilir - "open" (müsait/yeşil) günler rapora dahil edilmez.
function extractFromColorCalendar(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true, cellDates: true });
  } catch (e) {
    return [];
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);

  let headerRow = -1, dateStartCol = -1;
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 5); r++) {
    let dateCount = 0, firstDateCol = -1;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'd') {
        if (firstDateCol === -1) firstDateCol = c;
        dateCount++;
      }
    }
    if (dateCount > 10) { headerRow = r; dateStartCol = firstDateCol; break; }
  }
  if (headerRow === -1) return [];

  const colDates = {};
  for (let c = dateStartCol; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (cell && cell.t === 'd') colDates[c] = cell.v;
  }

  const entries = [];
  let currentHotel = null;
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const hotelCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const labelCell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    if (hotelCell && hotelCell.v) currentHotel = String(hotelCell.v).trim();
    const label = labelCell && labelCell.v ? String(labelCell.v).trim() : null;
    if (!label || !currentHotel) continue;

    let runType = null, runStart = null, runEnd = null;
    const flushRun = () => {
      if (runType && runType !== 'open' && runStart) {
        entries.push({ dateStart: new Date(runStart), dateEnd: new Date(runEnd), type: runType, context: label, subHotel: currentHotel });
      }
      runType = null; runStart = null; runEnd = null;
    };
    for (let c = dateStartCol; c <= range.e.c; c++) {
      if (!colDates[c]) continue;
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const rgb = cell && cell.s && cell.s.fgColor ? cell.s.fgColor.rgb : null;
      const type = colorToCalendarType(rgb);
      const date = colDates[c];
      if (type === runType && runEnd) {
        const diffDays = Math.round((date - runEnd) / 86400000);
        if (diffDays === 1) { runEnd = date; continue; }
      }
      flushRun();
      if (type) { runType = type; runStart = date; runEnd = date; }
    }
    flushRun();
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

    // Kullanıcı isteğiyle geçici olarak dışarıda tutulanlar (11.08.2026, genişletildi):
    // Voyage Sorgun/Torba/Kundu (sadece bunlar, Voyage Belek kalıyor), Mardan Palace,
    // Rixos, Caja by Maxx Royal, Maxx Royal Bodrum Resort ve kendi belkagolf.com
    // adresimizden gelen (dahili/yanlış eşleşen) kayıtlar (tümü otel bazlı çalışılmıyor
    // ya da bizim kendi domainimiz). İleride kaldırılmak istenirse burası düzenlenmeli.
    const EXCLUDED_SUBHOTELS = new Set(['VOYAGE SORGUN', 'VOYAGE TORBA', 'VOYAGE KUNDU', 'MAXX ROYAL BODRUM RESORT']);
    const EXCLUDED_SENDER_DOMAINS = ['mardanpalace.com', 'rixos.com', 'cajabymaxxroyal.com', 'belkagolf.com'];

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

        // Renk-kodlu Excel takvimi var mı? (bkz. extractFromColorCalendar yorumu) - HTML/metin
        // sonucundan BAĞIMSIZ olarak, EK bilgi kaynağı olarak her zaman kontrol edilir (ikisi
        // birbirini dışlamaz, Excel çoğunlukla metinden çok daha kapsamlıdır).
        const attachmentParts = findAttachmentParts(msg.payload);
        for (const part of attachmentParts) {
          if (!isSpreadsheetPart(part)) continue;
          try {
            const buf = await fetchAttachmentBuffer(accessToken, msg.id, part.body.attachmentId);
            if (buf) {
              const calendarEntries = extractFromColorCalendar(buf);
              entries = entries.concat(calendarEntries);
            }
          } catch (e) {
            // Excel indirilemedi/okunamadı - sessizce atla, HTML/metin sonucu ne ise o kalır.
          }
        }

        // 1. çare (HTML tablo) + Excel takvimi boşsa: 2. çare - düz metin satır kalıbı (bkz. yukarıdaki
        // extractFromPlainTextLines yorumu, Sueno gibi tablosuz mailler için 29.08.2026 eklendi).
        if (entries.length === 0) {
          const plainLines = findPlainBody(msg.payload);
          entries = extractFromPlainTextLines(plainLines);
        }

        // 2. çare de boşsa (nadir - genelde sadece PDF ekli maillerde), düz metinden TEK
        // TARİH aralığı denemesi yapılır (son çare, düşük güven) - satır bazlı çoklu-tarih
        // taraması burada YAPILMAZ (o v2'nin hatasıydı, artık extractFromPlainTextLines var).
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

        // Bugün dahil geçmiş tarihler hariç tutulur - sadece BUGÜNDEN SONRAKİ
        // (yarından itibaren) tarihler gösterilir. Bitiş tarihi bugünse bile
        // artık geçerli sayılmıyor (kullanıcı isteği, 11.08.2026).
        const futureEntries = entries.filter(e => e.dateEnd > today);

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
        } else if (entries.length === 0) {
          // Sadece gerçekten hiç tarih ÇIKARILAMADIYSA bu satır gösterilir.
          // entries.length > 0 ama futureEntries.length === 0 ise (yani tarih
          // bulundu ama hepsi geçmişte kaldı), bu artık geçersiz bir bildirimdir -
          // hiç gösterilmez (yanlış "çıkarılamadı" mesajı vermek yerine).
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

    // Otel bazlı gruplama için: oteller ALFABETİK sıralanır, her otelin kendi
    // içinde tarihe göre (en yakın önce) sıralanır. Böylece aynı otelin tüm
    // bildirimleri ardışık gelir - frontend bunları tek grupta gösterebilir.
    deduped.sort((a, b) => {
      if (a.hotel !== b.hotel) return a.hotel.localeCompare(b.hotel, 'tr');
      return a.dateStartSort - b.dateStartSort;
    });

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
