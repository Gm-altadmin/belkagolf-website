// Fiyat Arama sekmesindeki "Analiz Et" butonu için: müşteri mailini
// Claude Haiku'ya gönderip tarih/gece/round/kişi sayısını JSON olarak çıkarır.
// Aynı şifre (RAPOR_SIFRE) ile korunur. ANTHROPIC_API_KEY env variable gerekir.

function buildSystemPrompt() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

  return `Sen bir golf tatili acentesinde çalışan bir asistansın. Sana müşteriden gelen
bir talep e-postası verilecek (Türkçe, İngilzce, Almanca, İsveççe veya Rusça olabilir).
Görevin: bu metinden rezervasyon arama için gereken bilgileri çıkarıp SADECE JSON döndürmek.

BUGÜNÜN TARİHİ: ${todayStr}. Mailde yıl belirtilmemişse (örn. "31 October - 7 November"),
bu tarihi BUGÜNDEN SONRAKİ en yakın gerçekleşme olarak yorumla - asla geçmiş bir yıl seçme.
Örnek: bugün ${todayStr} ise ve mail "15 Ocak" diyorsa, eğer 15 Ocak bu yıl içinde bugünden
önce kaldıysa gelecek yılın 15 Ocak'ını al; bugünden sonraysa bu yılın 15 Ocak'ını al.

Çıkaracağın alanlar:
- date: giriş (check-in) tarihi, "YYYY-MM-DD" formatında. Sadece TEK bir tarih ver (aralık verilmişse
  başlangıç tarihini al). Birden fazla ALTERNATİF tarih aralığı verilmişse (örn. "31 Ekim-7 Kasım VEYA
  7-14 Kasım") İLK alternatifi al. Emin değilsen veya metinde açık bir tarih yoksa null.
- nights: gece sayısı (sayı). Tarih aralığından hesaplanabiliyorsa hesapla (örn. 10-17 Eylül = 7 gece).
  Emin değilsen null.
- rounds: golf round (tur) sayısı. Sadece şu değerlerden biri olabilir: 1, 2, 3, 4, 5, 6, "Sınırsız", veya null.
  "sınırsız golf", "unlimited golf" gibi ifadeler "Sınırsız" sayılır. Belirtilmemişse null.
- pax: TOPLAM kişi sayısı (yetişkin + çocuk toplamı, golf oynasın oynamasın konaklayan herkes).
  Emin değilsen null.
- hotel: müşterinin ismen belirttiği otel varsa otelin adı (metindeki haliyle, kısa), yoksa null.

KURALLAR:
- Emin olmadığın hiçbir alanı UYDURMA - null bırak. Yanlış veri boş veriden daha kötüdür.
- Bugünün tarihi referans alınarak "gelecek ay", "eylül ortası" gibi göreceli ifadeleri YORUMLAMAYA ÇALIŞMA,
  böyle durumlarda date=null bırak (sadece açık tarih/gün varsa doldur).
- Çıktın SADECE geçerli bir JSON objesi olmalı, başka hiçbir metin, açıklama veya markdown kod bloğu (\`\`\`) ekleme.

Örnek çıktı formatı:
{"date":"2026-09-10","nights":7,"rounds":3,"pax":10,"hotel":"Regnum"}`;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const { password, text } = req.body || {};

    if (!process.env.RAPOR_SIFRE || password !== process.env.RAPOR_SIFRE) {
      res.status(401).json({ error: 'Şifre hatalı.' });
      return;
    }
    if (!text || !String(text).trim()) {
      res.status(400).json({ error: 'missing_text' });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'api_key_missing' });
      return;
    }

    // Aşırı uzun/kötü niyetli girdilere karşı basit bir üst sınır.
    const emailText = String(text).slice(0, 8000);

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: buildSystemPrompt(),
        messages: [
          { role: 'user', content: emailText }
        ]
      })
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      res.status(502).json({ error: 'anthropic_api_error', detail: errBody.slice(0, 500) });
      return;
    }

    const data = await apiRes.json();
    const rawText = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    // Model bazen istemeden ```json ... ``` bloğuna sarabilir - temizle.
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: 'parse_error', detail: rawText.slice(0, 500) });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      date: parsed.date || null,
      nights: parsed.nights || null,
      rounds: parsed.rounds || null,
      pax: parsed.pax || null,
      hotel: parsed.hotel || null
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
};
