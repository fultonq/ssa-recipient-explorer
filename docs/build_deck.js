// Builds docs/SSA-Recipient-Explorer-Executive-Briefing.pptx
// Run: cd docs && npm install && npm run build   (writes the .pptx next to this file)
const path = require('path');
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const fa = require('react-icons/fa');
const { applyTheme } = require('./apply_theme.js');

const OUT = path.join(__dirname, 'SSA-Recipient-Explorer-Executive-Briefing.pptx');

// ------------------------------------------------------------------ theme
const THEME = {
  name: 'SSA Briefing',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '1B2428', lt1: 'FFFFFF', dk2: '0F2A2E', lt2: 'EEF3F2',
    accent1: '1B6B6F', accent2: 'E0A526', accent3: '5B8C85', accent4: 'B5483A',
    accent5: '566573', accent6: '2F9E8F', hlink: '1B6B6F', folHlink: '5B8C85',
  },
};
const HEX = THEME.colors; // only where scheme colors are not accepted (charts, shadows)

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'SSA Recipient Explorer - Executive Briefing';
pres.subject = 'Architecture, options, and path forward';
const C = pres.SchemeColor;

const W = 10, H = 5.625;
const shadow = () => ({ type: 'outer', color: '000000', opacity: 0.12, blur: 6, offset: 2, angle: 90 });

// ------------------------------------------------------------------ layouts
const FOOT = 'SSA Recipient Explorer  ·  Proof of concept  ·  All data synthetic';
const fullBleed = (fill) => ({ rect: { x: 0, y: 0, w: W, h: H, fill: { color: fill } } });

pres.defineSlideMaster({
  title: 'TITLE_DARK',
  objects: [fullBleed(C.text2)],
});
pres.defineSlideMaster({
  title: 'CONTENT',
  objects: [
    fullBleed(C.background2),
    { text: { text: FOOT, options: { x: 0.5, y: 5.2, w: 7, h: 0.3, fontSize: 10, color: C.accent5, margin: 0, isTextBox: true } } },
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 32, bold: true, color: C.text2, valign: 'middle', margin: 0 }, text: '' } },
  ],
  slideNumber: { x: 9.0, y: 5.2, w: 0.5, h: 0.3, fontSize: 10, color: C.accent5, align: 'right', margin: 0 },
});
pres.defineSlideMaster({
  title: 'CLOSING_DARK',
  objects: [
    fullBleed(C.text2),
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 32, bold: true, color: C.background1, valign: 'middle', margin: 0 }, text: '' } },
  ],
});

// ------------------------------------------------------------------ helpers
async function icon(name, hex = 'FFFFFF') {
  const svg = renderToStaticMarkup(React.createElement(fa[name], { color: '#' + hex, size: 256 }));
  const png = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  return 'image/png;base64,' + png.toString('base64');
}

// icon centred in a coloured circle; (x,y) = top-left of the circle
async function badge(s, name, x, y, d = 0.55, fill = C.accent1, iconHex = 'FFFFFF') {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: 'icon-bg-' + name });
  const pad = d * 0.27;
  s.addImage({ data: await icon(name, iconHex), x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad, altText: name.replace('Fa', '') + ' icon' });
}

function card(s, x, y, w, h, opts = {}) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: opts.fill || C.background1 },
    line: { color: opts.line || (opts.fill || C.background1), width: opts.lineW || 0 },
    shadow: opts.noShadow ? undefined : shadow(),
    objectName: opts.name || 'card',
  });
}

function text(s, str, o) {
  s.addText(str, Object.assign({ isTextBox: true, margin: 0, valign: 'top', color: C.text1, fontSize: 14 }, o));
}

function title(s, str) { s.addText(str, { placeholder: 'title' }); }

