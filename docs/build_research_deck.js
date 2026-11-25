// Builds docs/SSA-Recipient-Explorer-Research-Demo.pptx - the technical research-demo deck.
// Run: cd docs && npm install && npm run build:research
// Chart values are read from results/benchmark.json, so re-running tools/bench_backends.py and this
// script keeps the slides in step with the measurements.
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const fa = require('react-icons/fa');
const { applyTheme } = require('./apply_theme.js');

const OUT = path.join(__dirname, 'SSA-Recipient-Explorer-Research-Demo.pptx');
const BENCH = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'benchmark.json'), 'utf8'));
const SHOT = path.join(__dirname, 'screenshots', 'engine-crosscheck.png');

// ------------------------------------------------------------------ theme (dark, phosphor terminal)
const THEME = {
  name: 'SSA Research Demo',
  headFontFace: 'Courier New',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '0A120C', // slide background
    lt1: 'FFFFFF', // primary text
    dk2: '14241A', // card fill
    lt2: 'A9C4B0', // secondary text
    accent1: '3DDC84', // C++ engine (phosphor green)
    accent2: '7AA2D6', // PostgreSQL (blue)
    accent3: 'FFC857', // highlight (amber)
    accent4: 'FF6B6B', // failure / risk
    accent5: '5E7D68', // muted lines
    accent6: '2A4434', // card border
    hlink: '3DDC84',
    folHlink: '7AA2D6',
  },
};
const HEX = THEME.colors;
const ENGINE = HEX.accent1;
const PG = HEX.accent2;

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'Five Million Records, Two Engines';
pres.subject = 'SSA Recipient Explorer: in-memory C++ engine vs PostgreSQL - research programming demo';
const C = pres.SchemeColor;
const W = 10;
const H = 5.625;

// ------------------------------------------------------------------ layouts
const bg = () => ({ rect: { x: 0, y: 0, w: W, h: H, fill: { color: C.text1 } } });
const FOOT = 'SSA Recipient Explorer  ·  research programming demo  ·  all data synthetic';

pres.defineSlideMaster({ title: 'DARK_PLAIN', objects: [bg()] });
pres.defineSlideMaster({
  title: 'DARK_CONTENT',
  objects: [
    bg(),
    { text: { text: FOOT, options: { x: 0.5, y: 5.22, w: 7.5, h: 0.25, fontSize: 10, color: C.accent5, margin: 0, isTextBox: true } } },
    {
      placeholder: {
        options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 30, bold: true, color: C.background1, valign: 'middle', align: 'left', margin: 0 },
        text: '',
      },
    },
  ],
  slideNumber: { x: 9.0, y: 5.22, w: 0.5, h: 0.25, fontSize: 10, color: C.accent5, align: 'right', margin: 0 },
});

// ------------------------------------------------------------------ helpers
async function icon(name, hex) {
  const svg = renderToStaticMarkup(React.createElement(fa[name], { color: '#' + hex, size: 256 }));
  const png = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  return 'image/png;base64,' + png.toString('base64');
}
async function badge(s, name, x, y, d = 0.5, fill = C.accent1, iconHex = HEX.dk1) {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: 'icon-bg-' + name });
  const p = d * 0.26;
  s.addImage({ data: await icon(name, iconHex), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, altText: name.replace('Fa', '') + ' icon' });
}
function card(s, x, y, w, h, opts = {}) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: opts.fill || C.text2 },
    line: { color: opts.line || C.accent6, width: opts.lineW ?? 0.75 },
    objectName: opts.name || 'card',
  });
}
function text(s, str, o) {
  s.addText(str, Object.assign({ isTextBox: true, margin: 0, valign: 'top', color: C.background1, fontSize: 14 }, o));
}
const mono = (o) => Object.assign({ fontFace: THEME.headFontFace }, o);
const title = (s, t) => s.addText(t, { placeholder: 'title' });
const bullets = (items, o = {}) => items.map((t, i) => ({ text: t, options: Object.assign({ bullet: true, breakLine: i < items.length - 1 }, o) }));
const fmt = (ms) => (ms >= 100 ? Math.round(ms).toLocaleString('en-US') : ms.toFixed(1));
const caseBy = (name) => {
  const c = BENCH.cases.find((k) => k.case.startsWith(name));
  if (!c) throw new Error('benchmark case not found: ' + name);
  return c;
};
const ms = (c, b) => c[b].server_median_ms;

// common chart styling (identical on every chart)
const chartBase = {
  barDir: 'bar', barGrouping: 'clustered', catAxisOrientation: 'maxMin', chartColors: [ENGINE, PG],
  showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '#,##0.0', dataLabelFontSize: 10, dataLabelColor: HEX.lt1, dataLabelFontFace: '+mn-lt',
  catAxisLabelColor: HEX.lt2, catAxisLabelFontSize: 11, catAxisLabelFontFace: '+mn-lt', catAxisLineShow: false,
  valAxisHidden: true, valAxisLogScaleBase: 10, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
  showLegend: true, legendPos: 'b', legendFontSize: 11, legendColor: HEX.lt2, legendFontFace: '+mn-lt', barGapWidthPct: 60,
};

