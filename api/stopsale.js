// Stop Sale / Open Sale takip API'si.
// Personelin en büyük sorunu: otel partnerlerinden gelen stop-sale/open-sale
// bültenlerini kaçırmak (müsaitlik değişikliği, hangi otelde/hangi tarihte
// satış durdu/açıldı). Bu endpoint son 30 günün bu tür maillerini KONU
// BAŞLIĞI bazlı arayıp (aynı "rapor" sisteminin -subject filtresinin tersi -
// pozitif eşleşme) otel/tarih/tip ile listeler.
//
// Aynı Gmail OAuth mekanizmasını (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN) api/rapor.js
// ile paylaşır - ayrı bir kurulum gerekmez.

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
  { domains: ['mardanpalace.com'], hotel: 'Mardan Palace' }
];

function hotelFromSender(addr) {
  const a = (addr || '').toLowerCase();
  const found = HOTEL_DOMAIN_MAP.find(h => h.domains.some(d => a.includes(d)));
  return found ? found.hotel : (a.split('@')[1] || 'Bilinmeyen');
}

function saleType(subject) {
  const s = (subject || '').toLowerCase();
  if (s.includes('stop&open') || (s.includes('stop sale') && s.includes('open sale'))) return 'both';
  if (s.includes('stop sale')) return 'stop';
  if (s.includes('open sale')) return 'open';
  return 'other';
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
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateStr = `${thirtyDaysAgo.getFullYear()}/${thirtyDaysAgo.getMonth() + 1}/${thirtyDaysAgo.getDate()}`;

    // KONU BAŞLIĞI bazlı pozitif eşleşme - "rapor" sistemindeki hariç tutma
    // filtresinin tersi. in:anywhere kullanmıyoruz - sadece inbox/arşiv, spam hariç.
    const q = `(subject:"stop sale" OR subject:"open sale" OR subject:"stop&open sale") after:${dateStr}`;

    let threads = [];
    let pageToken = '';
    for (let i = 0; i < 3; i++) {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(q)}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const listData = await listRes.json();
      threads = threads.concat(listData.threads || []);
      if (!listData.nextPageToken || threads.length >= 120) break;
      pageToken = listData.nextPageToken;
    }

    const threadList = threads.slice(0, 120);
    const detailResults = [];
    for (const group of chunk(threadList, 10)) {
      const dets = await Promise.all(
        group.map(th =>
          fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ).then(r => r.json())
        )
      );
      detailResults.push(...dets);
    }

    const items = [];
    for (const det of detailResults) {
      const msgs = det.messages || [];
      const last = msgs[msgs.length - 1];
      if (!last) continue;
      const subject = getHeader(last, 'Subject');
      const from = getHeader(last, 'From');
      const date = getHeader(last, 'Date');
      items.push({
        hotel: hotelFromSender(from),
        subject,
        from,
        date,
        type: saleType(subject),
        threadCount: msgs.length
      });
    }

    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      count: items.length,
      generatedAt: new Date().toISOString(),
      items
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
}
