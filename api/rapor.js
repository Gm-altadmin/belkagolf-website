// Şifre ile korunan rapor API'si.
// /rapor.html buraya şifreyi gönderir, doğruysa son 10 günün
// sales@/info@ trafiğini Gmail'den çekip durum + öncelik ile döner.
//
// NOT: Bu, gerçek bir dil-anlama analizi DEĞİL - anahtar kelime ve
// "son mesajı kim attı" (biz mi, müşteri mi) mantığına dayalı bir
// yaklaşıklama. Chat'teki "rapor" komutunun yaptığı derin okuma/
// önceliklendirme (thread geçmişini anlama, kayıp-müşteri paternleri,
// çapraz-otel eşleştirme) burada YOK. Gerçek analiz için Claude API
// entegrasyonu gerekir (henüz kurulmadı).

const NOISE_SENDERS = [
  'stopsale@maxxroyal.com', 'opensale@maxxroyal.com',
  'stopsale@voyagehotel.com', 'opensale@voyagehotel.com',
  'stopsale@cajabymaxxroyal.com', 'opensale@cajabymaxxroyal.com',
  'sales@euromsg.net', 'email@email.qnb.com.tr',
  'noreply@mail.manus.im', 'bulten@rafinemedya.info'
];

const OUR_DOMAIN = 'belkagolf.com';

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

// 4 renk kuralı: ✅ konfirme, ❌ iptal/kayıp, 🟢 teklif gönderildi/müşteri sırası,
// 🔴 bizim tarafta bekleyen/cevapsız (ne kadar uzunsa o kadar öncelikli),
// 🟡 diğer bekleyen durumlar.
function classify({ snippet, subject, fromHeader, daysWaiting, isUrgentKw }) {
  const text = (snippet + ' ' + subject).toLowerCase();
  const lastFromUs = fromHeader.toLowerCase().includes(OUR_DOMAIN);

  if (/\biptal\b|cancel|no show|no-show|no longer/i.test(text)) {
    return { emoji: '❌', label: 'İptal / Kayıp', priority: -100 };
  }
  if (/konfirme|confirmed|onayland[ıi]/i.test(text)) {
    return { emoji: '✅', label: 'Onaylandı / Konfirme', priority: -50 };
  }
  if (!lastFromUs) {
    // Müşteriden son mesaj geldi, biz henüz cevap vermemişiz (veya cevabımız bu thread'de görünmüyor).
    let priority = daysWaiting * 2;
    if (isUrgentKw) priority += 100;
    return { emoji: '🔴', label: `Bizim tarafta bekliyor (${daysWaiting} gün)`, priority };
  }
  if (/teklif|offer|fiyat teklifi|quote/i.test(text)) {
    let priority = daysWaiting;
    if (isUrgentKw) priority += 50;
    return { emoji: '🟢', label: `Teklif gönderildi, cevap bekleniyor (${daysWaiting} gün)`, priority };
  }
  return { emoji: '🟡', label: `Diğer / bekliyor (${daysWaiting} gün)`, priority: daysWaiting };
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
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const det = await detRes.json();
      const msgs = det.messages || [];
      const first = msgs[0];
      const last = msgs[msgs.length - 1];
      if (!last) continue;

      const headers = last.payload ? last.payload.headers || [] : [];
      const getH = (name) => (headers.find((h) => h.name === name) || {}).value || '';
      const subject = getH('Subject');
      const from = getH('From');
      const date = getH('Date');
      const snippet = last.snippet || '';

      // Grup büyüklüğü ve URGENT tespiti için ilk mesajın snippet'ına da bak (ilk talep genelde en detaylı olur).
      const firstSnippet = first ? first.snippet || '' : '';
      const combinedText = subject + ' ' + snippet + ' ' + firstSnippet;
      const groupSize = extractGroupSize(combinedText);
      const isUrgentKw = /urgent|acil/i.test(combinedText);

      const daysWaiting = date ? daysBetween(new Date(date)) : 0;
      const status = classify({ snippet, subject, fromHeader: from, daysWaiting, isUrgentKw });

      let oneri = '—';
      if (status.emoji === '🔴') {
        oneri = 'Yanıt gönderilmeli' + (daysWaiting >= 3 ? ' (gecikme var)' : '');
      } else if (status.emoji === '🟢' && daysWaiting >= 5) {
        oneri = 'Hatırlatma maili gönderilebilir';
      }
      if (groupSize && groupSize >= 6) {
        oneri += (oneri === '—' ? '' : ' — ') + `Büyük grup (${groupSize} kişi)`;
      }
      if (isUrgentKw) {
        oneri = '🔺 URGENT — ' + (oneri === '—' ? 'öncelikli incelenmeli' : oneri);
      }

      items.push({
        threadId: th.id,
        subject,
        from,
        date,
        snippet,
        status: status.emoji,
        statusLabel: status.label,
        oneri,
        priority: status.priority,
        groupSize
      });
    }

    // Öncelik: kriter 1 (bekleme süresi) + acil bayrağı ağırlıklı skor, en yüksek önce.
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
