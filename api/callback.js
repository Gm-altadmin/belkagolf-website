// Google, izin verildikten sonra kullanıcıyı buraya geri gönderir.
// Bu dosya, o kodu Google'dan gerçek erişim bilgilerine çevirir
// ve size (SADECE İLK KURULUMDA) refresh_token'ı bir kerelik gösterir.
export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    res.status(400).send(`<h2>Hata</h2><p>${error}</p>`);
    return;
  }
  if (!code) {
    res.status(400).send('<h2>Kod bulunamadı.</h2>');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        redirect_uri: 'https://belkagolf-website.vercel.app/api/auth/callback',
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();

    if (!tokens.refresh_token) {
      res.status(200).send(`
        <html><body style="font-family:sans-serif;padding:40px;max-width:700px;margin:0 auto;">
        <h2>Refresh token alınamadı</h2>
        <p>Google bu sefer refresh_token döndürmedi. Bu genelde daha önce aynı hesaba
        izin verilmiş olduğunda olur. Şu adrese gidip "Belka Golf Rapor" uygulamasının
        erişimini kaldırın, sonra /api/auth-start adresini tekrar ziyaret edin:</p>
        <p><a href="https://myaccount.google.com/permissions" target="_blank">
        myaccount.google.com/permissions</a></p>
        <pre style="background:#f4f4f4;padding:12px;overflow:auto;">${JSON.stringify(tokens, null, 2)}</pre>
        </body></html>
      `);
      return;
    }

    res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:700px;margin:0 auto;">
      <h2>✅ Başarılı!</h2>
      <p>Aşağıdaki değeri kopyalayıp Vercel'de <b>yeni bir Environment Variable</b> olarak ekleyin
      (aynı GMAIL_CLIENT_ID vb. eklediğiniz yerden):</p>
      <p><b>Key:</b> GMAIL_REFRESH_TOKEN</p>
      <p><b>Value:</b></p>
      <textarea readonly style="width:100%;height:90px;font-family:monospace;font-size:0.9rem;padding:10px;">${tokens.refresh_token}</textarea>
      <p style="color:#b00020;font-weight:bold;">Bu sayfayı kapattıktan sonra bu değeri bir daha
      göremezsiniz — şimdi kopyalayın.</p>
      </body></html>
    `);
  } catch (e) {
    res.status(500).send('<h2>Hata</h2><p>' + e.message + '</p>');
  }
}
