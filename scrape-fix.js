const { chromium } = require('playwright');
const fs = require('fs');

const TOP_N = 50;
const FIXES = {
  2013: 'https://billboardtop100of.com/2013-2/',
  2015: 'https://billboardtop100of.com/2015-2/',
  2020: 'https://billboardtop100of.com/billboard-top-100-songs-2020-2/',
  2021: 'https://billboardtop100of.com/billboard-top-100-songs-of-2021-2/',
  2023: 'https://billboardtop100of.com/2023-2/',
};

function parseSongs(text, year) {
  const songs = [];

  // Format A (2020, 2021): rank\t"Title"\tArtist (handles smart quotes — both may be \u201C)
  const tabQuoteLines = text.split('\n').filter(l => /^\d+\t["\u201C\u201D]/.test(l.trim()));
  if (tabQuoteLines.length > 10) {
    for (const line of tabQuoteLines) {
      const m = line.trim().match(/^(\d+)\t["\u201C\u201D](.+?)["\u201C\u201D]\t(.+)$/);
      if (m) {
        const rank = parseInt(m[1], 10);
        if (rank > TOP_N) break;
        songs.push({ rank, title: m[2].trim(), artist: m[3].trim() });
      }
    }
    return songs;
  }

  // Format A2: rank\t"Title"\tArtist but tab might be spaces
  const spaceQuoteLines = text.split('\n').filter(l => /^\d+\s+["\u201C]/.test(l.trim()));
  if (spaceQuoteLines.length > 10) {
    for (const line of spaceQuoteLines) {
      const m = line.trim().match(/^(\d+)\s+["\u201C](.+?)["\u201D]\s+(.+)$/);
      if (m) {
        const rank = parseInt(m[1], 10);
        if (rank > TOP_N) break;
        songs.push({ rank, title: m[2].trim(), artist: m[3].trim() });
      }
    }
    return songs;
  }

  // Format B (2013): "1.    Artist – Title"
  const dotDashLines = text.split('\n').filter(l => /^\d+\.\s+.+[–—-]\s+.+/.test(l.trim()));
  if (dotDashLines.length > 10) {
    for (const line of dotDashLines) {
      const m = line.trim().match(/^(\d+)\.\s+(.+?)\s*[–—-]\s+(.+)$/);
      if (m) {
        const rank = parseInt(m[1], 10);
        if (rank > TOP_N) break;
        let artist = m[2].trim();
        let title = m[3].trim();
        songs.push({ rank, artist, title });
      }
    }
    return songs;
  }

  // Format C (2023): "1. Title\nArtist\n2. Title\nArtist"
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+)\.\s+(.+)$/);
    if (m) {
      const rank = parseInt(m[1], 10);
      if (rank > TOP_N) continue;
      const title = m[2].trim();
      // Next non-empty line is the artist
      let artist = '';
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        if (lines[j] && !/^\d+\./.test(lines[j]) && lines[j] !== 'LYRICS') {
          artist = lines[j].trim();
          break;
        }
      }
      if (title && artist) {
        songs.push({ rank, artist, title });
      }
    }
  }
  if (songs.length > 10) return songs;

  // Format D (2015): multi-line tabs: rank\n\tArtist\n\tTitle\nLYRICS
  const rawLines = text.split('\n');
  let idx = 0;
  while (idx < rawLines.length) {
    const rankMatch = rawLines[idx]?.trim().match(/^(\d+)$/);
    if (rankMatch) {
      const rank = parseInt(rankMatch[1], 10);
      // Scan next few lines for artist and title
      let artist = '', title = '';
      for (let j = idx + 1; j < idx + 8 && j < rawLines.length; j++) {
        const val = rawLines[j]?.trim();
        if (val && val !== 'LYRICS' && !/^\d+$/.test(val)) {
          if (!artist) artist = val;
          else if (!title) { title = val; break; }
        }
      }
      if (rank <= TOP_N && artist && title) {
        songs.push({ rank, artist, title });
      }
    }
    idx++;
  }
  return songs;
}

(async () => {
  const billboard = JSON.parse(fs.readFileSync('billboard.json', 'utf-8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  for (const [year, url] of Object.entries(FIXES)) {
    process.stdout.write(`${year}... `);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector('.entry-content', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const text = await page.evaluate(() =>
        document.querySelector('.entry-content')?.innerText || ''
      );

      const songs = parseSongs(text, parseInt(year));
      if (songs.length === 0) {
        // Dump raw for debugging
        const charCodes = text.substring(0, 200).split('').map(c => c.charCodeAt(0));
        console.log(`  Raw chars: ${charCodes.join(',')}`);
        console.log(`  Raw text: ${JSON.stringify(text.substring(0, 300))}`);
      }
      if (songs.length > 0) {
        billboard[year] = songs;
        console.log(`${songs.length} songs`);
        console.log(`  Sample: #1 "${songs[0].title}" - ${songs[0].artist}`);
      } else {
        console.log(`0 songs (parsing failed)`);
      }
    } catch (err) {
      console.log(`FAILED: ${err.message.substring(0, 80)}`);
    }
  }

  await browser.close();
  fs.writeFileSync('billboard.json', JSON.stringify(billboard, null, 2));
  console.log('\nSaved updated billboard.json');
})();
