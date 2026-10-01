/**
 * Наблюдение за живым показом: ровно ли идут кадры и что происходит на стыке.
 *
 * Рендерер видео подменяет виджету время на детерминированное — там каждый
 * кадр ровно 33.3 мс, и любая заминка в запись не попадает. Живьём часы
 * настоящие. Замеряем именно их: дельты между кадрами во время показа того
 * самого стыка из проекта (дактиль → нулевая пауза → следующее на 2.2×).
 */
import puppeteer from "puppeteer";
import fs from "node:fs";

const seam = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const URL = process.env.WIDGET_URL || "https://widget.signbridge.kz/embed.html";

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=gl-egl",
    "--enable-gpu",
    "--disable-gpu-sandbox",
    "--disable-software-rasterizer",
    "--ozone-platform=headless",
    "--enable-gpu-rasterization",
    "--enable-zero-copy",
    "--ignore-gpu-blocklist",
    "--disable-web-security",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on("pageerror", (e) => console.log("  [ошибка]", String(e).slice(0, 120)));
page.on("console", (m) => {
  const t = m.text();
  console.log("  [виджет]", t.slice(0, 100));
});
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction("!!window.avatarWidget && !!window.avatarWidget.renderer", { timeout: 90000 });

// Записываем дельты кадров и отметки событий виджета.
await page.evaluate(() => {
  window.__frames = [];
  window.__hand = [];   // скорость кисти по кадрам — мерка «дёрганья»
  window.__marks = [];
  const raf = window.requestAnimationFrame.bind(window);
  let prev = performance.now();
  // Кисть берём из гуманоида VRM: её мировая позиция — то, что видит зритель.
  // Кость ищем ЛЕНИВО: на момент внедрения VRM может быть ещё не загружена,
  // и единственная попытка при старте всегда промахивалась.
  let hand = null;
  function findHand() {
    const w = window.avatarWidget;
    const vrm = w && w.currentVrm;
    if (!vrm) return null;
    const hum = vrm.humanoid;
    let node =
      (hum && (hum.getNormalizedBoneNode?.("rightHand") || hum.getRawBoneNode?.("rightHand"))) ||
      null;
    if (!node && vrm.scene) {
      vrm.scene.traverse((o) => {
        const n = (o.name || "").toLowerCase();
        if (!node && n.includes("hand") && (n.includes("right") || n.endsWith("_r") || n.startsWith("r_"))) {
          node = o;
        }
      });
    }
    return node;
  }
  let last = null;
  const tick = () => {
    const now = performance.now();
    const dt = now - prev;
    window.__frames.push(+dt.toFixed(2));
    if (!hand) {
      hand = findHand();
      if (hand) window.__handName = hand.name || "(без имени)";
    }
    if (hand && dt > 0) {
      // Позицию берём прямо из матрицы: конструктор THREE со страницы
      // недоступен — виджет собран модулем и наружу его не кладёт.
      hand.updateWorldMatrix(true, false);
      const e = hand.matrixWorld.elements;
      const p = { x: e[12], y: e[13], z: e[14] };
      if (last) {
        const d = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
        // единиц в секунду: скорость, а не путь за кадр
        window.__hand.push(+((d / dt) * 1000).toFixed(4));
      }
      last = p;
    }
    prev = now;
    raf(tick);
  };
  raf(tick);
  window.addEventListener("message", (e) => {
    const t = e.data && e.data.type;
    if (t === "AVATAR_SENTENCE_START" || t === "AVATAR_WORD_START") {
      window.__marks.push({ at: window.__frames.length, type: t, payload: e.data.payload });
    }
  });
});

const done = page.evaluate(
  (payload) =>
    new Promise((resolve) => {
      const onMsg = (e) => {
        if (e.data && e.data.type === "AVATAR_ANIMATION_DONE") {
          window.removeEventListener("message", onMsg);
          resolve(true);
        }
      };
      window.addEventListener("message", onMsg);
      window.postMessage({ action: "PLAY_TEXT", payload }, "*");
    }),
  {
    text: seam.sentences.join("\n"),
    sentences: seam.sentences,
    glossed: true,
    tokens: seam.tokens,
    speeds: seam.speeds.map(() => Number(process.env.RATE || 0) || undefined).some(Boolean)
      ? seam.speeds.map(() => Number(process.env.RATE))
      : seam.speeds,
    pauses: seam.pauses,
  },
);
await Promise.race([done, new Promise((r) => setTimeout(r, 120000))]);

const out = await page.evaluate(() => ({
  frames: window.__frames,
  marks: window.__marks,
  hand: window.__hand,
  handName: window.__handName,
  clips: [...(window.avatarWidget.animationCache || new Map()).entries()]
    .map(([k, v]) => [String(k).slice(-40), v && v.duration])
    .filter(([, d]) => typeof d === "number"),
}));
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log(`кадров записано: ${out.frames.length}, отметок: ${out.marks.length}`);
await browser.close();
