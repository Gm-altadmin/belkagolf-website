const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

let cachedData = null;

function loadData() {
  if (cachedData) return cachedData;
  const filePath = path.join(__dirname, 'data', 'hotel-packages.xlsx');
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });

  const headerIdx = rows.findIndex(r => r && r[0] === 'Otel');
  const data = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !r[1] || !r[2]) continue;
    data.push({
      hotel: String(r[0]).trim(),
      start: r[1],
      end: r[2]
    });
  }
  cachedData = data;
  return data;
}

// "26.08.2026" formatındaki tarihi Date nesnesine çevirir
function parseDate(str) {
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(dateObj) {
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}.${m}.${y}`;
}

// Ardışık/örtüşen (veya 1 gün arayla biten-başlayan) dönemleri tek bloğa birleştirir
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    const gapDays = (cur.start - last.end) / (1000 * 60 * 60 * 24);
    if (gapDays <= 1) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

module.exports = (req, res) => {
  try {
    const { hotel } = req.query;
    if (!hotel) {
      res.status(400).json({ error: 'missing_params' });
      return;
    }

    const data = loadData();
    const ranges = data
      .filter(row => row.hotel === hotel)
      .map(row => ({ start: parseDate(row.start), end: parseDate(row.end) }));

    if (ranges.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const merged = mergeRanges(ranges);
    const result = merged.map(r => ({
      start: formatDate(r.start),
      end: formatDate(r.end)
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ranges: result });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
};
