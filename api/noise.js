// Gürültü Kontrolü sekmesi için BİRLEŞİK endpoint (Vercel Hobby plan 12
// serverless fonksiyon sınırını aşmamak için noise-scan.js + mark-noise.js
// tek dosyada birleştirildi - 29.08.2026).
//
// GET  /api/noise?password=...            -> tarama (eski noise-scan.js)
// POST /api/noise {password,senders:[...]} -> onaylanan göndericileri GitHub'a
//                                              kalıcı olarak commit eder (eski mark-noise.js)
//
// 30.08.2026 refactor: domain/Gmail yardımcıları artık api/lib/'den içe aktarılıyor
// (önceden rapor.js/stopsale.js ile birebir kopyalanmış haldeydi - kod tekrarı riski).

const { isOurDomain, isHotelDomain } = require('./lib/domains');
const { getAccessToken, getHeaderVal, extractEmailAddr, chunk } = require('./lib/gmail');

const KNOWN_AGENTS = ['rogerlode@hotmail.com'];

function isKnownAgent(addr) {
  const a = (addr || '').toLowerCase();
  return KNOWN_AGENTS.some((k) => a.includes(k));
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

async function handleScan(req, res) {
  const password = req.query.password || (req.body && req.body.password) || '';

  if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
    res.status(401).json({ error: 'Şifre hatalı.' });
    return;
  }
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    res.status(500).json({ error: 'GMAIL_REFRESH_TOKEN eksik.' });
    return;
  }

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

  const seen = new Map();
  for (const det of detailResults) {
    const msgs = det.messages || [];
    for (const msg of msgs) {
      const fromHeader = getHeaderVal(msg, 'From');
      const fromEmail = extractEmailAddr(fromHeader);
      if (!fromEmail) continue;
      if (isOurDomain(fromEmail)) continue;
      if (isHotelDomain(fromEmail)) continue;
      if (isKnownAgent(fromEmail)) continue;
      if (persistedNoise.has(fromEmail)) continue;
      if (seen.has(fromEmail)) continue;

      seen.set(fromEmail, {
        from: fromHeader,
        subject: getHeaderVal(msg, 'Subject'),
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
}

const REPO_OWNER = 'Gm-altadmin';
const REPO_NAME = 'belkagolf-website';
const FILE_PATH = 'api/data/noise-senders.json';
const BRANCH = 'main';

async function handleMark(req, res) {
  const { password, senders } = req.body || {};

  if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
    res.status(401).json({ error: 'Şifre hatalı.' });
    return;
  }
  if (!Array.isArray(senders) || senders.length === 0) {
    res.status(400).json({ error: 'missing_senders' });
    return;
  }
  if (!process.env.GITHUB_TOKEN) {
    res.status(500).json({ error: 'github_token_missing' });
    return;
  }

  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  const getRes = await fetch(`${apiUrl}?ref=${BRANCH}`, { headers });
  if (!getRes.ok) {
    const errBody = await getRes.text();
    res.status(502).json({ error: 'github_read_failed', detail: errBody.slice(0, 400) });
    return;
  }
  const getData = await getRes.json();
  const currentContent = JSON.parse(Buffer.from(getData.content, 'base64').toString('utf8'));
  const currentSenders = new Set((currentContent.senders || []).map((s) => s.toLowerCase()));

  const newOnes = senders.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  for (const s of newOnes) currentSenders.add(s);

  const updatedContent = { senders: [...currentSenders].sort() };
  const updatedBase64 = Buffer.from(JSON.stringify(updatedContent, null, 2) + '\n', 'utf8').toString('base64');

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Gürültü listesi güncellendi: ${newOnes.length} yeni gönderici eklendi`,
      content: updatedBase64,
      sha: getData.sha,
      branch: BRANCH
    })
  });

  if (!putRes.ok) {
    const errBody = await putRes.text();
    res.status(502).json({ error: 'github_write_failed', detail: errBody.slice(0, 400) });
    return;
  }

  res.status(200).json({
    success: true,
    addedCount: newOnes.length,
    totalSenders: updatedContent.senders.length
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      await handleScan(req, res);
    } else if (req.method === 'POST') {
      await handleMark(req, res);
    } else {
      res.status(405).json({ error: 'method_not_allowed' });
    }
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
};
