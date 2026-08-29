// Gürültü Kontrolü sekmesinde işaretlenip "Gürültüye Ekle" denen göndericileri
// GitHub Contents API üzerinden api/data/noise-senders.json dosyasına otomatik
// commit eder. GITHUB_TOKEN (repo'ya sınırlı, Contents:Read&Write yetkili
// fine-grained PAT) env variable gerekir. Commit sonrası Vercel otomatik
// redeploy eder (~30-60sn) - rapor.js bir sonraki çalıştırmada güncel listeyi okur.

const REPO_OWNER = 'Gm-altadmin';
const REPO_NAME = 'belkagolf-website';
const FILE_PATH = 'api/data/noise-senders.json';
const BRANCH = 'main';

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

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

    // Mevcut dosyayı oku (sha gerekli, GitHub'ın "update" işlemi buna dayanıyor -
    // eşzamanlı iki güncelleme çakışmasın diye).
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
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e.message || e) });
  }
};
