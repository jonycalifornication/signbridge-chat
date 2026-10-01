/**
 * Почему в видео пропадают куски аватара.
 *
 * Гипотеза: трёхмерные меши отсекаются камерой (frustum culling) по
 * устаревшей сфере охвата — после `VRMUtils.combineSkeletons` она перестаёт
 * соответствовать реальной позе, и целый меш на кадр-другой исчезает.
 *
 * Проверяем счётчиком треугольников рендерера: если меш отсекли, число
 * нарисованных треугольников проваливается. Потом выключаем отсечение и
 * смотрим, исчезнет ли провал.
 */
import puppeteer from 'puppeteer';

const URL = process.env.WIDGET_URL || 'https://widget.signbridge.kz/embed.html';
const TEXT = process.env.TEXT || 'МЕН АДАМ БАРУ ҮЙ ЖАҚСЫ';

const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,1024'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1024 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });

await page.waitForFunction(() => window.avatarWidget?.currentVrm && window.avatarWidget?.renderer, { timeout: 90000 });

// Развернуть виджет: в свёрнутом виде аватар занимает угол, камера смотрит
// издали и отсечение не срабатывает — прошлая проба поэтому ничего и не нашла.
await page.evaluate(() => {
    window.avatarWidget.expand?.();
    window.dispatchEvent(new Event('resize'));
});
await new Promise((r) => setTimeout(r, 2500));
const size = await page.evaluate(() => {
    const c = window.avatarWidget.renderer.domElement;
    return { w: c.width, h: c.height, css: c.style.cssText.slice(0, 60) };
});
console.log('холст:', JSON.stringify(size));

const meshes = await page.evaluate(() => {
    const out = [];
    window.avatarWidget.currentVrm.scene.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
            out.push({
                name: o.name, skinned: !!o.isSkinnedMesh, frustumCulled: o.frustumCulled,
                radius: o.geometry?.boundingSphere?.radius ?? null,
            });
        }
    });
    return out;
});
console.log('мешей в модели:', meshes.length);
for (const m of meshes) console.log(`   ${m.skinned ? 'skinned' : 'mesh   '} frustumCulled=${m.frustumCulled} r=${m.radius} ${m.name}`);

async function sample(label) {
    await page.evaluate((text) => {
        window.__tri = []; window.__vis = [];
        const r = window.avatarWidget.renderer;
        if (!window.__patched) {
            const orig = r.render.bind(r);
            r.render = (...a) => {
                const res = orig(...a);
                window.__tri.push(r.info.render.triangles);
                // Кто именно отсечён: имена мешей, не попавших в кадр.
                const drawn = r.info.render.calls;
                window.__vis.push(drawn);
                return res;
            };
            window.__patched = true;
        }
        // Заодно следим за рукой: без движения проба ничего не значит —
        // статичная поза рисуется одинаково и «провалов» не будет никогда.
        window.__hand = [];
        const bone = window.avatarWidget.currentVrm.humanoid?.getNormalizedBoneNode?.('rightHand');
        window.__handTick = setInterval(() => {
            if (bone) { bone.updateWorldMatrix(true, false); window.__hand.push(bone.matrixWorld.elements.slice(12, 15).map(v => +v.toFixed(4))); }
        }, 100);
        window.avatarWidget.processTextSelection(text);
    }, TEXT);
    await new Promise((r) => setTimeout(r, 12000));
    const moved = await page.evaluate(() => {
        clearInterval(window.__handTick);
        const h = window.__hand || [];
        let d = 0;
        for (let i = 1; i < h.length; i++) d += Math.abs(h[i][0]-h[i-1][0]) + Math.abs(h[i][1]-h[i-1][1]) + Math.abs(h[i][2]-h[i-1][2]);
        return { samples: h.length, path: +d.toFixed(3) };
    });
    console.log(`${label}: рука прошла ${moved.path} (проб ${moved.samples}) — ${moved.path > 0.2 ? 'жесты игрались' : 'ДВИЖЕНИЯ НЕ БЫЛО'}`);
    const tri = await page.evaluate(() => window.__tri.slice());
    if (!tri.length) return console.log(`${label}: кадров не поймал`);
    const sorted = [...tri].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const low = tri.filter((t) => t < med * 0.9).length;
    console.log(`${label}: кадров ${tri.length}, медиана треугольников ${med}, `
        + `минимум ${sorted[0]} (${(sorted[0] / med * 100).toFixed(0)}% от медианы), `
        + `кадров с провалом >10%: ${low} (${(low / tri.length * 100).toFixed(1)}%)`);
    const calls = await page.evaluate(() => window.__vis.slice());
    const cs = [...calls].sort((a,b)=>a-b);
    console.log(`   вызовов отрисовки: медиана ${cs[Math.floor(cs.length/2)]}, минимум ${cs[0]}, максимум ${cs.at(-1)}`);
}

await sample('отсечение ВКЛЮЧЕНО (как сейчас)');

await page.evaluate(() => {
    window.avatarWidget.currentVrm.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
});
await sample('отсечение ВЫКЛЮЧЕНО');

await browser.close();
