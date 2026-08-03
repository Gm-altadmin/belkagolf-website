// Şifre ile korunan rapor API'si.
// /rapor.html buraya şifreyi gönderir, doğruysa son 10 günün
// sales@/info@ trafiğini Gmail'den çekip basit bir durum etiketiyle döner.
//
// NOT: Buradaki "durum" tespiti basit anahtar-kelime kurallarıyla çalışır.
// Chat'teki "rapor" komutunun yaptığı derinlemesine analiz (önceliklendirme,
// geçmiş kayıp-müşteri paternleri, öneri metinleri) burada YOK - bu ilk
// sürüm, canlı/otomatik bir "son talepler" görünümü sağlar.

const NOISE_SENDERS = [
  'stopsale@maxxroyal.com', 'opensale@maxxroyal.com',
  'stopsale@voyagehotel.com', 'opensale@voyagehotel.com',
  'stopsale@cajabymaxxroyal.com', 'opensale@cajabymaxxroyal.com',
  'sales@euromsg.net', 'email@email.qnb.com.tr',
  'noreply@mail.manus.im', 'bulten@rafinemedya.info'
];

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

function classify(text) {
  const t = text.toLowerCase();
  if (/konfirme|confirmed|onayland[ıi]/.test(t)) return { emoji: '✅', label: 'Onaylandı / Konfirme' };
  if (/\biptal\b|cancel|no show|no-show/.test(t)) return { emoji: '❌', label: 'İptal / Kayıp' };
  if (/teklif|offer|fiyat teklifi|price/.test(t)) return { emoji: '🟢', label: 'Teklifle ilgili' };
  return { emoji: '🟡', label: 'İnceleme gerekiyor' };
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
    for (const th of threads.slice(0, 30)) {
      const detRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const det = await detRes.json();
      const msgs = det.messages || [];
      const last = msgs[msgs.length - 1];
      if (!last) continue;

      const headers = last.payload ? last.payload.headers || [] : [];
      const getH = (name) => (headers.find((h) => h.name === name) || {}).value || '';
      const subject = getH('Subject');
      const from = getH('From');
      const date = getH('Date');
      const snippet = last.snippet || '';

      const status = classify(snippet + ' ' + subject);
      items.push({
        threadId: th.id,
        subject,
        from,
        date,
        snippet,
        status: status.emoji,
        statusLabel: status.label
      });
    }

    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: items.length,
      items
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
