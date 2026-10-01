/** Сравнить, что про предложение думает стол и что — планировщик. */
import fs from 'fs';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('/studio'));

let plan = null;
page.on('response', async (r) => {
    if (r.url().includes('/api/sync/plan')) { try { plan = await r.json(); } catch {} }
});
await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Синхронизировать/i.test(x.textContent.trim()));
    b?.click();
});
await new Promise((r) => setTimeout(r, 25000));
if (!plan) { console.log('ответа плана не поймал'); await browser.disconnect(); process.exit(1); }
fs.writeFileSync('/tmp/claude-1000/plan-live.json', JSON.stringify(plan));

const s = plan.sentences;
console.log('предложений в ответе:', s.length);
const nofit = s.filter((x) => !x.fits);
console.log('не влезает:', nofit.length, '| на потолке (rate≥3.99):', s.filter((x) => x.rate >= 3.99).length);
console.log('\nпервые не влезающие:');
for (const x of nofit.slice(0, 6))
    console.log(`  #${x.index + 1} rate=${x.rate} речь=${x.spoken}с жесты=${x.gestures}с нехватка=${x.deficit}с · ${x.text.slice(0, 50)}`);

// Предложение 2 — то, что открыто в инспекторе.
const two = s[1];
console.log('\nпредложение 2 по данным плана:');
console.log(`  речь=${two.spoken}с | клипы=${two.gestures}с | пауза=${two.pause}с | rate=${two.rate} | влезает=${two.fits} | глоссов=${two.gloss_count} | без длительности=${two.unknown_glosses}`);
const own = two.glosses.reduce((acc, g, i) => {
    const inner = Math.max(0, (g.letters || 0) - 1) * plan.letter_pause_seconds;
    const trail = i < two.glosses.length - 1 ? plan.pause_seconds : 0;
    return acc + ((g.duration || 0) + inner + trail);
}, 0);
console.log(`  сумма при скорости 1 = ${own.toFixed(2)}с → при rate ${two.rate} = ${(own / two.rate).toFixed(2)}с`);
await browser.disconnect();
