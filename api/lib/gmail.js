// Paylaşılan Gmail API yardımcı fonksiyonları (30.08.2026 refactor - rapor.js/noise.js/
// stopsale.js'de kopyalanmış haldeydi, tek yere taşındı). Bu dosya bir Vercel fonksiyonu
// export ETMİYOR - 12-fonksiyon sınırına dahil DEĞİL.

// (2) Token-expire hatası artık NET bir mesajla dönüyor - eskiden Google'ın ham JSON
// hatası (örn. "invalid_grant") kullanıcıya anlamsız görünüyordu, ne yapması gerektiğini
// söylemiyordu. Bu, gerçekten tekrar tekrar yaşanan bir sorundu (GMAIL_REFRESH_TOKEN
// ~haftalık expire oluyor) - artık "Gmail yetkilendirmeniz süresi dolmuş, /api/auth-start
// adresini tekrar ziyaret edin" diye açıkça söylüyor.
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
    if (data.error === 'invalid_grant') {
      throw new Error(
        'Gmail yetkilendirmeniz süresi dolmuş (refresh token geçersiz). ' +
        'Çözüm: https://belkagolf-website.vercel.app/api/auth-start adresini ziyaret edip ' +
        'yeniden yetkilendirin, çıkan yeni token\'ı Vercel\'deki GMAIL_REFRESH_TOKEN ' +
        'değişkeninin üzerine yazıp Redeploy yapın.'
      );
    }
    throw new Error('Gmail erişim tokenı alınamadı - GMAIL_REFRESH_TOKEN/CLIENT_ID/CLIENT_SECRET kurulu mu? Detay: ' + JSON.stringify(data));
  }
  return data.access_token;
}

function getHeaderVal(msg, name) {
  const headers = msg.payload ? msg.payload.headers || [] : [];
  return (headers.find((h) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
}

function extractEmailAddr(headerValue) {
  const m = (headerValue || '').match(/<([^>]+)>/);
  return m ? m[1].toLowerCase() : (headerValue || '').trim().toLowerCase();
}

// Küçük bir dizi elemanı BATCH_SIZE'lık parçalara böler - Gmail/Claude API'ye aşırı
// paralel istek atıp rate-limit yememek için, ama yine de seri fetch'ten çok daha hızlı.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Metin (HTML/mail gövdesi) için base64url -> STRING. Binary veri (Excel eki gibi) için
// KULLANMA - decodeBase64UrlToBuffer'ı kullan (string'e çevirmek binary'yi bozar).
function decodeBase64UrlToText(dataStr) {
  const b64 = (dataStr || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

// Binary ekler (Excel vb.) için base64url -> Buffer, string'e hiç uğramadan.
function decodeBase64UrlToBuffer(dataStr) {
  const b64 = (dataStr || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

module.exports = {
  getAccessToken, getHeaderVal, extractEmailAddr, chunk,
  decodeBase64UrlToText, decodeBase64UrlToBuffer
};
