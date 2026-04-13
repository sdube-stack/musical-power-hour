const { chromium } = require('playwright');
const fs = require('fs');

const START_YEAR = 1970;
const END_YEAR = 2025;
const TOP_N = 50;
const OUTPUT = 'billboard.json';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const billboard = {};
  const failed = [];

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    process.stdout.write(`${year}... `);
    try {
      await page.goto(`https://billboardtop100of.com/${year}-2/`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // Wait for chart content to render
      await page.waitForSelector('.entry-content', { timeout: 10000 });
      await page.waitForTimeout(1000);

      const text = await page.evaluate(() =>
        document.querySelector('.entry-content')?.innerText || ''
      );

      const lines = text.split('\n').filter(l => /^\d+\t/.test(l.trim()));
      const songs = [];

      for (const line of lines) {
        const parts = line.trim().split('\t');
        if (parts.length >= 3) {
          const rank = parseInt(parts[0], 10);
          if (rank > TOP_N) break;
          songs.push({
            rank,
            artist: parts[1].trim(),
            title: parts[2].trim(),
          });
        }
      }

      billboard[year] = songs;
      process.stdout.write(`${songs.length} songs\n`);
    } catch (err) {
      process.stdout.write(`FAILED: ${err.message.substring(0, 60)}\n`);
      failed.push(year);
    }
  }

  await browser.close();
  fs.writeFileSync(OUTPUT, JSON.stringify(billboard, null, 2));
  console.log(`\nSaved to ${OUTPUT}`);
  if (failed.length) console.log(`Failed: ${failed.join(', ')}`);
})();