// ------------------------------------------------------------------ build
(async () => {
  // ============ 1. TITLE ============
  pres.addSection({ title: 'Overview' });
  {
    const s = pres.addSlide({ masterName: 'TITLE_DARK', sectionTitle: 'Overview' });
    text(s, 'EXECUTIVE BRIEFING', { x: 0.6, y: 1.05, w: 5.4, h: 0.3, fontSize: 12, bold: true, color: C.accent2, charSpacing: 3 });
    s.addText('SSA Recipient Explorer', { x: 0.6, y: 1.45, w: 5.4, h: 1.5, fontSize: 40, bold: true, color: C.background1, fontFace: THEME.headFontFace, isTextBox: true, margin: 0, valign: 'top' });
    text(s, 'Searching millions of benefit records in milliseconds', { x: 0.6, y: 3.05, w: 5.3, h: 0.75, fontSize: 20, color: C.background2 });
    text(s, 'Architecture, technology options, and the path forward', { x: 0.6, y: 3.85, w: 5.3, h: 0.35, fontSize: 14, color: C.accent3 });
    text(s, 'Proof of concept  ·  All data synthetic', { x: 0.6, y: 4.95, w: 5.3, h: 0.3, fontSize: 11, color: C.accent3 });

    // motif: a field of records with a few "matches" highlighted
    const hits = new Set(['0,3', '1,7', '2,1', '2,5', '3,8', '4,2', '4,6', '5,0', '5,9', '6,4', '6,7', '7,2', '7,5', '1,2']);
    const cell = 0.24, gap = 0.1, x0 = 6.45, y0 = 1.35;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 10; c++) {
        const hit = hits.has(`${r},${c}`);
        s.addShape(pres.ShapeType.roundRect, {
          x: x0 + c * (cell + gap), y: y0 + r * (cell + gap), w: cell, h: cell, rectRadius: 0.04,
          fill: { color: hit ? C.accent2 : C.accent1, transparency: hit ? 0 : 55 }, line: { color: hit ? C.accent2 : C.accent1, width: 0 },
          objectName: hit ? 'record-match' : 'record',
        });
      }
    }
    text(s, 'Squares are records; amber ones match a query.', { x: 6.45, y: 4.4, w: 3.4, h: 0.5, fontSize: 10, color: C.accent3, italic: true });
    s.addNotes(
`PURPOSE (30 sec)
- This is a briefing on a proof of concept: a browser-based tool that searches, filters and summarizes millions of benefit-recipient records interactively.
- Everything shown today uses synthetic data. No real SSA records or real SSNs were used or generated.

WHAT I NEED FROM YOU
- A steer on the production path (slide 9) and four decisions on the last slide.

HOW THE TALK IS ORGANIZED
- Overview and results, then architecture, then the technology options we compared with evidence, then risk/governance, then the roadmap and asks.
- Plan about 25 minutes plus questions. The appendix is optional.`);
  }

  // ============ 2. EXEC SUMMARY ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Overview' });
    title(s, 'Executive summary');
    const stats = [
      ['5M', 'benefit records searchable in memory'],
      ['≈15 ms', 'typical filtered query (native build, 5M records)'],
      ['90 MB', 'memory for all 5 million records'],
    ];
    stats.forEach(([big, label], i) => {
      const x = 0.5 + i * 3.05;
      card(s, x, 1.3, 2.9, 1.65, { name: 'stat-card' });
      text(s, big, { x: x + 0.25, y: 1.45, w: 2.4, h: 0.75, fontSize: 40, bold: true, color: C.accent1, fontFace: THEME.headFontFace, valign: 'middle' });
      text(s, label, { x: x + 0.25, y: 2.25, w: 2.45, h: 0.6, fontSize: 14, color: C.accent5 });
    });
    card(s, 0.5, 3.2, 9.0, 1.7, { fill: C.text2, name: 'recommendation-panel' });
    text(s, 'RECOMMENDATION', { x: 0.8, y: 3.38, w: 4, h: 0.3, fontSize: 12, bold: true, color: C.accent2, charSpacing: 2 });
    text(s, 'Adopt the C++ core. Run it server-side for protected data; use the WebAssembly build for de-identified and offline analyst tools. Validate in browsers and pilot before any production commitment.',
      { x: 0.8, y: 3.75, w: 8.4, h: 1.0, fontSize: 18, color: C.background1 });
    s.addNotes(
`KEY MESSAGE (say this first)
- We proved that a small, dependency-light C++ engine can search and aggregate millions of records in tens of milliseconds, and that the result can be independently verified.

THE THREE NUMBERS
- 5 million synthetic records held entirely in memory.
- About 15 ms for a typical filtered query on a native build. Measured range across our test queries was roughly 5 to 20 ms; a page 100,000 rows deep took about 80 ms.
- 90 MB of memory for all 5 million records, because the layout is columnar and names are dictionary-encoded.

THE RECOMMENDATION
- Keep the C++ core. For protected data run it server-side; use the browser (WebAssembly) build only for de-identified or offline analyst use.
- Be explicit that this is a proof of concept: the WebAssembly build has not yet been run in real browsers, and the data is synthetic.

IF ASKED "IS IT READY?"
- No. It is evidence for a decision, not a production system. The roadmap slide shows what stands between here and a pilot.`);
  }

  // ============ 3. WHAT WE SET OUT TO PROVE ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Overview' });
    title(s, 'What we set out to prove');
    const tiles = [
      ['FaBolt', 'Interactive speed', 'Search, filter and sort millions of records without the user waiting.'],
      ['FaGlobe', 'Runs in the browser', 'Nothing to install; engine logic ships to the browser as WebAssembly.'],
      ['FaCheckCircle', 'Provably correct', 'Results checked by an independent implementation, not only by our own tests.'],
      ['FaWrench', 'Maintainable', 'Small, dependency-light code that a modest team can own and extend.'],
    ];
    for (let i = 0; i < tiles.length; i++) {
      const [ic, head, body] = tiles[i];
      const x = 0.5 + (i % 2) * 4.6, y = 1.3 + Math.floor(i / 2) * 1.7;
      card(s, x, y, 4.4, 1.55, { name: 'requirement-tile' });
      await badge(s, ic, x + 0.25, y + 0.25, 0.6);
      text(s, head, { x: x + 1.05, y: y + 0.22, w: 3.15, h: 0.35, fontSize: 18, bold: true, color: C.text2 });
      text(s, body, { x: x + 1.05, y: y + 0.62, w: 3.15, h: 0.8, fontSize: 14, color: C.text1 });
    }
    text(s, 'Scope: proof of concept on 5 million synthetic records. No real SSA data was used.', { x: 0.5, y: 4.78, w: 9, h: 0.3, fontSize: 12, italic: true, color: C.accent5 });
    s.addNotes(
`FRAME THE PROBLEM AS A DESIGN QUESTION
- We did not try to solve a specific SSA business process. We tested whether a modern, browser-delivered tool could give analysts instant search over a very large record set.

FOUR TESTS WE SET FOR OURSELVES
1. Speed: interactive means the user never waits on a spinner for a normal search.
2. Delivery: a browser-based UI, with the heavy lifting compiled to WebAssembly so one code base serves both browser and server.
3. Correctness: for anything touching benefit data, "our tests pass" is not enough. We wanted an independent check.
4. Maintainability: something a small team can understand end to end.

SET EXPECTATIONS
- Synthetic data only, generated deterministically so any result can be reproduced exactly.`);
  }

  // ============ 4. WHAT WAS BUILT ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Overview' });
    title(s, 'What was built');
    const rows = [
      ['FaSearch', 'Search and filter', 'Name, state, type, status, ranges, record ID, last four.'],
      ['FaSortAmountDown', 'Sort and page', 'Seven sort keys; 100,000 rows deep in about 80 ms.'],
      ['FaChartBar', 'Live aggregates', 'Counts, outlay, averages, and mix by state, type, status.'],
      ['FaFileExport', 'Detail and export', 'Record detail with masked SSN; CSV export of the page.'],
      ['FaPalette', 'Two themes', 'Retro phosphor-green terminal look, or standard Bootstrap.'],
    ];
    for (let i = 0; i < rows.length; i++) {
      const [ic, head, body] = rows[i];
      const y = 1.3 + i * 0.7;
      await badge(s, ic, 0.5, y + 0.03, 0.5);
      text(s, head, { x: 1.2, y, w: 4.8, h: 0.3, fontSize: 15, bold: true, color: C.text2 });
      text(s, body, { x: 1.2, y: y + 0.28, w: 4.8, h: 0.42, fontSize: 12, color: C.accent5 });
    }
    card(s, 6.5, 1.3, 3.0, 3.5, { fill: C.text2, name: 'by-the-numbers' });
    text(s, 'BY THE NUMBERS', { x: 6.75, y: 1.5, w: 2.6, h: 0.3, fontSize: 11, bold: true, color: C.accent2, charSpacing: 2 });
    [['1,080', 'lines of C++ in the engine'], ['1,240', 'lines in the React UI'], ['120,046', 'automated checks passing']].forEach(([n, l], i) => {
      text(s, n, { x: 6.75, y: 1.9 + i * 0.95, w: 2.6, h: 0.5, fontSize: 30, bold: true, color: C.background1, fontFace: THEME.headFontFace });
      text(s, l, { x: 6.75, y: 2.4 + i * 0.95, w: 2.6, h: 0.35, fontSize: 13, color: C.background2 });
    });
    s.addNotes(
`WALK THE CAPABILITIES QUICKLY (this is a results slide, not a demo)
- Search and filter: a user can type partial names (each word may match a first or last name), pick states and benefit types, set ranges, or jump straight to a record ID.
- Sort and page: seven sort keys. Deep paging is the hardest case for any system; ours returns a page 100,000 rows deep in about 80 ms.
- Aggregates update live with the filter: counts, monthly outlay, average, and the mix by state, type and status.
- Detail view shows the SSN masked to the last four, and the current page can be exported to CSV.
- The two themes are a presentation choice; a federal deployment would use the standard theme and go through accessibility review.

SIZE OF THE CODE BASE
- Roughly 1,080 lines of C++ for the engine and 1,240 lines for the UI. That is small enough to read in a day, which matters for maintainability (slide 12).

IF ASKED FOR A LIVE DEMO
- The UI is built and type-checks, but the WebAssembly build has not yet been run in a browser from our build environment. Offer to demo after the validation milestone.`);
  }

  // ============ 5. ARCHITECTURE ============
  pres.addSection({ title: 'Architecture' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Architecture' });
    title(s, 'Technology architecture');
    card(s, 0.4, 1.2, 9.2, 2.0, { name: 'browser-group' });
    text(s, 'IN THE USER’S BROWSER TAB', { x: 0.6, y: 1.3, w: 5, h: 0.25, fontSize: 11, bold: true, color: C.accent5, charSpacing: 1 });
    const boxes = [
      ['React + Bootstrap UI', 'filters, table, charts', false],
      ['Web Worker', 'keeps the page responsive', false],
      ['C++ engine → WebAssembly', 'JSON API: init, query, stats, get', true],
      ['Columnar store', '5M records ≈ 90 MB', false],
    ];
    boxes.forEach(([head, sub, hi], i) => {
      const x = 0.5 + i * 2.35, y = 1.65;
      s.addShape(pres.ShapeType.roundRect, {
        x, y, w: 1.95, h: 1.35, rectRadius: 0.08, fill: { color: hi ? C.accent1 : C.background2 },
        line: { color: hi ? C.accent1 : C.accent3, width: 1 }, objectName: 'arch-box',
      });
      text(s, head, { x: x + 0.1, y: y + 0.2, w: 1.75, h: 0.6, fontSize: 14, bold: true, color: hi ? C.background1 : C.text2, align: 'center', valign: 'middle' });
      text(s, sub, { x: x + 0.1, y: y + 0.82, w: 1.75, h: 0.45, fontSize: 11, color: hi ? C.background2 : C.accent5, align: 'center' });
      if (i < boxes.length - 1) {
        s.addShape(pres.ShapeType.line, { x: x + 1.95, y: y + 0.675, w: 0.4, h: 0, line: { color: C.text2, width: 1.75, endArrowType: 'triangle' }, objectName: 'arch-arrow' });
      }
    });
    // link from engine down to the native group
    s.addShape(pres.ShapeType.line, { x: 6.175, y: 3.0, w: 0, h: 0.5, line: { color: C.accent1, width: 1.75, beginArrowType: 'triangle' }, objectName: 'arch-link' });
    text(s, 'same source code', { x: 6.3, y: 3.1, w: 1.6, h: 0.25, fontSize: 11, italic: true, color: C.accent1 });

    card(s, 0.4, 3.5, 9.2, 1.5, { name: 'native-group' });
    text(s, 'THE SAME C++ CORE, BUILT NATIVELY', { x: 0.6, y: 3.6, w: 5, h: 0.25, fontSize: 11, bold: true, color: C.accent5, charSpacing: 1 });
    const native = [
      ['Unit tests', '120,046 checks', false],
      ['Benchmarks', '5M-record scans', false],
      ['NumPy oracle', 'independent verification', false],
      ['Server service', 'production path', true],
    ];
    native.forEach(([head, sub, hi], i) => {
      const x = 0.5 + i * 2.35, y = 3.95;
      s.addShape(pres.ShapeType.roundRect, {
        x, y, w: 1.95, h: 0.9, rectRadius: 0.08, fill: { color: hi ? C.accent2 : C.background2 },
        line: { color: hi ? C.accent2 : C.accent3, width: 1 }, objectName: 'native-box',
      });
      text(s, head, { x: x + 0.1, y: y + 0.12, w: 1.75, h: 0.3, fontSize: 14, bold: true, color: C.text2, align: 'center' });
      text(s, sub, { x: x + 0.1, y: y + 0.45, w: 1.75, h: 0.35, fontSize: 11, color: C.text1, align: 'center' });
    });
    s.addNotes(
`THE ONE-SENTENCE ARCHITECTURE
- A React and Bootstrap front end talks through a Web Worker to a C++ engine compiled to WebAssembly; the engine keeps all records in a compact columnar store in memory.

WHY A WEB WORKER
- A scan of five million records is fast, but we never want to risk freezing the page. The worker keeps the interface responsive and drops stale results when the user keeps typing.

THE BOUNDARY
- UI and engine communicate only through a small JSON API: initialize, query, stats, get. That is the seam that makes the pieces replaceable.

THE KEY POINT OF THE BOTTOM ROW
- The same C++ source also builds natively. That gives us (1) unit tests, (2) benchmarks, (3) an independent NumPy oracle that cross-checks results, and (4) a direct path to run the engine as a server-side service, which is what we recommend for protected data.

CANDOR
- In the proof of concept the whole dataset lives in the browser. That is fine for synthetic data and for de-identified or offline use, but it is not how you would deploy real recipient data (slide 9).`);
  }

  // ============ 6. WHY IT IS FAST ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Architecture' });
    title(s, 'Why it is fast');
    // column-store illustration
    const heads = ['State', 'Type', 'Status', 'Benefit', 'Name', 'ZIP'];
    const cw = 0.6, cg = 0.08, rx = 0.5, ry = 1.85, rh = 0.3, rg = 0.06;
    heads.forEach((h, c) => {
      const scanned = c < 4;
      text(s, h, { x: rx + c * (cw + cg), y: 1.45, w: cw, h: 0.3, fontSize: 11, bold: scanned, color: scanned ? C.accent1 : C.accent5, align: 'center' });
      for (let r = 0; r < 7; r++) {
        s.addShape(pres.ShapeType.rect, {
          x: rx + c * (cw + cg), y: ry + r * (rh + rg), w: cw, h: rh,
          fill: { color: scanned ? C.accent1 : C.accent3, transparency: scanned ? 0 : 65 },
          line: { color: scanned ? C.accent1 : C.accent3, width: 0 }, objectName: scanned ? 'col-scanned' : 'col-skipped',
        });
      }
    });
    text(s, 'A filter reads only the columns it needs; the rest never leave memory.', { x: 0.5, y: 4.5, w: 4.0, h: 0.5, fontSize: 12, italic: true, color: C.accent5 });

    const pts = [
      ['FaColumns', 'Columnar layout', 'Each field is a packed array, so scans stream through the CPU cache.'],
      ['FaBook', 'Dictionary-coded names', 'Name search checks a few hundred distinct names once, then looks up each row.'],
      ['FaFilter', 'Bitmask filters', 'State, type and status tests are single bit operations per record.'],
      ['FaSortAmountDown', 'Windowed sorting', 'Only the requested page is ordered, never all five million rows.'],
    ];
    for (let i = 0; i < pts.length; i++) {
      const [ic, head, body] = pts[i];
      const y = 1.35 + i * 0.9;
      await badge(s, ic, 5.0, y + 0.05, 0.55);
      text(s, head, { x: 5.75, y, w: 3.75, h: 0.3, fontSize: 15, bold: true, color: C.text2 });
      text(s, body, { x: 5.75, y: y + 0.3, w: 3.75, h: 0.5, fontSize: 12, color: C.text1 });
    }
    s.addNotes(
`DON'T GO DEEP: THREE MINUTES AT MOST. THE POINT IS "THERE IS NO MAGIC".
- Columnar layout: instead of storing one object per person, we store one array per field. A query on state and benefit never touches names or ZIP codes, so the processor streams through memory in order. That is the main reason 5 million records is only about 90 MB and scans in milliseconds.
- Dictionary-coded names: there are only a few hundred distinct first and last names in the synthetic data. We test the search text against that small dictionary once, then each record is a table lookup instead of a text comparison. (Real data will have a larger dictionary; the technique still scales well, but we should re-measure.)
- Bitmask filters: choosing "Maryland, Virginia, DC" becomes one number; testing a record is one bit check.
- Windowed sorting: if you ask for the top 50, we only order enough to produce those 50. For very deep pages we switch to a selection algorithm, which cut the 100,000-row-deep case from about 220 ms to about 80 ms during this work.

TAKEAWAY
- These are standard, well-understood techniques. The speed comes from design discipline, not exotic technology, which also means the approach is maintainable.`);
  }

  // ============ 7. PERFORMANCE ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Architecture' });
    title(s, 'Measured performance');
    card(s, 0.5, 1.25, 6.1, 3.55, { name: 'chart-card' });
    s.addChart(pres.charts.BAR, [{
      name: 'Query time (ms)',
      labels: ['Page 100,000 rows deep', 'Aggregates, full scan', 'Multi-filter + sort', 'Top 50 by benefit', 'Name search “smith”', 'Name search + 3 states'],
      values: [79.2, 19.1, 16.2, 14.0, 13.4, 5.5],
    }], {
      x: 0.6, y: 1.35, w: 5.9, h: 3.35, barDir: 'bar', catAxisOrientation: 'maxMin', chartColors: [HEX.accent1],
      showTitle: true, title: 'Milliseconds per query, 5M records (native)', titleFontSize: 13, titleColor: HEX.dk2, titleFontFace: '+mn-lt',
      showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0.0', dataLabelFontSize: 11, dataLabelColor: HEX.dk1, dataLabelFontFace: '+mn-lt',
      catAxisLabelColor: HEX.dk1, catAxisLabelFontSize: 11, catAxisLabelFontFace: '+mn-lt',
      valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, showLegend: false, barGapWidthPct: 45,
      valAxisMaxVal: 95,
    });
    [['0.55 s', 'to generate and load 5M records'], ['< 1 ms', 'exact record-ID lookup'], ['1.2–2×', 'expected WebAssembly slowdown (estimate, not yet measured)']].forEach(([n, l], i) => {
      const y = 1.25 + i * 1.2;
      card(s, 6.85, y, 2.65, 1.1, { name: 'perf-callout' });
      text(s, n, { x: 7.05, y: y + 0.1, w: 2.3, h: 0.45, fontSize: 24, bold: true, color: C.accent1, fontFace: THEME.headFontFace });
      text(s, l, { x: 7.05, y: y + 0.55, w: 2.3, h: 0.5, fontSize: 11, color: C.accent5 });
    });
    text(s, 'Native build, 2-core virtual machine; each bar is the average of two benchmark runs (best of 5 each).', { x: 0.5, y: 4.85, w: 9, h: 0.25, fontSize: 10, color: C.accent5, italic: true });
    s.addNotes(
`WHAT THE CHART SHOWS
- Time for representative queries over 5 million records, on a native build. Typical searches and filters land between about 5 and 20 ms. The worst case we tested, a page 100,000 rows deep in a sorted list, took about 80 ms.
- Loading the dataset takes about half a second; looking up one record by ID is under a millisecond.

HONESTY POINTS (volunteer these)
- These are native numbers on a small 2-core VM. WebAssembly is usually 1.2 to 2 times slower for this kind of code; that is an estimate from general experience, not something we measured. Measuring it in target browsers is the first item on the roadmap.
- The data is synthetic. Real data has more varied names and different value distributions, so we must re-run these benchmarks on a de-identified extract.

IF ASKED "IS 80 MS FAST ENOUGH?"
- For interactive use, anything under ~100 ms feels instantaneous. And it is the extreme case; most queries are 5 to 20 ms.

LESSON LEARNED (good story if there is time)
- Our first benchmark runs were 2 to 6 times slower than the final numbers (the largest gains were on unfiltered queries). Two small fixes, reserving memory up front and keeping pointers in registers, gave most of the improvement. Measuring first, then tuning, matters more than the choice of language (next slides).`);
  }

  // ============ 8. LANGUAGE OPTIONS ============
  pres.addSection({ title: 'Options' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Options' });
    title(s, 'Language options, measured');
    const hdr = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.text2 }, fontSize: 12, valign: 'middle' } });
    const cell = (t, o = {}) => ({ text: t, options: Object.assign({ color: C.text1, fontSize: 12, valign: 'middle', fill: { color: C.background1 } }, o) });
    const rows = [
      [hdr('Option'), hdr('What we measured'), hdr('Pros'), hdr('Cons')],
      [cell('C++ → WebAssembly\n(chosen)', { bold: true, color: C.accent1 }),
        cell('5–19 ms typical scans at 5M records'),
        cell('Top-tier speed; mature toolchain; zero third-party libraries; already built and tested'),
        cell('Memory-safety risk; needs disciplined review and tooling')],
      [cell('Rust → WebAssembly', { bold: true }),
        cell('Port matched C++ within noise once both were tuned'),
        cell('Memory safe by default; simpler WebAssembly tooling'),
        cell('Rewrite cost; team ramp-up; no speed advantage found')],
      [cell('Python + NumPy', { bold: true }),
        cell('3–5× slower on name search, sorts and aggregates'),
        cell('Fastest to write; excellent for ETL and verification'),
        cell('No browser story without shipping a multi-megabyte Python runtime; server only')],
      [cell('Pure Python', { bold: true }),
        cell('~10× slower on the simplest filter (extrapolated)'),
        cell('Simplest possible code'),
        cell('Not viable at this scale for interactive use')],
    ];
    s.addTable(rows, { x: 0.5, y: 1.25, w: 9.0, colW: [1.75, 2.35, 2.6, 2.3], rowH: [0.35, 0.78, 0.7, 0.7, 0.55], border: { type: 'solid', pt: 0.75, color: 'D5DDDB' }, margin: [0.04, 0.08, 0.04, 0.08], autoPage: false });
    text(s, 'An untuned Rust port looked 1.3–2× faster; the gap was tuning, not language. Tuned C++ matched it.', { x: 0.5, y: 4.55, w: 9.0, h: 0.5, fontSize: 14, italic: true, bold: true, color: C.accent1 });
    s.addNotes(
`WHY WE RAN THIS COMPARISON
- A fair question from any technical reviewer is "why C++ in 2026, why not Rust, or just Python?" So we answered it with measurements, not opinion.

HOW THE RUST COMPARISON WAS DONE
- We ported the hot path to Rust with the same random generator, the same data tables and the same algorithms, and verified that both engines return identical match counts on all ten benchmark cases. Then we ran both on the same machine.
- The first untuned runs showed Rust 1.3 to 2 times faster on scans. We dug in: the C++ code was losing time to vector growth and to reloading pointers inside the hot loop. After applying the equivalent fixes, C++ matched or beat Rust on scans and top-50 sorts. Rust edged ahead on one multi-filter case; C++ led on aggregates and deep pages.
- Conclusion: for this workload, speed does not decide between them. Safety and staffing do.

PYTHON
- NumPy gets surprisingly close on one selective filter, but is 3 to 5 times slower on name search, sorts and aggregates, and cannot run in a browser without shipping a multi-megabyte Python runtime. Pure Python is about 10 times slower on the simplest case we measured (extrapolated from 1 million rows).
- Python's real value here is the verification role on slide 10.

HOW TO FRAME THE DECISION
- Keep C++ because it is built, tested and fast. Keep Rust as a credible option for new modules if the organization wants memory-safe-by-default code.`);
  }

  // ============ 9. PLATFORM OPTIONS ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Options' });
    title(s, 'Deployment platform options');
    const opts = [
      { head: 'Browser only (WebAssembly)', tag: 'De-identified / offline', pros: 'No server load; instant UI; works offline.', cons: 'Whole dataset must reach the device; unsuitable for protected PII; browser memory ceiling.', rec: false },
      { head: 'Server-side service (same C++ core)', tag: 'RECOMMENDED for protected data', pros: 'Data stays in a controlled enclave; central access control and audit; thin client.', cons: 'Network round trip; a service to operate and secure.', rec: true },
      { head: 'Database-native (PostgreSQL / Oracle)', tag: 'Not benchmarked here', pros: 'Existing skills and tooling; transactions; mature security features.', cons: 'Substring name search and live aggregates need extra indexing work.', rec: false },
      { head: 'Search platform (OpenSearch / Elasticsearch)', tag: 'Not benchmarked here', pros: 'Built-in text search; scales out horizontally.', cons: 'A cluster to run and secure; heavier footprint than one service.', rec: false },
    ];
    opts.forEach((o, i) => {
      const x = 0.5 + (i % 2) * 4.6, y = 1.25 + Math.floor(i / 2) * 1.8;
      card(s, x, y, 4.4, 1.65, { name: 'option-card', line: o.rec ? C.accent2 : undefined, lineW: o.rec ? 2.25 : 0 });
      text(s, o.head, { x: x + 0.2, y: y + 0.12, w: 4.0, h: 0.3, fontSize: 14, bold: true, color: C.text2 });
      text(s, o.tag, { x: x + 0.2, y: y + 0.42, w: 4.0, h: 0.22, fontSize: 11, bold: true, color: o.rec ? C.accent4 : C.accent5 });
      s.addText([
        { text: 'Pros  ', options: { bold: true, color: C.accent1 } }, { text: o.pros, options: { breakLine: true } },
        { text: 'Cons  ', options: { bold: true, color: C.accent4 } }, { text: o.cons },
      ], { x: x + 0.2, y: y + 0.68, w: 4.0, h: 0.95, fontSize: 12, color: C.text1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 4 });
    });
    text(s, 'Database and search-platform options are assessed qualitatively; we did not benchmark them.', { x: 0.5, y: 4.8, w: 9, h: 0.25, fontSize: 10, italic: true, color: C.accent5 });
    s.addNotes(
`THIS IS THE SLIDE THAT DRIVES THE DECISION. SPEND TIME HERE.

THE CORE PRINCIPLE
- Where the data lives matters more than which language computes on it. If the engine runs in the browser, the dataset has to be downloaded to the user's device. That is acceptable for synthetic, de-identified or aggregated data and for offline tools, but not for protected recipient records.

OUR RECOMMENDATION
- For protected data, run the same C++ core as a server-side service inside an approved environment. Users get the same fast experience through a thin web client, while access control, audit logging and data protection are enforced centrally.
- Keep the WebAssembly build for de-identified or offline analyst use, where having the engine on the client is a feature.

THE ALTERNATIVES, FAIRLY
- Database-native (PostgreSQL or Oracle): the lowest-risk operationally because the skills and security tooling already exist. We did NOT benchmark it. Substring name search and live aggregates over millions of rows usually need extra indexing work, so interactive speed would need to be proven.
- Search platform (OpenSearch or Elasticsearch): excellent text search and scale-out, but another cluster to run and secure. We did not benchmark it either.
- A reasonable pilot could compare our service against a database baseline on the same de-identified extract, with identical success metrics.

LIKELY QUESTION: "WHY NOT JUST USE THE DATABASE WE ALREADY HAVE?"
- Maybe we should; the pilot answers it with data. Our engine is a fast, simple candidate, not a foregone conclusion.`);
  }

  // ============ 10. QUALITY & VERIFICATION ============
  pres.addSection({ title: 'Governance' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Governance' });
    title(s, 'Quality and verification');
    const stats = [
      ['120,046', 'automated unit checks, all passing'],
      ['1,100', 'random queries cross-checked against an independent NumPy implementation: 0 mismatches'],
      ['2 of 2', 'deliberately planted bugs caught by the oracle'],
    ];
    stats.forEach(([big, label], i) => {
      const x = 0.5 + i * 3.05;
      card(s, x, 1.25, 2.9, 1.5, { name: 'quality-stat' });
      text(s, big, { x: x + 0.25, y: 1.35, w: 2.4, h: 0.6, fontSize: 34, bold: true, color: C.accent1, fontFace: THEME.headFontFace, valign: 'middle' });
      text(s, label, { x: x + 0.25, y: 1.98, w: 2.45, h: 0.85, fontSize: 12, color: C.text1 });
    });
    card(s, 0.5, 2.95, 4.4, 2.0, { name: 'why-it-works' });
    text(s, 'Why this is credible', { x: 0.7, y: 3.08, w: 4.0, h: 0.3, fontSize: 15, bold: true, color: C.text2 });
    s.addText([
      { text: 'A second implementation in another language checks the first', options: { bullet: true, breakLine: true } },
      { text: 'Same data bytes, random queries, exact comparison', options: { bullet: true, breakLine: true } },
      { text: 'The checker is proven able to fail', options: { bullet: true } },
    ], { x: 0.7, y: 3.5, w: 4.0, h: 1.35, fontSize: 14, color: C.text1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 4 });
    card(s, 5.1, 2.95, 4.4, 2.0, { fill: C.background1, line: C.accent2, lineW: 2.25, name: 'not-verified' });
    text(s, 'Not verified yet', { x: 5.3, y: 3.08, w: 4.0, h: 0.3, fontSize: 15, bold: true, color: C.accent4 });
    s.addText([
      { text: 'WebAssembly build running in real browsers', options: { bullet: true, breakLine: true } },
      { text: 'Speed and correctness on real data shapes', options: { bullet: true, breakLine: true } },
      { text: 'Section 508 accessibility audit', options: { bullet: true, breakLine: true } },
      { text: 'Security and privacy assessment', options: { bullet: true } },
    ], { x: 5.3, y: 3.5, w: 4.0, h: 1.35, fontSize: 14, color: C.text1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 3 });
    s.addNotes(
`WHY THIS MATTERS FOR BENEFIT DATA
- A search tool that is fast but subtly wrong is worse than a slow one. So we built layers of verification.

LAYER 1: UNIT TESTS
- 120,046 automated checks, including comparing every filter against an independent brute-force matcher, verifying sort order and page boundaries, and exercising error handling on malformed requests.

LAYER 2: AN INDEPENDENT ORACLE
- Unit tests written by the same person share that person's assumptions. So we exported the engine's exact data and re-implemented the query rules separately in Python with NumPy. We then fired 1,100 random queries at both, at 1, 2 and 5 million records, and compared totals, the exact page of IDs, and every aggregate. Zero mismatches.

LAYER 3: PROVING THE CHECKER CAN FAIL
- We deliberately planted two bugs in a scratch copy of the engine, an off-by-one at a benefit boundary and a wrong tie-break when sorting descending. The oracle flagged both (17 and 53 of 300 queries respectively). A check that has never failed proves nothing; this one has.

BE EQUALLY CLEAR ABOUT THE GAPS (right-hand box)
- We have not yet run the WebAssembly build in real browsers, tested on real data shapes, or done accessibility and security reviews. Those are the gating items before any pilot.`);
  }

  // ============ 11. SECURITY & COMPLIANCE ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Governance' });
    title(s, 'Security, privacy and compliance');
    const hdr = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.text2 }, fontSize: 12, valign: 'middle' } });
    const area = (t) => ({ text: t, options: { bold: true, color: C.text2, fontSize: 12, valign: 'middle', fill: { color: C.background1 } } });
    const body = (t, hi = false) => ({ text: t, options: { color: C.text1, fontSize: 12, valign: 'middle', fill: { color: hi ? C.background2 : C.background1 } } });
    const rows = [
      [hdr('Area'), hdr('Proof of concept today'), hdr('Required for production')],
      [area('Data'), body('Synthetic only; SSN shown masked to last four'), body('Protected data stays server-side; encryption in transit and at rest')],
      [area('Access control'), body('None (single-user demo)'), body('Role-based access; field-level masking by role')],
      [area('Audit'), body('None'), body('Query and access logging with controlled retention')],
      [area('Hosting and authorization'), body('Local development only'), body('Agency-approved environment; authorization to operate (ATO)')],
      [area('Accessibility and privacy'), body('Standard Bootstrap components'), body('Section 508 audit; Privacy Act and system-of-records review')],
    ];
    s.addTable(rows, { x: 0.5, y: 1.25, w: 9.0, colW: [2.1, 3.0, 3.9], rowH: [0.35, 0.52, 0.45, 0.45, 0.52, 0.52], border: { type: 'solid', pt: 0.75, color: 'D5DDDB' }, margin: [0.04, 0.08, 0.04, 0.08], autoPage: false });
    text(s, 'The proof of concept deliberately has no security controls: it contains no real data.', { x: 0.5, y: 4.4, w: 9, h: 0.4, fontSize: 14, italic: true, bold: true, color: C.accent1 });
    s.addNotes(
`SET THE RIGHT EXPECTATION
- The proof of concept has no security controls on purpose. It handles no real data. This slide is the gap analysis between what exists and what production requires. It is a checklist, not a claim of compliance.

WALK THE ROWS
- Data: synthetic only today, SSN masked to the last four. In production, protected data stays server-side with encryption in transit and at rest.
- Access control: none today. Production needs role-based access and field-level masking, so a user sees only what their role allows.
- Audit: production needs query and access logging so we can answer "who looked at what, and when".
- Hosting and authorization: the engine would run in an agency-approved environment and go through the authorization-to-operate process.
- Accessibility and privacy: Bootstrap gives a reasonable starting point but is not itself a compliance guarantee. A Section 508 audit and Privacy Act / system-of-records review are required.

WHAT I'D ASK FROM THIS ROOM
- Name the security, privacy and accessibility reviewers now, so their requirements shape the pilot instead of arriving after it (decision 3 on the last slide).

NOTE ON SPECIFICS
- I have deliberately not asserted any particular agency policy or control baseline here; those should come from the agency's own security and privacy offices.`);
  }

  // ============ 12. MAINTAINABILITY ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Governance' });
    title(s, 'Maintainability and ownership');
    [['≈1,080', 'lines of C++ in the engine'], ['0', 'third-party libraries in the engine'], ['4', 'runtime packages in the UI']].forEach(([n, l], i) => {
      const y = 1.25 + i * 1.25;
      card(s, 0.5, y, 2.7, 1.1, { name: 'maint-stat' });
      text(s, n, { x: 0.7, y: y + 0.1, w: 2.3, h: 0.5, fontSize: 28, bold: true, color: C.accent1, fontFace: THEME.headFontFace });
      text(s, l, { x: 0.7, y: y + 0.62, w: 2.35, h: 0.4, fontSize: 12, color: C.accent5 });
    });
    card(s, 3.45, 1.25, 6.05, 1.75, { name: 'helps' });
    text(s, 'What helps', { x: 3.65, y: 1.35, w: 5.6, h: 0.3, fontSize: 15, bold: true, color: C.accent1 });
    s.addText([
      { text: 'A small JSON boundary lets the UI and engine change independently', options: { bullet: true, breakLine: true } },
      { text: 'One code base serves browser, server, tests and benchmarks', options: { bullet: true, breakLine: true } },
      { text: 'Deterministic data makes every bug reproducible', options: { bullet: true, breakLine: true } },
      { text: 'Standard library only: nothing external to patch or track', options: { bullet: true } },
    ], { x: 3.65, y: 1.7, w: 5.65, h: 1.25, fontSize: 13, color: C.text1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 3 });
    card(s, 3.45, 3.2, 6.05, 1.75, { name: 'watch-outs' });
    text(s, 'What to watch, and the mitigation', { x: 3.65, y: 3.3, w: 5.6, h: 0.3, fontSize: 15, bold: true, color: C.accent4 });
    s.addText([
      { text: 'Memory safety in C++: run sanitizers and fuzzing in CI', options: { bullet: true, breakLine: true } },
      { text: 'Emscripten upgrades: pin versions and rebuild in CI', options: { bullet: true, breakLine: true } },
      { text: 'Staffing: C++ skills needed; Rust is a viable path for new modules', options: { bullet: true } },
    ], { x: 3.65, y: 3.65, w: 5.65, h: 1.25, fontSize: 13, color: C.text1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 3 });
    s.addNotes(
`THE HONEST MAINTAINABILITY STORY
- The engine is about 1,080 lines of C++ and uses nothing outside the language's standard library, so there are no third-party components to patch or track for vulnerabilities. The UI has four runtime packages (React, React DOM, Bootstrap, Bootstrap Icons) plus standard build tooling.
- The boundary between UI and engine is a small JSON API. Either side can be replaced or rewritten without touching the other.
- The data generator is deterministic, so any failure can be reproduced exactly from a seed.

WHAT NEEDS CARE
- C++ gives the programmer power and responsibility. Memory-safety bugs are the classic risk. Standard mitigations are inexpensive: build with address and undefined-behaviour sanitizers in CI, add fuzzing on the JSON parser and query path, and keep code review strict. The parser already enforces nesting-depth and result-size limits.
- The WebAssembly toolchain (Emscripten) evolves; pin versions and rebuild in CI so upgrades are deliberate.
- Staffing: C++ expertise must exist on the team. If the organization prefers memory-safe-by-default code, Rust is a credible alternative for new modules; our measurements show no speed penalty.

BOTTOM LINE
- This is a small, readable code base with tests and an independent check. Ownership by a small team is realistic.`);
  }

  // ============ 13. RISKS ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Governance' });
    title(s, 'Risks and mitigations');
    const hdr = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.text2 }, fontSize: 12, valign: 'middle' } });
    const risk = (t) => ({ text: t, options: { bold: true, color: C.text2, fontSize: 12, valign: 'middle', fill: { color: C.background1 } } });
    const imp = (t) => ({ text: t, options: { bold: true, align: 'center', fontSize: 12, valign: 'middle', color: C.text1, fill: { color: t === 'High' ? 'F3D3CE' : 'F7E8BF' } } });
    const mit = (t) => ({ text: t, options: { color: C.text1, fontSize: 12, valign: 'middle', fill: { color: C.background1 } } });
    const rows = [
      [hdr('Risk'), hdr('Impact'), hdr('Mitigation')],
      [risk('Protected data exposed on client devices'), imp('High'), mit('Production path is server-side; WebAssembly limited to de-identified data')],
      [risk('Memory-safety defect in C++'), imp('High'), mit('Sanitizers, fuzzing, bounded inputs, strict review; Rust for new modules')],
      [risk('WebAssembly speed not yet measured'), imp('Medium'), mit('First milestone: benchmark in target browsers (estimate: 1.2–2× native)')],
      [risk('Real data differs from synthetic'), imp('Medium'), mit('Load a de-identified extract; re-run benchmarks and the oracle on it')],
      [risk('Accessibility and compliance gaps'), imp('Medium'), mit('Section 508 audit and security review before any pilot')],
    ];
    s.addTable(rows, { x: 0.5, y: 1.25, w: 9.0, colW: [3.1, 1.0, 4.9], rowH: [0.35, 0.6, 0.6, 0.6, 0.6, 0.6], border: { type: 'solid', pt: 0.75, color: 'D5DDDB' }, margin: [0.04, 0.08, 0.04, 0.08], autoPage: false });
    text(s, 'None of these is a reason to stop. Each has a concrete first step.', { x: 0.5, y: 4.7, w: 9, h: 0.3, fontSize: 14, italic: true, bold: true, color: C.accent1 });
    s.addNotes(
`TWO HIGH, THREE MEDIUM
- Highest concern: exposing protected data on client devices. It is avoided by design: protected data stays on the server; the browser-resident engine is for de-identified data only.
- Second highest: a memory-safety defect in C++. This is manageable with standard practice: sanitizers, fuzzing, input limits and review gates, and it is also the main argument for considering Rust for new modules.
- Medium risks are unknowns we can retire quickly: WebAssembly speed (measure it), real-data behaviour (load a de-identified extract and re-run the same benchmarks and the oracle), and accessibility/compliance (schedule the audit early).

TONE
- Present this as a managed risk list, not a case for stopping. Every row has a concrete first step that appears on the roadmap.

IF ASKED FOR PROBABILITIES OR COSTS
- We have not estimated either. Costs depend on data-access approvals and review capacity, which we do not control; I'd rather bring a costed plan after the validation phase.`);
  }

  // ============ 14. ROADMAP ============
  pres.addSection({ title: 'Path forward' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Path forward' });
    title(s, 'Roadmap');
    const phases = [
      ['0', 'Proof of concept', 'Done', ['Engine, UI and tests', '5M-record benchmarks', 'Independent oracle'], true],
      ['1', 'Validate', 'Next', ['Run in target browsers', 'Load a de-identified extract', 'Re-benchmark real data'], false],
      ['2', 'Pilot service', 'Then', ['Server-side API on same core', 'Authentication, roles, audit', 'Pilot users and metrics'], false],
      ['3', 'Assurance', 'In parallel', ['Section 508 audit', 'Security and privacy review', 'Authorization path (ATO)'], false],
    ];
    phases.forEach(([n, head, tag, items, done], i) => {
      const x = 0.5 + i * 2.3;
      card(s, x, 1.3, 2.1, 3.3, { name: 'phase-card', fill: done ? C.text2 : C.background1 });
      s.addShape(pres.ShapeType.ellipse, { x: x + 0.2, y: 1.5, w: 0.5, h: 0.5, fill: { color: done ? C.accent2 : C.accent1 }, line: { color: done ? C.accent2 : C.accent1, width: 0 }, objectName: 'phase-number-bg' });
      text(s, n, { x: x + 0.2, y: 1.5, w: 0.5, h: 0.5, fontSize: 18, bold: true, color: done ? C.text2 : C.background1, align: 'center', valign: 'middle', fontFace: THEME.headFontFace });
      text(s, tag.toUpperCase(), { x: x + 0.85, y: 1.6, w: 1.15, h: 0.3, fontSize: 10, bold: true, color: done ? C.accent2 : C.accent5, charSpacing: 1, valign: 'middle' });
      text(s, head, { x: x + 0.2, y: 2.2, w: 1.75, h: 0.4, fontSize: 17, bold: true, color: done ? C.background1 : C.text2 });
      s.addText(items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })), {
        x: x + 0.2, y: 2.7, w: 1.75, h: 1.8, fontSize: 12, color: done ? C.background2 : C.text1, isTextBox: true, margin: 0, valign: 'top', paraSpaceAfter: 6,
      });
    });
    text(s, 'Timing depends on data-access approvals and review capacity; a costed plan follows Phase 1.', { x: 0.5, y: 4.75, w: 9, h: 0.3, fontSize: 12, italic: true, color: C.accent5 });
    s.addNotes(
`FOUR PHASES, NO DATES ON PURPOSE
- Phase 0 is done: engine, UI, tests, benchmarks and the independent oracle.
- Phase 1, Validate: run the WebAssembly build in the browsers we would actually support; add a loader that turns a de-identified extract into the engine's column format (NumPy is a good fit for that conversion); then re-run benchmarks and the oracle on the real data shape. This retires the two medium technical risks.
- Phase 2, Pilot service: stand up the server-side API on the same C++ core, with authentication, role-based access and audit logging, and give a small group of pilot users defined success metrics. Include a database baseline for comparison.
- Phase 3, Assurance: runs in parallel from the start, not at the end. Accessibility audit, security and privacy review, and the authorization path.

WHY NO DATES
- Schedule depends on approvals for a de-identified extract and on reviewer capacity, neither of which the project controls. I would rather commit to a costed plan after Phase 1 than guess now.

SUGGESTED SUCCESS METRICS FOR THE PILOT
- Response time at the 95th percentile, zero correctness mismatches against the oracle, and accessibility conformance findings closed.`);
  }

  // ============ 15. DECISIONS (dark) ============
  {
    const s = pres.addSlide({ masterName: 'CLOSING_DARK', sectionTitle: 'Path forward' });
    title(s, 'Decisions requested');
    const asks = [
      'Endorse server-side deployment of the C++ core as the production target',
      'Approve a de-identified data extract for the pilot',
      'Name security, privacy and accessibility reviewers',
      'Agree success metrics: response time, correctness, accessibility',
    ];
    asks.forEach((t, i) => {
      const y = 1.35 + i * 0.85;
      s.addShape(pres.ShapeType.ellipse, { x: 0.5, y, w: 0.6, h: 0.6, fill: { color: C.accent2 }, line: { color: C.accent2, width: 0 }, objectName: 'ask-number-bg' });
      text(s, String(i + 1), { x: 0.5, y, w: 0.6, h: 0.6, fontSize: 22, bold: true, color: C.text2, align: 'center', valign: 'middle', fontFace: THEME.headFontFace });
      text(s, t, { x: 1.35, y, w: 8.1, h: 0.6, fontSize: 20, color: C.background1, valign: 'middle' });
    });
    text(s, 'Questions and discussion', { x: 0.5, y: 4.85, w: 6, h: 0.35, fontSize: 16, italic: true, color: C.accent3 });
    s.addNotes(
`CLOSE WITH THE ASKS, ONE AT A TIME. PAUSE AFTER EACH.
1. Production target: do you endorse running the C++ core as a server-side service for protected data, with the browser build reserved for de-identified or offline use?
2. Data: can we get approval for a de-identified extract so Phase 1 can test real data shapes?
3. Reviewers: who are the security, privacy and accessibility contacts we should engage now?
4. Metrics: do response time, correctness against the independent oracle, and accessibility closure give you the right bar for a pilot?

IF THE ROOM IS UNDECIDED
- The smallest useful yes is Phase 1 only: validate in browsers and on a de-identified extract. It is low cost and retires the main unknowns without committing to a production path.

CLOSING LINE
- We have evidence that the approach is fast, small and verifiable. What we need now is the right data, the right reviewers, and a decision on where the engine should run.`);
  }

  // ============ 16. APPENDIX ============
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Path forward' });
    title(s, 'Appendix: reproduce the results');
    card(s, 0.5, 1.25, 5.3, 3.3, { fill: C.text2, name: 'code-panel' });
    s.addText([
      { text: '# native engine: build, test, benchmark', options: { color: C.accent3, breakLine: true } },
      { text: 'cd engine', options: { color: C.background1, breakLine: true } },
      { text: 'cmake -S . -B build && cmake --build build', options: { color: C.background1, breakLine: true } },
      { text: './build/ssa_tests', options: { color: C.background1, breakLine: true } },
      { text: './build/ssa_bench 5000000', options: { color: C.background1, breakLine: true } },
      { text: ' ', options: { breakLine: true } },
      { text: '# independent NumPy cross-check', options: { color: C.accent3, breakLine: true } },
      { text: 'python3 experiments/python-engine/oracle.py', options: { color: C.background1, breakLine: true } },
      { text: ' ', options: { breakLine: true } },
      { text: '# WebAssembly build + UI', options: { color: C.accent3, breakLine: true } },
      { text: 'emcmake cmake -S . -B build-wasm', options: { color: C.background1, breakLine: true } },
      { text: 'cmake --build build-wasm', options: { color: C.background1, breakLine: true } },
      { text: 'cd ../web && npm install && npm run dev', options: { color: C.background1 } },
    ], { x: 0.75, y: 1.45, w: 4.9, h: 3.3, fontFace: 'Courier New', fontSize: 12, isTextBox: true, margin: 0, valign: 'top' });
    const repo = [['engine/', 'C++23 core, JSON API, tests, benchmark'], ['web/', 'React + Bootstrap UI, worker host'], ['experiments/rust-engine/', 'Rust port and comparison'], ['experiments/python-engine/', 'NumPy benchmark and oracle'], ['README.md', 'Design, measurements, status']];
    repo.forEach(([f, d], i) => {
      const y = 1.3 + i * 0.72;
      text(s, f, { x: 6.1, y, w: 3.4, h: 0.3, fontSize: 13, bold: true, color: C.accent1, fontFace: 'Courier New' });
      text(s, d, { x: 6.1, y: y + 0.3, w: 3.4, h: 0.35, fontSize: 12, color: C.text1 });
    });
    s.addNotes(
`OPTIONAL: FOR TECHNICAL REVIEWERS
- Every number in this deck can be reproduced from the repository with the commands on the left. Benchmarks print the same match totals as the independent oracle and the Rust port, which is how we know the comparisons are like for like.
- The WebAssembly step requires the Emscripten SDK, which could not be installed in the build environment used to prepare this briefing; that is why browser validation is the first roadmap item.
- Machine used for benchmarks: a 2-core virtual machine, g++ 13 at -O3. Expect different absolute numbers on other hardware; the relative results should hold.`);
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
