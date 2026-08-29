// Gürültü Kontrolü sekmesi için: son 8 günün sales@/info@ trafiğindeki
// benzersiz göndericileri tarar, bilinen otel/kulüp domainleri ve bizim kendi
// domainimiz dışında kalanları Claude Haiku'ya gönderip "müşteri mi, otel
// partneri mi, yoksa gürültü mü" diye sınıflandırır. Sadece "gürültü"
// sınıflandırılanları döner - personel bunları /api/mark-noise ile kalıcı
// olarak NOISE_SENDERS listesine (noise-senders.json) ekleyebilir.

const OUR_DOMAIN = 'belkagolf.com';

const HOTEL_DOMAINS = [
  'maxxroyal.com', 'cajabymaxxroyal.com', 'corneliadiamond.com', 'regnumhotels.com',
  'cullinanhotels.com', 'cullinanlinksgolfclub.com', 'sueno.com.tr', 'kayahotels.com.tr',
  'titanic-hotels.com', 'gloria.com.tr', 'kempinski.com', 'robinson.com', 'sirene.com.tr',
  'voyagehotel.com', 'swandorhotels.com', 'caryagolf.com', 'guvenok.com.tr',
  'mardanpalace.com', 'euromsg.net', 'agc.com.tr', 'nationalturkey.com'
];

// Bilinen aracı/acente - her zaman "müşteri talebi taşıyor" sayılır, Claude'a sormaya gerek yok.
const KNOWN_AGENTS = ['rogerlode@hotmail.com'];

function isOurDomain(addr) {
  return (addr || '').toLowerCase().includes(OUR_DOMAIN);
}
function isHotelDomain(addr) {
  const a = (addr || '').toLowerCase();
  return HOTEL_DOMAINS.some((d) => a.includes(d));
}
function isKnownAgent(addr) {
  const a = (addr || '').toLowerCase();
  return KNOWN_AGENTS.some((k) => a.includes(k));
}

function extractEmail(headerValue) {
  const m = (headerValue || '').match(/<([^>]+)>/);
  if (m) return m[1].toLowerCase();
  return (headerValue || '').trim().toLowerCase();
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
    throw new Error('Access token alınamadı. Detay: ' + JSON.stringify(data));
  }
  return data.access_token;
}

function getHeaderFrom(msg, name) {
  const headers = msg.payload ? msg.payload.headers || [] : [];
  return (headers.find((h) => h.name === name) || {}).value || '';
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function loadPersistedNoise() {
  try {
    const path = require('path');
    const fs = require('fs');
    const filePath = path.join(__dirname, 'data', 'noise-senders.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new Set((raw.senders || []).map((s) => s.toLowerCase()));
  } catch (e) {
    return new Set();
  }
}

async function classifySenders(candidates) {
  if (!process.env.ANTHROPIC_API_KEY || candidates.length === 0) return [];

  const listText = candidates
    .map((c, i) => `${i + 1}. Gönderen: ${c.from}\n   Konu: ${c.subject}\n   Özet: ${c.snippet.slice(0, 200)}`)
    .join('\n\n');

  const systemPrompt = `Sen bir golf tatili acentesinin (Belka Golf, Belek/Antalya) mail kutusunu inceleyen bir asistansın.
Sana sales@/info@ adreslerine gelmiş bir dizi mail (gönderen + konu + özet) verilecek. Bu göndericilerin
HİÇBİRİ bilinen otel/golf kulübü ortaklarımızdan DEĞİL (onlar zaten filtrelendi) ve bizim kendi
domainimizden de değil.

Her biri için ÜÇ kategoriden birini seç:
- "customer": gerçek bir müşteri talebi, soru, rezervasyon, ödeme, veya bir acente/aracının ilettiği müşteri talebi.
- "hotel_partner": tanımadığımız ama gerçek bir otel/golf kulübü/tur operatörü partnerinden gelen iş yazışması
  (fiyat teklifi, rezervasyon onayı, stop-sale bülteni vb.).
- "noise": bülten, reklam, otomatik sistem bildirimi, spam, alakasız toplu mail - gerçek bir iş
  yazışması değil.

SADECE "noise" olarak sınıflandırdıklarını, kısa bir gerekçeyle, JSON dizisi olarak döndür.
Örnek format (başka hiçbir metin ekleme, sadece JSON):
[{"index": 2, "reason": "Golf turları hakkında toplu bülten, hiç yanıtlanmamış"}]

Eğer hiçbiri gürültü değilse boş dizi döndür: []`;

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: listText }]
    })
  });

  if (!apiRes.ok) {
    throw new Error('Anthropic API hatası: ' + (await apiRes.text()).slice(0, 300));
  }

  const data = await apiRes.json();
  const rawText = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

module.exports = async (req, res) => {
  const password = req.query.password || (req.body && req.body.password) || '';

  if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
    res.status(401).json({ error: 'Şifre hatalı.' });
    return;
  }
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    res.status(500).json({ error: 'GMAIL_REFRESH_TOKEN eksik.' });
    return;
  }

  try {
    const accessToken = await getAccessToken();

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const dateStr = `${eightDaysAgo.getFullYear()}/${eightDaysAgo.getMonth() + 1}/${eightDaysAgo.getDate()}`;
    const q = `(from:sales@belkagolf.com OR to:sales@belkagolf.com OR from:info@belkagolf.com OR to:info@belkagolf.com OR to:mb@belkagolf.com OR cc:mb@belkagolf.com) after:${dateStr}`;

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

    const persistedNoise = loadPersistedNoise();

    // Benzersiz "dış" göndericileri topla (bizim domain, bilinen otel domaini,
    // bilinen acente, veya zaten kalıcı gürültü listesinde olanlar hariç).
    const seen = new Map();
    for (const det of detailResults) {
      const msgs = det.messages || [];
      for (const msg of msgs) {
        const fromHeader = getHeaderFrom(msg, 'From');
        const fromEmail = extractEmail(fromHeader);
        if (!fromEmail) continue;
        if (isOurDomain(fromEmail)) continue;
        if (isHotelDomain(fromEmail)) continue;
        if (isKnownAgent(fromEmail)) continue;
        if (persistedNoise.has(fromEmail)) continue;
        if (seen.has(fromEmail)) continue;

        seen.set(fromEmail, {
          from: fromHeader,
          subject: getHeaderFrom(msg, 'Subject'),
          snippet: msg.snippet || ''
        });
      }
    }

    const candidates = [...seen.values()];
    const noiseResults = await classifySenders(candidates);

    const flagged = noiseResults
      .map((r) => {
        const c = candidates[r.index - 1];
        if (!c) return null;
        return { from: c.from, subject: c.subject, snippet: c.snippet, reason: r.reason || '' };
      })
      .filter(Boolean);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      scannedSenders: candidates.length,
      candidates: flagged
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
