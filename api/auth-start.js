// Bu adres SADECE İLK KURULUMDA bir kez ziyaret edilir.
// belkagolf-website.vercel.app/api/auth-start adresine gidip
// sales@ veya info@ hesabıyla giriş yapıp izin verince,
// callback sayfası size GMAIL_REFRESH_TOKEN değerini gösterecek.
export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    redirect_uri: 'https://belkagolf-website.vercel.app/api/auth/callback',
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent'
  });
  res.writeHead(302, {
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  });
  res.end();
}
