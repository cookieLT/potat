/* Invariant sweeps for the Po Tat daily loop.
 *
 *   node test-routine.js            # sweeps index.html in this folder
 *   node test-routine.js other.html
 *
 * Needs Playwright with a Chromium available:
 *   npm i -D playwright && npx playwright install chromium
 * (or set PW_CHROMIUM to an existing binary)
 *
 * Every bug this file guards against actually shipped once. Extend it rather
 * than spot-checking a single day — the interesting failures only appear at
 * anchor combinations nobody would think to try by hand.
 */
const { chromium } = require('playwright');
const path = require('path');

const FILE = path.resolve(process.argv[2] || 'index.html');
const pad = n => (n < 10 ? '0' + n : '' + n);

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log(`  ok    ${name}`); }
  else { failures++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};

(async () => {
  const launch = {};
  if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto('file://' + FILE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(400);

  console.log(`\nsweeping ${path.basename(FILE)}\n`);

  // ---------- 1. the app loads at all ----------
  check('loads with no page errors on a fresh install', pageErrors.length === 0, pageErrors.join(' | '));
  check('renders the Day tab', (await page.locator('#v-day .tl .ev').count()) > 0);

  // ---------- 2. anchor sweep ----------
  const anchors = await page.evaluate(() => {
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const fails = []; let n = 0;
    for (let oh = 9; oh <= 15; oh++) for (const om of [0, 15, 30, 45])
    for (let ch = 20; ch <= 26; ch++) for (const cm of [0, 30]) {
      const A = JSON.parse(JSON.stringify(DB.routine));
      A.dayStart = pad(oh) + ':' + pad(om);
      A.penClose = pad(ch % 24) + ':' + pad(cm);
      A.out = { on: false, start: '14:00', mins: 120, withHer: true };
      for (const snack of [true, false]) {
        A.snack = snack; n++;
        let r;
        try { r = buildDay(A); }
        catch (e) { fails.push([A.dayStart, A.penClose, 'threw: ' + e.message]); continue; }
        const naps = r.steps.filter(s => s.k === 'nap')
                            .map(s => [s.t, s.t + A.cycle.nap]).sort((a, b) => a[0] - b[0]);
        r.steps.filter(s => s.k === 'meal').forEach(s => {
          if (naps.some(([a, z]) => s.t > a && s.t < z))
            fails.push([A.dayStart, A.penClose, s.lbl + ' inside a nap']);
        });
        for (let i = 1; i < naps.length; i++)
          if (naps[i][0] < naps[i - 1][1]) fails.push([A.dayStart, A.penClose, 'overlapping naps']);
        const w = r.steps.find(s => s.lbl === 'Wind-down');
        const bed = r.steps[r.steps.length - 1];
        if (w && bed.t - w.t < 45) fails.push([A.dayStart, A.penClose, 'wind-down only ' + (bed.t - w.t) + ' min']);
        if (bed.k !== 'bed') fails.push([A.dayStart, A.penClose, 'last step is not bed']);
        for (let i = 1; i < r.steps.length; i++)
          if (r.steps[i].t < r.steps[i - 1].t) fails.push([A.dayStart, A.penClose, 'steps out of order']);
        const outs = r.steps.filter(s => s.k === 'out').map(s => s.t);
        for (let i = 1; i < outs.length; i++)
          if (outs[i] - outs[i - 1] < 10)
            fails.push([A.dayStart, A.penClose, 'two trips ' + (outs[i] - outs[i - 1]) + ' min apart']);
      }
    }
    return { n, fails: fails.slice(0, 8), total: fails.length };
  });

  check(`anchor sweep (${anchors.n} combinations)`, anchors.total === 0,
    anchors.fails.map(f => f.join(' | ')).join('\n        '));

  // ---------- 3. outing sweep ----------
  const outings = await page.evaluate(() => {
    const fails = []; let n = 0;
    for (const withHer of [true, false])
    for (const close of ['23:30', '00:00', '22:30'])
    for (let h = 11; h <= 21; h++) for (const mins of [45, 90, 150, 240]) {
      const A = JSON.parse(JSON.stringify(DB.routine));
      A.dayStart = '11:00'; A.penClose = close;
      A.out = { on: true, start: (h < 10 ? '0' : '') + h + ':00', mins, withHer };
      n++;
      let r; try { r = buildDay(A); } catch (e) { fails.push([withHer, h, mins, 'threw: ' + e.message]); continue; }
      const naps = r.steps.filter(s => s.k === 'nap').map(s => [s.t, s.t + A.cycle.nap]).sort((a, b) => a[0] - b[0]);
      r.steps.filter(s => s.k === 'meal').forEach(s => {
        if (naps.some(([a, z]) => s.t > a && s.t < z)) fails.push([withHer, h, mins, s.lbl + ' inside a nap']);
      });
      for (let i = 1; i < naps.length; i++) if (naps[i][0] < naps[i - 1][1]) fails.push([withHer, h, mins, 'overlapping naps']);
      for (let i = 1; i < r.steps.length; i++) if (r.steps[i].t < r.steps[i - 1].t) fails.push([withHer, h, mins, 'steps out of order']);
      const hasBefore = r.steps.some(s => s.lbl === 'Outside before you leave');
      const hasAfter = r.steps.some(s => s.lbl === "Outside the moment you're back");
      if (!hasBefore || !hasAfter) fails.push([withHer, h, mins, 'missing a trip either side of the outing']);
    }
    return { n, fails: fails.slice(0, 8), total: fails.length };
  });
  check(`outing sweep (${outings.n} configurations)`, outings.total === 0,
    outings.fails.map(f => f.join(' | ')).join('\n        '));

  // ---------- 4. ordering is deterministic ----------
  const stable = await page.evaluate(() => {
    const key = () => JSON.stringify(buildDay(DB.routine).steps.map(s => s.t + s.k));
    const a = key();
    for (let i = 0; i < 50; i++) if (key() !== a) return false;
    return true;
  });
  check('step ordering stable across 50 rebuilds', stable);

  // ---------- 5. invariants are reported, not absorbed ----------
  const warns = await page.evaluate(() => {
    const A = JSON.parse(JSON.stringify(DB.routine));
    A.dayStart = '15:00'; A.penClose = '23:30';
    A.out = { on: false, start: '14:00', mins: 120, withHer: true };
    return buildDay(A).m.warn.map(w => w.k);
  });
  check('a late start reports cap, penned and fast',
    ['cap', 'penned', 'fast'].every(k => warns.includes(k)), 'got: ' + warns.join(','));

  // ---------- 6. ids cannot collide across devices ----------
  const ids = await page.evaluate(() => {
    const mk = () => { const s = []; for (let i = 0; i < 5; i++) s.push(newDeviceId()); return s; };
    const a = mk(), b = mk();
    return a.filter(x => b.includes(x)).length;
  });
  check('device tags do not collide', ids === 0);

  // ---------- 7. the Fromm chart is quoted exactly ----------
  const fromm = await page.evaluate(() => {
    // published rows must render as printed, thirds included
    const want = { 20: ['1¼', '1¾'], 30: ['1⅔', '2⅓'] };
    const b = FROMM_PUPPY_GOLD.brackets.find(x => x.k === '3-4mo');
    const out = {};
    for (const lb of [20, 30]) out[lb] = cupsFor(b, lb).map(cupTxt);
    return { out, want };
  });
  check('Fromm 3–4mo rows render as published',
    JSON.stringify(fromm.out) === JSON.stringify(fromm.want), JSON.stringify(fromm.out));

  // ---------- 8. a restored backup is normalised ----------
  const restored = await page.evaluate(() => {
    const legacy = {
      v: 1, seq: 3,
      events: [{ i: 1, t: 'pee', ts: Date.now() - 3600000, meta: {}, n: 'legacy' }],
      weights: [{ ts: Date.now(), w: 6.4 }],
      types: [], miles: [], done: {}, settings: { theme: 'auto' }
    };
    DB = normalize(JSON.parse(JSON.stringify(legacy)));
    const id = newId();
    return { hasDid: !!DB.did, idv: DB.idv, upgraded: DB.events[0].i, fresh: id, note: DB.events[0].n };
  });
  check('legacy backup normalises on restore',
    restored.hasDid && restored.idv === 2 && restored.note === 'legacy' &&
    restored.fresh.indexOf('undefined') < 0, JSON.stringify(restored));

  console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}\n`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})();