(async () => {
  // ============ 1. TITLE ============
  pres.addSection({ title: 'Question' });
  {
    const s = pres.addSlide({ masterName: 'DARK_PLAIN', sectionTitle: 'Question' });
    text(s, '> RESEARCH PROGRAMMING DEMO', mono({ x: 0.6, y: 0.85, w: 5.6, h: 0.3, fontSize: 12, bold: true, color: C.accent1, charSpacing: 2 }));
    text(s, 'Five Million Records, Two Engines', mono({ x: 0.6, y: 1.25, w: 5.6, h: 1.45, fontSize: 32, bold: true }));
    text(s, 'An in-memory C++23 engine vs PostgreSQL 16 for interactive search: speed, cost, and proof that both give the same answers',
      { x: 0.6, y: 2.85, w: 5.4, h: 1.0, fontSize: 16, color: C.background2 });
    text(s, 'SSA Recipient Explorer  ·  all data synthetic', { x: 0.6, y: 4.85, w: 5.4, h: 0.3, fontSize: 11, color: C.accent5 });

    const agg = caseBy('Aggregates, unfiltered');
    card(s, 6.55, 1.0, 2.95, 3.55, { name: 'title-readout' });
    text(s, 'AGGREGATE 5,000,000 ROWS', mono({ x: 6.8, y: 1.2, w: 2.5, h: 0.3, fontSize: 11, bold: true, color: C.accent1 }));
    text(s, 'C++ engine', { x: 6.8, y: 1.65, w: 2.5, h: 0.3, fontSize: 13, color: C.background2 });
    text(s, `${fmt(ms(agg, 'engine'))} ms`, mono({ x: 6.8, y: 1.95, w: 2.5, h: 0.55, fontSize: 30, bold: true, color: C.accent1 }));
    text(s, 'PostgreSQL 16', { x: 6.8, y: 2.65, w: 2.5, h: 0.3, fontSize: 13, color: C.background2 });
    text(s, `${fmt(ms(agg, 'postgres'))} ms`, mono({ x: 6.8, y: 2.95, w: 2.5, h: 0.55, fontSize: 30, bold: true, color: C.accent2 }));
    text(s, `${Math.round(agg.speedup)}× faster · identical results`, { x: 6.8, y: 3.85, w: 2.5, h: 0.45, fontSize: 14, bold: true, color: C.accent3 });
    s.addNotes(
`OPENING (30 sec)
- Research programming demo: same 5 million synthetic benefit records, two ways to answer interactive queries. A purpose-built C++ in-memory engine, and PostgreSQL 16 with every index we could justify.
- The number on the right is the headline: aggregating all 5 million rows takes about 20 ms in the engine and about 1.7 seconds in PostgreSQL. Identical results.

FRAME
- Three things today: how much faster, at what cost, and how we know the answers are the same.
- Everything is reproducible from the repository; there is a live demo in the middle.
- All data is synthetic: no real SSNs or people.`);
  }

  // ============ 2. QUESTION & HYPOTHESES ============
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Question' });
    title(s, 'Question and hypotheses');
    text(s, 'For interactive search over millions of records, how much does an in-memory columnar engine gain over a well-indexed PostgreSQL, and can we prove they agree?',
      { x: 0.5, y: 1.15, w: 9, h: 0.85, fontSize: 18, color: C.background1 });
    const hyp = [
      ['FaBolt', 'H1', 'Speed', 'The engine answers interactive queries an order of magnitude faster.'],
      ['FaBalanceScale', 'H2', 'Equivalence', 'Both backends return identical pages and aggregates, shown mechanically.'],
      ['FaMemory', 'H3', 'Cost', 'The price is a snapshot in RAM and a load step, not correctness.'],
    ];
    for (let i = 0; i < hyp.length; i++) {
      const [ic, id, head, body] = hyp[i];
      const x = 0.5 + i * 3.075;
      card(s, x, 2.25, 2.85, 2.6, { name: 'hypothesis-card' });
      await badge(s, ic, x + 0.25, 2.5, 0.55);
      text(s, id, mono({ x: x + 0.95, y: 2.55, w: 1.6, h: 0.45, fontSize: 22, bold: true, color: C.accent1, valign: 'middle' }));
      text(s, head, { x: x + 0.25, y: 3.25, w: 2.4, h: 0.35, fontSize: 16, bold: true });
      text(s, body, { x: x + 0.25, y: 3.65, w: 2.4, h: 1.1, fontSize: 14, color: C.background2 });
    }
    s.addNotes(
`THE QUESTION
- Analysts expect search to feel instant. The default answer is "put it in a database and index it". The alternative is a specialised in-memory engine. We measured the gap rather than guessing.

HYPOTHESES (we return to these on the conclusions slide)
- H1 speed: an order of magnitude on interactive queries.
- H2 equivalence: not just "the tests pass" but a mechanical proof both answer the same.
- H3 cost: what we give up is freshness (snapshot) and memory, not correctness.`);
  }

  // ============ 3. ARCHITECTURE ============
  pres.addSection({ title: 'System' });
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'System' });
    title(s, 'Architecture');
    // browser
    card(s, 0.5, 1.25, 2.4, 1.05, { name: 'arch-browser' });
    text(s, 'Browser', { x: 0.7, y: 1.35, w: 2.0, h: 0.3, fontSize: 15, bold: true });
    text(s, 'React + Bootstrap', { x: 0.7, y: 1.68, w: 2.0, h: 0.25, fontSize: 12, color: C.background2 });
    text(s, '?backend=engine|postgres', mono({ x: 0.7, y: 1.95, w: 2.1, h: 0.25, fontSize: 10, color: C.accent3 }));
    // wasm fallback
    card(s, 0.5, 2.6, 2.4, 2.25, { name: 'arch-wasm', fill: C.text1, line: C.accent5 });
    await badge(s, 'FaGlobe', 0.7, 2.8, 0.42, C.accent5, HEX.lt1);
    text(s, 'No server?', { x: 1.25, y: 2.86, w: 1.55, h: 0.3, fontSize: 14, bold: true });
    text(s, 'The same engine compiles to WebAssembly and runs in a Web Worker.', { x: 0.7, y: 3.35, w: 2.05, h: 1.35, fontSize: 13, color: C.background2 });
    // server
    card(s, 3.3, 1.25, 2.65, 3.6, { name: 'arch-server', line: C.accent3, lineW: 1.25 });
    text(s, 'ssa_server', mono({ x: 3.5, y: 1.4, w: 2.3, h: 0.35, fontSize: 17, bold: true, color: C.accent3 }));
    s.addText(bullets(['C++23, cpp-httplib', 'one request parser', 'one JSON format', 'connection pool, statement timeout', 'serves the UI']),
      { x: 3.5, y: 1.9, w: 2.3, h: 2.8, fontSize: 13, color: C.background1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 6 });
    // engine
    card(s, 6.4, 1.25, 3.1, 1.4, { name: 'arch-engine', line: C.accent1, lineW: 1.25 });
    await badge(s, 'FaMicrochip', 6.6, 1.45, 0.45, C.accent1);
    text(s, 'C++ engine', { x: 7.2, y: 1.48, w: 2.2, h: 0.35, fontSize: 15, bold: true, color: C.accent1 });
    text(s, 'in-memory, columnar, 91 MB for 5M rows', { x: 6.6, y: 2.0, w: 2.75, h: 0.55, fontSize: 12, color: C.background2 });
    // postgres
    card(s, 6.4, 3.45, 3.1, 1.4, { name: 'arch-postgres', line: C.accent2, lineW: 1.25 });
    await badge(s, 'FaDatabase', 6.6, 3.65, 0.45, C.accent2);
    text(s, 'PostgreSQL 16', { x: 7.2, y: 3.68, w: 2.2, h: 0.35, fontSize: 15, bold: true, color: C.accent2 });
    text(s, 'system of record, 13 indexes, 1.48 GB', { x: 6.6, y: 4.2, w: 2.75, h: 0.55, fontSize: 12, color: C.background2 });
    // arrows
    const arrow = (x, y, w, h, color, both = false) =>
      s.addShape(pres.ShapeType.line, { x, y, w, h, line: { color, width: 1.75, endArrowType: 'triangle', beginArrowType: both ? 'triangle' : undefined }, objectName: 'arch-arrow' });
    arrow(2.9, 1.78, 0.4, 0, C.background2, true);
    arrow(5.95, 1.95, 0.45, 0, C.accent1);
    arrow(5.95, 4.15, 0.45, 0, C.accent2);
    s.addShape(pres.ShapeType.line, { x: 7.95, y: 2.65, w: 0, h: 0.8, line: { color: C.accent3, width: 1.75, beginArrowType: 'triangle' }, objectName: 'arch-copy-arrow' });
    text(s, 'COPY at startup, 3.2 s', mono({ x: 8.05, y: 2.88, w: 1.5, h: 0.35, fontSize: 10, color: C.accent3 }));
    text(s, 'SQL backend: libpq, parameterized', { x: 3.3, y: 4.92, w: 6.2, h: 0.25, fontSize: 11, color: C.accent5, align: 'right' });
    s.addNotes(
`ONE SERVER, TWO ENGINES (2 min)
- The browser talks JSON to ssa_server. Every request carries backend=engine or backend=postgres.
- Crucial for a fair experiment: both backends receive the SAME parsed request object from the same C++ parser, and responses are formatted by the same code. The only thing that differs is the engine that answers.
- PostgreSQL is the system of record. At startup the server streams the table with COPY into the in-memory engine: 5 million rows in about 3 seconds.
- The SQL backend uses libpq with parameterized queries only, a connection pool, and a per-statement timeout.
- Bottom left: if no server is reachable, the same engine compiled to WebAssembly runs in a Web Worker in the browser. (Its build is not part of today's measurements.)`);
  }

  // ============ 4. ENGINE DESIGN ============
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'System' });
    title(s, 'Why the engine is fast');
    const items = [
      ['FaColumns', 'Columnar layout', 'One packed array per field; a filter reads only its columns.'],
      ['FaBook', 'Dictionary-coded names', 'Search text is matched against ~690 names once, then a lookup per row.'],
      ['FaFilter', 'Bitmask filters', 'States, types and statuses become one bit test per record.'],
      ['FaSortAmountDown', 'Window selection', 'Only the requested page is ordered, never all 5M rows.'],
    ];
    for (let i = 0; i < items.length; i++) {
      const [ic, head, body] = items[i];
      const x = 0.5 + (i % 2) * 3.15, y = 1.25 + Math.floor(i / 2) * 1.85;
      card(s, x, y, 3.0, 1.7, { name: 'design-card' });
      await badge(s, ic, x + 0.2, y + 0.2, 0.5);
      text(s, head, { x: x + 0.85, y: y + 0.25, w: 2.0, h: 0.45, fontSize: 15, bold: true, valign: 'middle' });
      text(s, body, { x: x + 0.2, y: y + 0.85, w: 2.65, h: 0.8, fontSize: 14, color: C.background2 });
    }
    card(s, 6.95, 1.25, 2.55, 3.55, { name: 'memory-stats', fill: C.text1, line: C.accent5 });
    const stat = (y, big, label, color) => {
      text(s, big, mono({ x: 7.15, y, w: 2.2, h: 0.5, fontSize: 28, bold: true, color }));
      text(s, label, { x: 7.15, y: y + 0.52, w: 2.2, h: 0.3, fontSize: 12, color: C.background2 });
    };
    stat(1.45, '91 MB', 'engine, 5M records', C.accent1);
    stat(2.55, '1.48 GB', 'PostgreSQL table + indexes', C.accent2);
    stat(3.65, '~19 B', 'per record in the engine', C.background1);
    s.addNotes(
`NO MAGIC, JUST LAYOUT (2 min)
- Columnar: instead of one object per person, one array per field. A query on state and benefit never touches names. Scans stream through cache.
- Dictionary-coded names: the synthetic data has 688 distinct first and last names. We match the search text against that dictionary once, then each row is a table lookup. CAVEAT for later (threats slide): real data has far more distinct names.
- Bitmasks: "Maryland, Virginia, DC" is one 64-bit number; testing a record is one bit test.
- Window selection: for "top 50" we only order 50 rows; deep pages switch to nth_element. This cut the 100,000-deep page from ~220 ms to ~85 ms during development.
- Memory: 91 MB in the engine versus 1.48 GB for PostgreSQL's table plus indexes. ~19 bytes per record.`);
  }

  // ============ 5. FAIR BASELINE ============
  pres.addSection({ title: 'Method' });
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Method' });
    title(s, 'A fair baseline');
    const col = async (x, head, color, iconName, rows) => {
      card(s, x, 1.25, 4.4, 3.6, { name: 'method-card' });
      await badge(s, iconName, x + 0.25, 1.45, 0.45, color);
      text(s, head, { x: x + 0.85, y: 1.45, w: 3.3, h: 0.45, fontSize: 16, bold: true, color, valign: 'middle' });
      s.addText(bullets(rows), { x: x + 0.3, y: 2.1, w: 3.85, h: 2.65, fontSize: 14, color: C.background1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 6 });
    };
    await col(0.5, 'What PostgreSQL got', C.accent2, 'FaDatabase', [
      'B-tree index on every filter and sort key',
      'Trigram GIN indexes for substring name search',
      'Byte-order collation matching the engine’s sort',
      '512 MB shared_buffers, 64 MB work_mem, 2 parallel workers',
      'Warm cache; ANALYZE after load',
    ]);
    await col(5.1, 'How we measured', C.accent3, 'FaStopwatch', [
      'Same server, same request parser',
      '11 cases; 2 warm-up + 15 measured runs',
      'Backends alternated every run',
      'Median time inside the backend (HTTP adds ~1 ms)',
      `${BENCH.machine.cpus}-vCPU VM, ${BENCH.records.toLocaleString('en-US')} rows`,
    ]);
    s.addNotes(
`WHY YOU SHOULD TRUST THE COMPARISON (2 min)
- A benchmark against a badly configured database proves nothing. PostgreSQL got an index for every filter and every sort key, trigram indexes for the substring name search, and the same byte-order collation the engine uses, so sorts are comparable.
- Settings are sensible for the box: 512 MB shared buffers, 64 MB work_mem, two parallel workers. Data fully cached.
- Protocol: same HTTP server, same parsed request, eleven representative cases, warm-up then fifteen measured runs, and we ALTERNATE the backends each run so drift hits both equally.
- We report median time inside the backend; end-to-end HTTP adds about one millisecond, recorded in results/benchmark.json.
- The machine is small, two vCPUs. That matters and it's on the threats slide.`);
  }

  // ============ 6. RESULTS: QUERIES ============
  pres.addSection({ title: 'Results' });
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Results' });
    title(s, 'Results: searches and pages');
    const cases = [
      ['Unfiltered, top 50 by id', 'Top 50 by id'],
      ['Unfiltered, top 50 by benefit', 'Top 50 by benefit'],
      ['Unfiltered, top 50 by last name', 'Top 50 by last name'],
      ['Name search "smith"', 'Name "smith"'],
      ['Name "mar smi"', '"mar smi" + 3 states'],
      ['Disability, Active', 'Disability, Active, $ range'],
      ['Deep page', 'Page at offset 100,000'],
    ].map(([k, label]) => [caseBy(k), label]);
    card(s, 0.5, 1.15, 6.35, 3.95, { name: 'chart-card' });
    s.addChart(pres.charts.BAR, [
      { name: 'C++ engine', labels: cases.map((c) => c[1]), values: cases.map((c) => ms(c[0], 'engine')) },
      { name: 'PostgreSQL', labels: cases.map((c) => c[1]), values: cases.map((c) => ms(c[0], 'postgres')) },
    ], Object.assign({}, chartBase, {
      x: 0.6, y: 1.25, w: 6.15, h: 3.75,
      showTitle: true, title: 'Median ms per query, 5M rows (log scale)', titleFontSize: 12, titleColor: HEX.lt1, titleFontFace: '+mn-lt',
    }));
    const speeds = cases.map((c) => c[0].speedup);
    const lo = Math.min(...speeds), hi = Math.max(...speeds);
    const call = (y, big, label, color) => {
      card(s, 7.1, y, 2.4, 1.15, { name: 'result-callout' });
      text(s, big, mono({ x: 7.3, y: y + 0.12, w: 2.1, h: 0.5, fontSize: 26, bold: true, color }));
      text(s, label, { x: 7.3, y: y + 0.62, w: 2.1, h: 0.45, fontSize: 12, color: C.background2 });
    };
    call(1.15, `${lo.toFixed(1)}–${Math.round(hi)}×`, 'engine speed-up on these queries', C.accent1);
    call(2.55, `${fmt(ms(caseBy('Name "mar smi"'), 'engine'))} ms`, 'fastest engine query (609 matches)', C.accent1);
    call(3.95, `${fmt(ms(caseBy('Deep page'), 'engine'))} ms`, 'slowest: both must walk 100,050 rows', C.accent3);
    s.addNotes(
`READ THE CHART (2 min)
- Log scale: each gridline would be 10x. Green is the engine, blue PostgreSQL, same colours everywhere in this deck.
- Every case: engine between roughly 2.6x and 14x faster. Searches with filters land under 20 ms in the engine and 100-180 ms in PostgreSQL.
- The smallest gap is the deep page: to show rows 100,001-100,050 sorted by name, both systems genuinely have to order 100,050 rows. That's the honest lower bound of the advantage.
- Exact record id lookups are excluded: both answer in under a millisecond, a ratio is meaningless there.
- These are medians of 15 runs; p95 values are in results/benchmark.json and tell the same story.`);
  }

  // ============ 7. RESULTS: AGGREGATES & LOAD ============
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Results' });
    title(s, 'Results: aggregates and load');
    const agg = [
      [caseBy('Aggregates, unfiltered'), 'All 5M rows'],
      [caseBy('Aggregates, Retirement in TX'), 'Retirement in TX'],
      [caseBy('Aggregates, "smith"'), '"smith", 3 states, Retirement'],
    ];
    card(s, 0.5, 1.15, 5.4, 3.95, { name: 'chart-card' });
    s.addChart(pres.charts.BAR, [
      { name: 'C++ engine', labels: agg.map((a) => a[1]), values: agg.map((a) => ms(a[0], 'engine')) },
      { name: 'PostgreSQL', labels: agg.map((a) => a[1]), values: agg.map((a) => ms(a[0], 'postgres')) },
    ], Object.assign({}, chartBase, {
      x: 0.6, y: 1.25, w: 5.2, h: 3.75,
      showTitle: true, title: 'Median ms per aggregate request (log scale)', titleFontSize: 12, titleColor: HEX.lt1, titleFontFace: '+mn-lt',
    }));
    const t = BENCH.throughput;
    card(s, 6.15, 1.15, 3.35, 3.95, { name: 'throughput-card' });
    text(s, `UNDER LOAD: ${t.engine.clients} CLIENTS`, mono({ x: 6.4, y: 1.35, w: 3.0, h: 0.3, fontSize: 11, bold: true, color: C.accent3 }));
    const row = (y, label, rps, p95, color) => {
      text(s, label, { x: 6.4, y, w: 2.9, h: 0.3, fontSize: 13, color: C.background2 });
      text(s, `${Math.round(rps)} req/s`, mono({ x: 6.4, y: y + 0.3, w: 2.9, h: 0.5, fontSize: 26, bold: true, color }));
      text(s, `p95 ${p95 >= 1000 ? (p95 / 1000).toFixed(1) + ' s' : Math.round(p95) + ' ms'}`, { x: 6.4, y: y + 0.82, w: 2.9, h: 0.3, fontSize: 13, color: C.background2 });
    };
    row(1.8, 'C++ engine', t.engine.rps, t.engine.p95_ms, C.accent1);
    row(3.0, 'PostgreSQL', t.postgres.rps, t.postgres.p95_ms, C.accent2);
    text(s, `${Math.round(t.engine.rps / t.postgres.rps)}× the throughput, 0 errors`, { x: 6.4, y: 4.45, w: 2.95, h: 0.35, fontSize: 14, bold: true, color: C.accent3 });
    s.addNotes(
`AGGREGATES ARE WHERE IT SEPARATES (2 min)
- The stats panel in the UI needs count, sum, min, max, and the breakdown by state, type, status and benefit band.
- All 5 million rows: about 20 ms in the engine, about 1.7 s in PostgreSQL: roughly 84x. PostgreSQL has to push every row through its executor; the engine does one tight pass.
- With filters the gap is 6-16x.

UNDER LOAD
- Four concurrent clients, ten seconds, a mix of the cases. The engine sustained about 90 requests per second; PostgreSQL about 5, with a p95 above 3 seconds. Zero errors on both.
- On two vCPUs PostgreSQL's parallel workers compete with each other; short engine scans interleave well. Expect different absolute numbers on bigger machines.`);
  }

  // ============ 8. WHERE POSTGRES SPENDS TIME ============
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Results' });
    title(s, 'Where PostgreSQL spends time');
    text(s, 'Unfiltered, top 50 by id: showing "1–50 of 5,000,000"', { x: 0.5, y: 1.15, w: 9, h: 0.35, fontSize: 15, bold: true });
    const top = caseBy('Unfiltered, top 50 by id');
    const pgTotal = ms(top, 'postgres'), engTotal = ms(top, 'engine');
    const countMs = 108, pageMs = 0.8, otherMs = Math.max(0, pgTotal - countMs - pageMs);
    const scale = 6.4 / pgTotal, x0 = 2.3;
    text(s, 'PostgreSQL', { x: 0.5, y: 1.78, w: 1.7, h: 0.45, fontSize: 14, bold: true, color: C.accent2, valign: 'middle' });
    s.addShape(pres.ShapeType.rect, { x: x0, y: 1.78, w: countMs * scale, h: 0.45, fill: { color: C.accent2 }, line: { color: C.accent2, width: 0 }, objectName: 'bar-count' });
    text(s, `exact count(*): ${countMs} ms`, { x: x0 + 0.15, y: 1.78, w: 4.5, h: 0.45, fontSize: 13, bold: true, color: C.text1, valign: 'middle' });
    s.addShape(pres.ShapeType.rect, { x: x0 + countMs * scale, y: 1.78, w: otherMs * scale, h: 0.45, fill: { color: C.accent2, transparency: 55 }, line: { color: C.accent2, width: 0 }, objectName: 'bar-other' });
    text(s, `page via primary key: ${pageMs} ms  ·  round trips + transfer: ~${Math.round(otherMs)} ms`, { x: x0, y: 2.28, w: 7.2, h: 0.3, fontSize: 12, color: C.background2 });
    text(s, 'C++ engine', { x: 0.5, y: 2.75, w: 1.7, h: 0.45, fontSize: 14, bold: true, color: C.accent1, valign: 'middle' });
    s.addShape(pres.ShapeType.rect, { x: x0, y: 2.75, w: engTotal * scale, h: 0.45, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0 }, objectName: 'bar-engine' });
    text(s, `${fmt(engTotal)} ms: scan, count and page in one pass`, { x: x0 + engTotal * scale + 0.15, y: 2.75, w: 5.5, h: 0.45, fontSize: 13, color: C.background1, valign: 'middle' });

    card(s, 0.5, 3.5, 9.0, 1.4, { name: 'aggregate-formulation' });
    await badge(s, 'FaFlask', 0.7, 3.7, 0.45, C.accent3);
    text(s, 'Giving PostgreSQL its best aggregate query', { x: 1.3, y: 3.68, w: 7.9, h: 0.45, fontSize: 15, bold: true, color: C.accent3, valign: 'middle' });
    text(s, 'GROUPING SETS (one scan, single-threaded): ~1.5 s unfiltered, 186 ms filtered. A parallel scan with 74 FILTER aggregates: 1.25–1.33 s unfiltered but 241 ms filtered. Kept GROUPING SETS.',
      { x: 0.7, y: 4.2, w: 8.6, h: 0.65, fontSize: 13, color: C.background1 });
    s.addNotes(
`THE MOST INTERESTING FINDING (2 min)
- Why is PostgreSQL at ~120 ms for "first 50 rows by id" when it has a primary key? EXPLAIN shows it: fetching the page through the index costs under a millisecond. The exact count of 5 million rows costs about 108 ms.
- So the expensive part is the "1-50 of 5,000,000" in the UI. That's a product decision: show an estimate, or use keyset pagination, and PostgreSQL's number changes completely. A fair next experiment, listed at the end.
- The engine gets the count for free: the scan that finds the page also counts.
- Bottom: we tried to give PostgreSQL its best formulation for aggregates. The parallel FILTER version helped unfiltered by ~15% and hurt filtered queries, so we kept GROUPING SETS. Pre-aggregation with materialized views would be much faster but changes the problem: staleness and every filter combination.
- (Numbers on this slide: count and page from psql \\timing; remainder derived from the benchmark total.)`);
  }

  // ============ 9. PROVING EQUIVALENCE ============
  pres.addSection({ title: 'Correctness' });
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Correctness' });
    title(s, 'Proving equivalence');
    const steps = [
      ['FaVial', 'Generate', '62 targeted + 300 random requests'],
      ['FaExchangeAlt', 'Ask both', 'same request to engine and PostgreSQL'],
      ['FaEquals', 'Compare', 'every record, total and aggregate (only elapsedMs ignored)'],
    ];
    for (let i = 0; i < steps.length; i++) {
      const [ic, head, body] = steps[i];
      const x = 0.5 + i * 2.25;
      card(s, x, 1.25, 2.0, 2.15, { name: 'equivalence-step' });
      await badge(s, ic, x + 0.2, 1.45, 0.5);
      text(s, head, { x: x + 0.2, y: 2.05, w: 1.65, h: 0.35, fontSize: 15, bold: true });
      text(s, body, { x: x + 0.2, y: 2.45, w: 1.65, h: 0.9, fontSize: 12, color: C.background2 });
      if (i < steps.length - 1) {
        s.addShape(pres.ShapeType.line, { x: x + 2.0, y: 2.32, w: 0.25, h: 0, line: { color: C.accent3, width: 1.75, endArrowType: 'triangle' }, objectName: 'flow-arrow' });
      }
    }
    card(s, 7.25, 1.25, 2.25, 2.15, { name: 'zero-mismatch', line: C.accent1, lineW: 1.5 });
    text(s, '0', mono({ x: 7.45, y: 1.3, w: 1.85, h: 1.0, fontSize: 60, bold: true, color: C.accent1, valign: 'middle' }));
    text(s, 'mismatches in ~790 compared responses, 5M rows', { x: 7.45, y: 2.35, w: 1.9, h: 0.95, fontSize: 12, color: C.background1 });

    const ev = [
      ['120,060', 'engine unit checks, incl. a brute-force matcher'],
      ['39', 'server checks: SQL translation, binding, escaping'],
      ['1,100', 'queries vs an independent NumPy oracle: 0 mismatches'],
    ];
    ev.forEach(([n, l], i) => {
      const x = 0.5 + i * 3.05;
      text(s, n, mono({ x, y: 3.7, w: 2.85, h: 0.5, fontSize: 24, bold: true, color: C.accent1 }));
      text(s, l, { x, y: 4.2, w: 2.85, h: 0.6, fontSize: 13, color: C.background2 });
    });
    s.addNotes(
`CORRECTNESS IS A MEASUREMENT TOO (2 min)
- A faster engine that is subtly wrong is worse than a slow one. So: tools/compare_backends.py.
- It generates requests (62 targeted cases plus 300 random ones built from real name fragments, random state/type/status sets, ranges, sorts, offsets, deliberately empty and impossible ranges, LIKE metacharacters like % and _), sends each to both backends through the real HTTP API, and compares the entire JSON: every record on the page, the total, every aggregate bucket. Only the timing field is ignored.
- Result on 5 million rows: zero mismatches across about 790 compared responses.
- Underneath: 120,060 engine unit checks, 39 server checks for the SQL translation (including that user text never reaches the SQL string), and in an earlier phase an independent NumPy re-implementation agreed on 1,100 random queries.
- Next slide: why you should believe a checker that never complains.`);
  }

  // ============ 10. THE CHECKER CAN FAIL ============
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Correctness' });
    title(s, 'The checker can fail');
    text(s, 'Two bugs planted in a scratch copy of the SQL backend:', { x: 0.5, y: 1.15, w: 9, h: 0.35, fontSize: 15, color: C.background2 });
    const mutant = async (x, head, code, r1, r1ok, r2, r2ok) => {
      card(s, x, 1.6, 4.4, 2.35, { name: 'mutant-card' });
      await badge(s, 'FaBug', x + 0.2, 1.8, 0.45, C.accent4, HEX.lt1);
      text(s, head, { x: x + 0.8, y: 1.8, w: 3.4, h: 0.45, fontSize: 15, bold: true, valign: 'middle' });
      text(s, code, mono({ x: x + 0.25, y: 2.4, w: 3.95, h: 0.35, fontSize: 12, color: C.accent3 }));
      const line = (y, label, ok) => {
        text(s, ok ? '✓' : '✗', { x: x + 0.25, y, w: 0.3, h: 0.35, fontSize: 16, bold: true, color: ok ? C.accent1 : C.accent4, valign: 'middle' });
        text(s, label, { x: x + 0.6, y, w: 3.65, h: 0.35, fontSize: 14, valign: 'middle' });
      };
      line(2.9, r1, r1ok);
      if (r2) line(3.35, r2, r2ok);
    };
    await mutant(0.5, 'A: benefit boundary off by one', 'monthly_cents >= $n  →  > $n', 'random requests: caught (6 of 60)', true, null, false);
    await mutant(5.1, 'B: wrong tie-break when descending', 'ORDER BY cents DESC, id DESC  →  id', 'random requests: missed (0 of 60)', false, 'targeted cases: caught on the first', true);
    card(s, 0.5, 4.15, 9.0, 0.85, { name: 'lesson', fill: C.text1, line: C.accent3, lineW: 1.25 });
    await badge(s, 'FaFlask', 0.7, 4.32, 0.45, C.accent3);
    text(s, 'Lesson: random testing needs coverage-directed cases for ordering semantics; every sort key × direction now runs over tie-heavy results.',
      { x: 1.3, y: 4.25, w: 8.0, h: 0.65, fontSize: 14, valign: 'middle' });
    s.addNotes(
`MUTATION TESTING THE CHECKER (2 min) - good story, tell it plainly
- A check that has never failed proves nothing. So we broke the SQL backend on purpose, twice.
- Mutant A: greater-than instead of greater-or-equal on the minimum benefit. Random requests caught it: 6 of 60 requests differed.
- Mutant B: when sorting by benefit descending, break ties by id ascending instead of descending. Random requests MISSED it: 0 of 60. Only about 4 of those requests used that sort, and their filtered results rarely had equal benefits straddling a page boundary.
- Fix: we added 62 targeted cases: every sort key in both directions, over large results full of ties, at shallow and deep offsets. Mutant B is now caught on the first targeted case.
- Lesson for any research codebase: random testing is great at breadth and weak at ordering semantics. Combine it with coverage-directed cases, and test the tester.`);
  }

  // ============ 11. ENGINEERING FOR REPRODUCIBILITY ============
  pres.addSection({ title: 'Engineering' });
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Engineering' });
    title(s, 'Built to be reproduced');
    const tiles = [
      ['FaDocker', 'docker compose up', 'PostgreSQL, idempotent seed, app; non-root, health-checked, clean SIGTERM'],
      ['FaCogs', 'CMake presets', 'debug, release, asan, engine-only; CLion and VS Code read them natively'],
      ['FaShieldAlt', 'Sanitizers', 'ASan + UBSan over the tests and the live server: no reports, no leaks'],
      ['FaTimes', 'Hostile input', 'Bad JSON, deep nesting, oversized bodies, traversal: 400 / 413 / 404'],
      ['FaDatabase', 'Safe SQL', 'Parameterized only; pooled connections; 15 s statement timeout'],
      ['FaRobot', 'CI workflow', 'Build, ASan, web, Docker, and a live engine-vs-PostgreSQL cross-check'],
    ];
    for (let i = 0; i < tiles.length; i++) {
      const [ic, head, body] = tiles[i];
      const x = 0.5 + (i % 3) * 3.05, y = 1.2 + Math.floor(i / 3) * 1.8;
      card(s, x, y, 2.85, 1.65, { name: 'engineering-tile' });
      await badge(s, ic, x + 0.2, y + 0.2, 0.45);
      text(s, head, { x: x + 0.8, y: y + 0.2, w: 1.95, h: 0.45, fontSize: 14, bold: true, valign: 'middle' });
      text(s, body, { x: x + 0.2, y: y + 0.78, w: 2.5, h: 0.85, fontSize: 12, color: C.background2 });
    }
    text(s, 'The CI workflow and CLion run configurations are provided but were not executed in the build environment.',
      { x: 0.5, y: 4.85, w: 9, h: 0.3, fontSize: 10, italic: true, color: C.accent5 });
    s.addNotes(
`ENGINEERING (1.5 min) - research code that others can rerun
- One command: docker compose up --build. PostgreSQL, a one-shot seed job that is idempotent (rerun it and it does nothing), and the app. Non-root container, health check, clean shutdown on SIGTERM. Tested: image builds with the unit tests running inside the build; the app container passed the cross-check against PostgreSQL.
- CMake presets drive both CLion and VS Code: debug, release, AddressSanitizer, and engine-only for machines without the PostgreSQL client library. VS Code gets tasks and debug configurations; CLion gets shared run configurations.
- Under AddressSanitizer and UBSan, the tests and the live server, including hostile requests, produced no reports and no leaks.
- SQL is parameterized only, with a connection pool and a statement timeout.
- Honest footnote: the GitHub Actions workflow, the CLion run configurations and the official postgres container image weren't runnable in my build environment; everything else on this slide was executed.`);
  }

  // ============ 12. LIVE DEMO ============
  pres.addSection({ title: 'Demo' });
  {
    const s = pres.addSlide({ masterName: 'DARK_PLAIN', sectionTitle: 'Demo' });
    text(s, '> LIVE DEMO', mono({ x: 0.5, y: 0.45, w: 4, h: 0.35, fontSize: 13, bold: true, color: C.accent1, charSpacing: 2 }));
    text(s, 'Same request, two engines', mono({ x: 0.5, y: 0.85, w: 3.8, h: 1.0, fontSize: 26, bold: true }));
    const steps = [
      'Search "smith": cross-check confirms an identical page',
      'Add MD, VA, DC and Retirement; sort by benefit',
      'Switch to PostgreSQL: same records, slower',
      'Clear filters: aggregates over 5M rows',
      'Run the equivalence checker live',
    ];
    steps.forEach((t, i) => {
      const y = 2.05 + i * 0.6;
      s.addShape(pres.ShapeType.ellipse, { x: 0.5, y, w: 0.4, h: 0.4, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0 }, objectName: 'demo-step-bg' });
      text(s, String(i + 1), mono({ x: 0.5, y, w: 0.4, h: 0.4, fontSize: 14, bold: true, color: C.text1, align: 'center', valign: 'middle' }));
      text(s, t, { x: 1.05, y: y - 0.02, w: 3.25, h: 0.45, fontSize: 13, valign: 'middle' });
    });
    const img = await sharp(SHOT).extract({ left: 735, top: 370, width: 2145, height: 1330 }).png().toBuffer();
    s.addShape(pres.ShapeType.rect, { x: 4.55, y: 0.85, w: 5.0, h: 3.1, fill: { color: C.text2 }, line: { color: C.accent1, width: 1 }, objectName: 'screenshot-frame' });
    s.addImage({ data: 'image/png;base64,' + img.toString('base64'), x: 4.6, y: 0.9, w: 4.9, h: 3.0, sizing: { type: 'contain', w: 4.9, h: 3.0 }, altText: 'SSA Recipient Explorer showing a live cross-check: PostgreSQL returned the identical page' });
    text(s, 'The cross-check line: every page is answered by both backends and compared record by record.',
      { x: 4.55, y: 4.05, w: 5.0, h: 0.6, fontSize: 12, italic: true, color: C.background2 });
    s.addNotes(
`LIVE DEMO (about 6 minutes) - full run of show in docs/DEMO.md
PREP: docker compose up -d done before the talk; browser on http://localhost:8080, Cross-check ON, backend C++ engine, filters cleared.

1. Point at the top bar: 5,000,000 records, 91 MB, loaded from PostgreSQL in about 3 s.
2. Type smith. The cross-check line appears: PostgreSQL returned the identical page, with both timings.
3. Add MD, VA, DC and Retirement; click Monthly benefit twice (descending). 5,185 matches; top record SYN-03178999 at $4,053.81 (same as the screenshot).
4. Click PostgreSQL. Badge now says PostgreSQL; records unchanged.
5. Reset filters while on PostgreSQL: the stats cards visibly lag (~1.5 s). Switch to C++ engine: ~20 ms. This is the 84x case.
6. Terminal: python3 tools/compare_backends.py --queries 40  -> 0 mismatches in ~30 s.

FALLBACKS: if Docker fails, ssa_server --source=generate (engine only), or show docs/screenshots. If the cross-check ever shows a mismatch: don't hide it; it's a bug report.`);
  }

  // ============ 13. THREATS TO VALIDITY ============
  pres.addSection({ title: 'Conclusions' });
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Conclusions' });
    title(s, 'Threats to validity');
    const hdr = (t) => ({ text: t, options: { bold: true, color: C.text1, fill: { color: C.accent3 }, fontSize: 13, valign: 'middle' } });
    const cell = (t, bold = false) => ({ text: t, options: { color: C.background1, bold, fontSize: 13, valign: 'middle', fill: { color: C.text2 } } });
    const rows = [
      [hdr('Threat'), hdr('Likely effect'), hdr('What would settle it')],
      [cell('2-vCPU machine', true), cell('Limits PostgreSQL’s parallelism more than the engine'), cell('Re-run bench_backends.py on target hardware')],
      [cell('Synthetic names (688 distinct)', true), cell('Flatters dictionary-based name search'), cell('Realistic name distribution; widen 16-bit codes')],
      [cell('Unequal guarantees', true), cell('Snapshot vs live, durable, transactional'), cell('Measure incremental refresh cost')],
      [cell('Tuning never exhaustive', true), cell('Estimated counts or views could narrow gaps'), cell('Keyset paging, estimated counts, materialized views')],
      [cell('Database on the same host', true), cell('No network latency: favours PostgreSQL'), cell('Remote database deployment')],
    ];
    s.addTable(rows, { x: 0.5, y: 1.2, w: 9.0, colW: [2.6, 3.1, 3.3], rowH: [0.4, 0.62, 0.62, 0.62, 0.62, 0.62], border: { type: 'solid', pt: 0.75, color: HEX.accent6 }, margin: [0.04, 0.1, 0.04, 0.1], autoPage: false });
    s.addNotes(
`READ THIS SLIDE OUT LOUD (1.5 min) - it's what makes the result credible
- Small machine: two vCPUs starve PostgreSQL's parallel query more than a single-pass scan. Absolute numbers will move on real hardware; I expect the ordering to hold, but it's a prediction.
- Synthetic names: only 688 distinct names, so the engine's dictionary trick is nearly free. Real data has many more; name search will slow down, and the engine's 16-bit name codes (max 65,535) must widen.
- Unequal guarantees: PostgreSQL is live, durable and transactional; the engine is a read-only snapshot. This compares the interactive READ path, not two databases.
- Tuning is never exhaustive: estimated counts, keyset pagination, or materialized views would shrink some gaps, at the cost of changing what the user sees.
- Same host: no network latency between server and database. A remote database would widen the gap, not shrink it.`);
  }

  // ============ 14. CONCLUSIONS ============
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Conclusions' });
    title(s, 'Conclusions and next steps');
    const verdicts = [
      ['H1', 'Supported', `2.6–14× on searches and pages, ~${Math.round(caseBy('Aggregates, unfiltered').speedup)}× on full aggregates, ~${Math.round(BENCH.throughput.engine.rps / BENCH.throughput.postgres.rps)}× throughput`],
      ['H2', 'Supported', '0 mismatches on 5M rows, with a checker shown to catch planted bugs'],
      ['H3', 'Confirmed', 'Cost is a 3 s snapshot load and 91 MB of RAM; freshness needs work'],
    ];
    for (let i = 0; i < verdicts.length; i++) {
      const [h, v, body] = verdicts[i];
      const y = 1.2 + i * 1.22;
      card(s, 0.5, y, 5.2, 1.08, { name: 'verdict-card' });
      await badge(s, 'FaCheck', 0.7, y + 0.28, 0.5);
      text(s, `${h}  ${v}`, mono({ x: 1.4, y: y + 0.12, w: 4.1, h: 0.35, fontSize: 15, bold: true, color: C.accent1 }));
      text(s, body, { x: 1.4, y: y + 0.48, w: 4.15, h: 0.55, fontSize: 13, color: C.background1 });
    }
    card(s, 6.0, 1.2, 3.5, 3.52, { name: 'next-steps', fill: C.text1, line: C.accent3, lineW: 1.25 });
    text(s, 'Next experiments', { x: 6.25, y: 1.35, w: 3.1, h: 0.4, fontSize: 16, bold: true, color: C.accent3 });
    s.addText(bullets([
      'Estimated counts and keyset paging in PostgreSQL',
      'Incremental refresh via LISTEN/NOTIFY',
      'Realistic name diversity',
      'Target hardware, remote database',
      'WebAssembly build measured in browsers',
    ]), { x: 6.25, y: 1.85, w: 3.1, h: 2.8, fontSize: 13, color: C.background1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 6 });
    s.addNotes(
`CLOSE (1.5 min)
- H1 supported: the engine is 2.6 to 14 times faster on searches and pages, about 84 times on full aggregates, and sustains about 18 times the throughput on this machine.
- H2 supported: zero mismatches on 5 million rows, and the checker is proven able to fail.
- H3 confirmed with a caveat: the cost is a 3-second snapshot load and 91 MB of memory, but freshness is unsolved; today a data change needs a restart.

NEXT
- The fairest next experiment is on PostgreSQL's side: estimated counts and keyset pagination.
- Then incremental refresh with LISTEN/NOTIFY, realistic name diversity, real hardware with a remote database, and measuring the WebAssembly build in browsers.

Then open for questions; the appendix has the commands to reproduce everything.`);
  }

  // ============ 15. APPENDIX ============
  {
    const s = pres.addSlide({ masterName: 'DARK_CONTENT', sectionTitle: 'Conclusions' });
    title(s, 'Appendix: reproduce it');
    card(s, 0.5, 1.2, 5.3, 3.75, { fill: C.text1, line: C.accent5, name: 'code-panel' });
    const code = [
      ['# full stack: PostgreSQL + seed + app', true],
      ['docker compose up --build', false],
      [' ', false],
      ['# equivalence and benchmark', true],
      ['python3 tools/compare_backends.py', false],
      ['python3 tools/bench_backends.py', false],
      [' ', false],
      ['# native build, tests, sanitizers', true],
      ['cmake --preset release', false],
      ['cmake --build --preset release', false],
      ['ctest --preset asan', false],
    ];
    s.addText(code.map(([t, c], i) => ({ text: t, options: { color: c ? C.accent5 : C.accent1, breakLine: i < code.length - 1 } })),
      mono({ x: 0.75, y: 1.4, w: 4.9, h: 3.4, fontSize: 12, isTextBox: true, margin: 0, valign: 'top' }));
    const repo = [
      ['engine/', 'C++23 engine, tests, benchmark, CSV export'],
      ['server/', 'ssa_server, SQL backend, loader, tests'],
      ['db/', 'schema, indexes, idempotent seed'],
      ['web/', 'React + Bootstrap UI, cross-check'],
      ['tools/', 'equivalence, benchmark, screenshots'],
      ['docs/', 'RESEARCH.md, DEMO.md, results, decks'],
    ];
    repo.forEach(([f, d], i) => {
      const y = 1.25 + i * 0.6;
      text(s, f, mono({ x: 6.1, y, w: 3.4, h: 0.28, fontSize: 13, bold: true, color: C.accent1 }));
      text(s, d, { x: 6.1, y: y + 0.27, w: 3.4, h: 0.3, fontSize: 12, color: C.background2 });
    });
    s.addNotes(
`FOR REVIEWERS
- Everything on these slides comes from the repository. The charts in this deck are generated from docs/results/benchmark.json, so rerunning the benchmark and then "npm run build:research" in docs/ regenerates the deck with new numbers.
- IDEs: open the folder in CLion or VS Code; both pick up CMakePresets.json. VS Code has tasks and debug configurations; CLion has shared run configurations in .run/.
- Benchmark machine: ${BENCH.machine.cpus} vCPUs, PostgreSQL ${BENCH.postgres.server_version}.`);
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  // Drop directory entries from the zip: some cloud viewers refuse packages that contain them.
  try {
    require('child_process').execFileSync('zip', ['-dq', OUT, '*/'], { stdio: 'ignore' });
  } catch {
    /* zip not installed or nothing to remove: the deck is still valid */
  }
  console.log('wrote', OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
