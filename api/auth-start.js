// Bu adres SADECE yeni izin gerektiğinde (ilk kurulum ya da kapsam genişletme) ziyaret edilir.
// belkagolf-website.vercel.app/api/auth-start adresine gidip
// sales@ veya info@ hesabıyla giriş yapıp izin verince,
// callback sayfası size GMAIL_REFRESH_TOKEN değerini gösterecek.
// 30.08.2026: gmail.send eklendi - hatırlatma maili gönderme özelliği için gerekli.
// Yeniden yetkilendirme, yeni bir refresh token üretir - Vercel'deki GMAIL_REFRESH_TOKEN
// bu yeni değerle GÜNCELLENMELİ (üzerine yazılmalı), eskisi geçersiz olmaz ama yeni izni
// kapsamaz.
export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    redirect_uri: 'https://belkagolf-website.vercel.app/api/auth/callback',
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent'
  });
  res.writeHead(302, {
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  });
  res.end();
}
