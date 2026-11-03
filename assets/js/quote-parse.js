/* PEOnomics — quote file reader + field extractor for the Quote Comparator.
   Everything runs in the visitor's browser: the file is never uploaded.
   - readQuoteFile(file) -> {text, kind} for PDF (pdf.js, lazy-loaded from jsDelivr with SRI),
     XLSX/XLSM, DOCX (own ZIP + XML reader), CSV/TSV/TXT. Scans and images have no text -> say so.
   - extractQuote(text, {filename}) -> fields + evidence. Pure and deterministic (no LLM, no network):
     every value it proposes carries the exact source snippet it came from, and anything it had to
     convert or infer is marked "check". Unknown stays unknown (null) — never zero.
   Exposed as window.PEOQuoteParse; also loadable in Node for tests (globalThis). */
(() => {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;

  /* ------------------------------------------------------------------ text model */
  const clean = s => String(s || '')
    .replace(/[   \t]/g, ' ').replace(/[‐-―−]/g, '-')
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
    .replace(/[ ]{2,}/g, ' ').trim();

  // "$1,250.00" "2.7%" ".85" "(1,000)" — returns [{v, raw, idx, dollar, pct}]
  const NUM_RE = /(\$\s?)?(\(?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\)?\s?(%|percent\b)?/gi;
  function numbers(s) {
    const out = []; let m; NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 1), m.index);
      if (/[A-Za-z]/.test(before) && !m[1]) continue;               // part of a word/code like "W2", "Q4"
      const v = Number(m[3].replace(/,/g, ''));
      if (!Number.isFinite(v)) continue;
      out.push({ v, raw: m[0].trim(), idx: m.index, dollar: !!m[1], pct: !!m[4], decimal: m[3].includes('.') });
    }
    return out;
  }
  const isYear = n => !n.dollar && !n.pct && !n.decimal && n.v >= 1990 && n.v <= 2099;
  const isClassCode = n => !n.dollar && !n.pct && !n.decimal && n.v >= 1000 && n.v <= 9999;

  const U = {
    pepm: /\b(?:pepm|per (?:worksite |w-?2 )?employee per month|per employee\s*[/,-]?\s*(?:per\s*)?month|per ee per month|per ee\s*[/]\s*mo(?:nth)?|\/\s*ee\s*\/\s*mo(?:nth)?|per head per month|per employee monthly|monthly per employee|per (?:enrolled )?employee\s*[/]\s*month)\b/i,
    pepy: /\b(?:per employee per year|per employee annually|per ee per year|per employee\s*[/]\s*year|annually per employee|per w-?2)\b/i,
    perCheck: /\b(?:per (?:pay)?check|per pay(?:roll)? period|per payroll|per pay run|per paystub|per employee per pay(?:roll)? period)\b/i,
    month: /\b(?:per month|monthly|\/\s*mo(?:nth)?|a month|each month|mo\.)\b/i,
    year: /\b(?:per year|annual(?:ly|ized)?|yearly|\/\s*yr|a year|per annum|each year)\b/i,
    per100: /(?:per|\/)\s*\$?\s*100\b|\bper hundred\b/i,
    perEmp: /\b(?:per (?:worksite |w-?2 |enrolled |covered )?(?:employee|ee|head|enrollee|participant)|each employee)\b/i,
    payroll: /\bof (?:gross |total |taxable |subject )?(?:payroll|wages|compensation)\b|\bpayroll\b/i,
    zero: /\b(?:waived|no charge|no cost|at no (?:additional )?cost|free of charge|complimentary|n\/c|none|included(?! in the total)|\$0(?:\.00)?(?![\d.,]))\b|\$0(?:\.00)?(?![\d.,])/i,
    total: /\b(?:total|aggregate|combined|all employees|for (?:the )?group)\b/i
  };

  /* Field label patterns. Order matters only for window splitting (every label ends the
     previous label's window). NOISE labels exist only to stop windows (FUTA's 0.6% must
     never become SUTA). */
  const L = {
    fee: /\b(?:admin(?:istrative|istration)?(?:\s*(?:service|services|processing))?\s*fees?|peo (?:service |administrative )?fees?|service fees?|professional (?:employer |services? )?fees?|management fees?|pepm fees?|(?:base |core |hr )?(?:service|platform) (?:fee|rate|price)|price per employee|pricing per employee)\b/i,
    setup: /\b(?:implementation|set[\s-]?up|onboarding|on-boarding|start[\s-]?up|conversion|one[\s-]?time|installation|enrollment set[\s-]?up)\s*(?:fees?|charges?|costs?|pricing)?\b/i,
    suta: /\b(?:suta|sui(?:ta)?|state unemployment(?: insurance| tax| rate)?|unemployment insurance(?: rate)?|state ui|ui rate|sit rate)\b/i,
    wc: /\b(?:workers'?\s*comp(?:ensation)?(?: insurance)?(?: rate| premium| cost)?|workman'?s comp|work comp|w\/c|wc rate|wc premium|comp rate)\b/i,
    health: /\b(?:employer (?:pays|contributes|covers)(?=[^.\n]{0,60}\b(?:health|medical|benefit|premium|covered|enrollee|insurance)\b)|employer (?:health(?:care)?|medical|benefits?|insurance)(?: plan)?\s*(?:contribution|cost|share|premium|spend)s?|employer contribution|employer share|er contribution|er share|employer[- ]paid (?:health|medical|premium)s?|health(?:care)? (?:insurance )?(?:cost|premium|contribution)s?|medical (?:insurance )?(?:premium|contribution|cost)s?|benefits? cost)\b/i,
    epli: /\b(?:epli|employment practices(?: liability)?(?: insurance| coverage)?)\b/i,
    other: /\b(?:(?:technology|tech|software|hris|time(?:\s*(?:and|&)\s*attendance| ?keeping| clock)|benefits? admin(?:istration)?|cobra(?: admin(?:istration)?)?|aca(?: reporting| compliance)|background checks?|payroll delivery|check delivery|year[\s-]end(?: w-?2)?(?: processing)?|w-?2 processing|garnishment(?: processing)?|401\(?k\)? admin(?:istration)?)(?:\s*(?:fees?|charges?|costs?))?|(?:additional|other|miscellaneous|misc\.?|ancillary|add[\s-]on)\s*(?:fees?|charges?|costs?|services?))\b/i,
    noise: /\b(?:futa|federal unemployment|fica|social security|medicare|experience mod(?:ifier)?|x-?mod|emr|deductible|retention|aggregate limit|policy limit|limit of liability|each claim|per claim|coverage limit|wage base|taxable wage|employee count|number of employees|headcount|employee only|ee only|employee \+ spouse|employee \+ child(?:ren)?|ee\+sp|ee\+ch|ee\+fam)\b/i
  };
  const FIELD_KEYS = ['fee', 'setup', 'suta', 'wc', 'health', 'epli', 'other'];

  function segments(lines) {
    // Each label occurrence gets a window: text after it up to the next label on the line;
    // if that window holds no number, borrow the next line (label/value split across lines).
    const segs = [];
    lines.forEach((line, li) => {
      const hits = [];
      for (const [key, re] of Object.entries(L)) {
        const g = new RegExp(re.source, 'gi'); let m;
        while ((m = g.exec(line))) hits.push({ key, start: m.index, end: m.index + m[0].length, label: m[0] });
      }
      hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
      const kept = []; let edge = -1;
      for (const h of hits) if (h.start >= edge) { kept.push(h); edge = h.end; }
      kept.forEach((h, k) => {
        let win = line.slice(h.end, k + 1 < kept.length ? kept[k + 1].start : line.length);
        let borrowed = false;
        const usable = numbers(win).filter(n => !isYear(n));
        if (!usable.length && !U.zero.test(win) && li + 1 < lines.length) {
          const next = lines[li + 1];
          const nextHasLabel = Object.entries(L).some(([kk, re]) => kk !== 'noise' && re.test(next));
          if (!nextHasLabel) { win = win + ' ' + next; borrowed = true; }
        }
        segs.push({ key: h.key, label: h.label, win: win.trim(), line, li, borrowed });
      });
    });
    return segs;
  }

  const snippet = (s, n = 110) => { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const firstNum = (win, pred = () => true) => numbers(win).filter(n => !isYear(n)).find(pred) || null;
  const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

  function payFrequency(text) {
    if (/\bsemi[\s-]?monthly\b/i.test(text)) return { periods: 24, label: 'semi-monthly' };
    if (/\bbi[\s-]?weekly\b|\bevery (?:two|2|other) weeks?\b/i.test(text)) return { periods: 26, label: 'bi-weekly' };
    if (/\bweekly\b/i.test(text)) return { periods: 52, label: 'weekly' };
    if (/\bmonthly payroll\b|\bpaid monthly\b/i.test(text)) return { periods: 12, label: 'monthly' };
    return null;
  }

  /* ------------------------------------------------------------------ common facts */
  function commonFacts(lines, text) {
    const out = {};
    const pick = (key, value, line, confidence = 'found', note = '') => { if (out[key] === undefined) out[key] = { value, evidence: snippet(line), confidence, note }; };
    for (const line of lines) {
      let m;
      if ((m = line.match(/\b(?:number of (?:worksite )?employees|employee count|headcount|total employees|# ?of employees|eligible employees|census(?: count)?|w-?2 employees|worksite employees|employees)\b\s*[:|=-]?\s*(\d{1,3}(?:,\d{3})*|\d+)\b(?!\s*%)/i)) ||
          (m = line.match(/\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:full[\s-]?time\s+|total\s+|w-?2\s+|worksite\s+)?(?:employees|ees|staff|team members)\b(?!\s*(?:enrolled|on the plan|covered|participat))/i))) {
        const v = Number(m[1].replace(/,/g, '')); if (v >= 1 && v <= 100000 && !(v >= 1990 && v <= 2099)) pick('employees', v, line);
      }
      if ((m = line.match(/\b(?:annual(?:ized)?|total|gross|estimated|projected|annual gross)\s*(?:gross\s*)?(?:payroll|wages|compensation)\b[^$\d]{0,24}\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/i))) {
        const v = Number(m[1].replace(/,/g, '')); if (v >= 10000) pick('payroll', v, line);
      }
      if ((m = line.match(/\baverage (?:annual )?(?:wage|salary|pay|compensation)\b[^$\d]{0,20}\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/i))) {
        const v = Number(m[1].replace(/,/g, '')); if (v >= 5000 && v <= 5000000) pick('wage', v, line);
      }
      if ((m = line.match(/\b(\d{1,5})\s+(?:employees\s+)?(?:enrolled|enrollees|covered employees|participating employees|on the (?:medical |health )?plan)\b/i)) ||
          (m = line.match(/\b(?:enrolled|enrollees|medical enrollment|covered employees|participants)\b[^\d\n%$]{0,25}?(\d{1,5})\b(?!\s*%)/i))) {
        pick('enrolledCount', Number(m[1]), line);
      }
      if ((m = line.match(/\b(?:health |medical )?(?:enrollment|participation)(?: rate)?\b\s*[:|=-]?\s*(\d{1,3}(?:\.\d+)?)\s?%/i))) {
        const v = Number(m[1]); if (v <= 100) pick('enrollment', v, line);
      }
      if ((m = line.match(/\b(?:su[it]a|sui|unemployment)\b.*?\b(?:(?:taxable )?wage base|first)\b[^$\d]{0,12}\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+))/i)) ||
          (m = line.match(/\b(?:taxable )?wage base\b[^$\d]{0,24}\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+))/i))) {
        const v = Number(m[1].replace(/,/g, '')); if (v >= 5000 && v <= 100000 && v !== 7000 && v !== 184500) pick('sutaBase', v, line);
      }
    }
    const res = {};
    if (out.employees) res.employees = out.employees;
    if (out.wage) res.wage = out.wage;
    else if (out.payroll && out.employees) res.wage = { value: Math.round(out.payroll.value / out.employees.value), evidence: out.payroll.evidence, confidence: 'check', note: `annual payroll ${money(out.payroll.value)} ÷ ${out.employees.value} employees` };
    if (out.enrollment) res.enrollment = out.enrollment;
    else if (out.enrolledCount && out.employees && out.enrolledCount.value <= out.employees.value) res.enrollment = { value: round(out.enrolledCount.value / out.employees.value * 100, 1), evidence: out.enrolledCount.evidence, confidence: 'check', note: `${out.enrolledCount.value} enrolled ÷ ${out.employees.value} employees` };
    if (out.sutaBase) res.sutaBase = out.sutaBase;
    res._payroll = out.payroll ? out.payroll.value : null;
    res._enrolled = out.enrolledCount ? out.enrolledCount.value : null;
    return res;
  }
  const money = v => '$' + Math.round(v).toLocaleString('en-US');

  /* ------------------------------------------------------------------ per-field readers
     Each returns a candidate {value, confidence:'found'|'check', note} or null. ctx has
     employees, payroll, enrolled, freq (from the same document). */
  const R = {
    fee(s, ctx) {
      if (/\bbenefits? admin|cobra|fsa|hsa|401|flexible spending|retirement|aca\b/i.test(s.label + ' ' + s.line.slice(0, s.line.indexOf(s.label)))) return null;
      const w = s.win;
      if (U.zero.test(w) && !firstNum(w, n => n.v > 0)) return null;      // an admin fee of $0 is not credible — leave to the visitor
      const pct = firstNum(w, n => n.pct);
      if (pct && pct.v > 0 && pct.v <= 25) {
        return { basis: 'pct', value: pct.v, raw: pct.raw, confidence: 'found', note: U.payroll.test(w) ? '' : '% — assumed % of gross payroll' };
      }
      const n = firstNum(w, x => !x.pct && x.v > 0 && !isClassCode(x));
      if (!n) return null;
      if (U.pepm.test(w)) return { basis: 'pepm', value: n.v, raw: n.raw, confidence: 'found' };
      if (U.pepy.test(w)) return { basis: 'pepm', value: round(n.v / 12, 2), raw: n.raw, confidence: 'check', note: `${n.raw} per employee per year ÷ 12` };
      if (U.perCheck.test(w)) {
        if (!ctx.freq) return { basis: 'pepm', value: null, raw: n.raw, confidence: 'check', note: `${n.raw} per check — pay frequency not stated, so no monthly figure` };
        return { basis: 'pepm', value: round(n.v * ctx.freq.periods / 12, 2), raw: n.raw, confidence: 'check', note: `${n.raw} per check × ${ctx.freq.periods} ${ctx.freq.label} pay dates ÷ 12` };
      }
      if ((U.month.test(w) && U.total.test(w + ' ' + s.label)) || (U.month.test(w) && !U.perEmp.test(w) && n.v > 1000)) {
        if (!ctx.employees) return { basis: 'pepm', value: null, raw: n.raw, confidence: 'check', note: `${n.raw} per month for the group — headcount needed to convert` };
        return { basis: 'pepm', value: round(n.v / ctx.employees, 2), raw: n.raw, confidence: 'check', note: `${n.raw} per month ÷ ${ctx.employees} employees` };
      }
      if (U.month.test(w) && U.perEmp.test(w)) return { basis: 'pepm', value: n.v, raw: n.raw, confidence: 'found' };
      if (n.v >= 15 && n.v <= 600) return { basis: 'pepm', value: n.v, raw: n.raw, confidence: 'check', note: 'unit not stated — assumed per employee per month' };
      return null;
    },
    setup(s, ctx) {
      const w = s.win;
      if (/\b(?:termination|exit|cancell?ation|early)\b/i.test(s.line)) return null;
      const n = firstNum(w, x => !x.pct);
      if (U.zero.test(w) && (!n || n.v === 0)) return { value: 0, raw: (w.match(U.zero) || ['$0'])[0], confidence: 'found', note: 'stated as waived / no charge' };
      if (!n) return null;
      if (U.perEmp.test(w)) {
        if (!ctx.employees) return { value: null, raw: n.raw, confidence: 'check', note: `${n.raw} per employee — headcount needed` };
        return { value: round(n.v * ctx.employees, 2), raw: n.raw, confidence: 'check', note: `${n.raw} per employee × ${ctx.employees}` };
      }
      return { value: n.v, raw: n.raw, confidence: 'found' };
    },
    suta(s) {
      const w = s.win;
      const pct = firstNum(w, n => n.pct && n.v >= 0 && n.v <= 15);
      if (pct) return { value: pct.v, raw: pct.raw, confidence: 'found' };
      const frac = firstNum(w, n => !n.dollar && n.decimal && n.v > 0 && n.v < 0.15);
      if (frac) return { value: round(frac.v * 100, 4), raw: frac.raw, confidence: 'check', note: `${frac.raw} read as a decimal rate = ${round(frac.v * 100, 4)}%` };
      const bare = firstNum(w, n => !n.dollar && n.decimal && n.v >= 0.15 && n.v <= 15);
      if (bare && /\brate\b/i.test(s.label + ' ' + w)) return { value: bare.v, raw: bare.raw, confidence: 'check', note: 'no % sign — read as percent' };
      return null;
    },
    wc(s, ctx) {
      const w = s.win;
      if (/\bmod(?:ifier)?\b|\bemr\b|x-?mod/i.test(s.label + w.slice(0, 20))) return null;
      if (U.per100.test(w)) {
        const n = firstNum(w, x => !isClassCode(x) && x.v > 0 && x.v <= 60 && !(x.v === 100 && !x.decimal));
        if (n) return { value: n.v, raw: n.raw, confidence: 'found' };
      }
      const pct = firstNum(w, n => n.pct && n.v > 0 && n.v <= 60);
      if (pct) return { value: pct.v, raw: pct.raw, confidence: 'found', note: '% of payroll = $ per $100 of payroll' };
      const prem = firstNum(w, n => n.dollar && n.v >= 100);
      if (prem && (/\bpremium|cost|total|annual|estimated\b/i.test(s.label + ' ' + w))) {
        const annual = U.month.test(w) ? prem.v * 12 : prem.v;
        if (!ctx.payroll) return { value: null, raw: prem.raw, confidence: 'check', note: `${prem.raw} premium — payroll needed to convert to a rate` };
        return { value: round(annual / ctx.payroll * 100, 4), raw: prem.raw, confidence: 'check', note: `${money(annual)} premium ÷ ${money(ctx.payroll)} payroll × 100` };
      }
      const rate = firstNum(w, n => !n.dollar && n.decimal && n.v > 0 && n.v <= 30 && !isClassCode(n));
      if (rate) return { value: rate.v, raw: rate.raw, confidence: 'check', note: 'no unit stated — read as $ per $100 of payroll' };
      return null;
    },
    health(s, ctx) {
      const w = s.win;
      if (/\b(?:employee|ee) (?:contribution|share|cost|pays)\b/i.test(s.label)) return null;
      const n = firstNum(w, x => !x.pct && x.v > 0);
      if (!n) return null;
      const employerish = /\bemployer|\ber\b|company[- ]paid/i.test(s.label + ' ' + w);
      const conf = employerish ? 'found' : 'check';
      const baseNote = employerish ? '' : 'not labeled as the employer share — check';
      const join = (...p) => p.filter(Boolean).join('; ');
      if (U.total.test(s.label + ' ' + w) && !U.perEmp.test(w)) {
        const annual = U.month.test(w) ? n.v * 12 : n.v;
        if (!ctx.enrolled) return { value: null, raw: n.raw, confidence: 'check', note: `${n.raw} for the whole group — number of enrollees needed` };
        return { value: Math.round(annual / ctx.enrolled), raw: n.raw, confidence: 'check', note: join(`${money(annual)} a year ÷ ${ctx.enrolled} enrollees`, baseNote) };
      }
      if (U.perCheck.test(w)) {
        if (!ctx.freq) return { value: null, raw: n.raw, confidence: 'check', note: `${n.raw} per pay period — pay frequency not stated` };
        return { value: Math.round(n.v * ctx.freq.periods), raw: n.raw, confidence: 'check', note: join(`${n.raw} × ${ctx.freq.periods} ${ctx.freq.label} pay dates`, baseNote) };
      }
      if (U.year.test(w) && !U.month.test(w)) return n.v >= 500 && n.v <= 60000 ? { value: n.v, raw: n.raw, confidence: conf, note: baseNote } : null;
      if (U.month.test(w) || U.pepm.test(w) || (n.v >= 80 && n.v <= 3500)) {
        if (n.v < 50 || n.v > 5000) return null;
        const explicit = U.month.test(w) || U.pepm.test(w);
        return { value: round(n.v * 12, 2), raw: n.raw, confidence: explicit && employerish ? 'found' : 'check', note: join(`${n.raw} a month × 12`, explicit ? '' : 'unit not stated — assumed monthly', baseNote) };
      }
      if (n.v >= 1000 && n.v <= 60000) return { value: n.v, raw: n.raw, confidence: 'check', note: join('unit not stated — assumed annual', baseNote) };
      return null;
    },
    epli(s, ctx) {
      const w = s.win;
      const n = firstNum(w, x => x.v > 0);
      if (U.zero.test(w) && (!n || /\binclud/i.test(w))) return { value: 0, raw: (w.match(U.zero) || ['included'])[0], confidence: 'found', note: 'stated as included / no separate charge' };
      if (!n) return null;
      if (n.pct) {
        if (!ctx.payroll || !ctx.employees) return { value: null, raw: n.raw, confidence: 'check', note: `${n.raw} of payroll — payroll and headcount needed` };
        return { value: round(ctx.payroll * n.v / 100 / ctx.employees / 12, 2), raw: n.raw, confidence: 'check', note: `${n.raw} × payroll ÷ ${ctx.employees} ÷ 12` };
      }
      if (U.pepm.test(w) || (U.month.test(w) && U.perEmp.test(w))) return { value: n.v, raw: n.raw, confidence: 'found' };
      if (U.pepy.test(w)) return { value: round(n.v / 12, 2), raw: n.raw, confidence: 'check', note: `${n.raw} per employee per year ÷ 12` };
      if (U.year.test(w) || n.v >= 200) {
        if (!ctx.employees) return { value: null, raw: n.raw, confidence: 'check', note: `${n.raw} a year for the group — headcount needed` };
        const annual = U.month.test(w) ? n.v * 12 : n.v;
        return { value: round(annual / ctx.employees / 12, 2), raw: n.raw, confidence: 'check', note: `${money(annual)} a year ÷ ${ctx.employees} ÷ 12` };
      }
      if (n.v <= 50) return { value: n.v, raw: n.raw, confidence: 'check', note: 'unit not stated — assumed per employee per month' };
      return null;
    },
    other(s, ctx) {
      // returns an annual $ amount for ONE add-on line; summed by extractQuote
      const w = s.win;
      const n = firstNum(w, x => !x.pct && x.v > 0);
      if (!n) {
        if (/\b(?:no|none|without)\b/i.test(s.line) && /\b(?:additional|other|hidden|extra)\b/i.test(s.line)) return { value: 0, raw: 'none', confidence: 'found', note: 'quote states no other fees', zeroAll: true };
        if (U.zero.test(w)) return { value: 0, raw: (w.match(U.zero) || ['included'])[0], confidence: 'found', note: `${clean(s.label)}: included` };
        return null;
      }
      if (/\bone[\s-]?time\b/i.test(w)) return null;
      const lbl = clean(s.label);
      if (U.pepm.test(w) || (U.month.test(w) && U.perEmp.test(w))) {
        if (!ctx.employees) return { value: null, raw: n.raw, confidence: 'check', note: `${lbl} ${n.raw} PEPM — headcount needed` };
        return { value: round(n.v * ctx.employees * 12, 2), raw: n.raw, confidence: 'check', note: `${lbl}: ${n.raw} × ${ctx.employees} × 12` };
      }
      if (U.pepy.test(w) || (U.year.test(w) && U.perEmp.test(w))) {
        if (!ctx.employees) return { value: null, raw: n.raw, confidence: 'check', note: `${lbl} ${n.raw} per employee — headcount needed` };
        return { value: round(n.v * ctx.employees, 2), raw: n.raw, confidence: 'check', note: `${lbl}: ${n.raw} × ${ctx.employees}` };
      }
      if (U.perCheck.test(w)) {
        if (!ctx.freq || !ctx.employees) return { value: null, raw: n.raw, confidence: 'check', note: `${lbl} ${n.raw} per check — pay frequency/headcount needed` };
        return { value: round(n.v * ctx.freq.periods * ctx.employees, 2), raw: n.raw, confidence: 'check', note: `${lbl}: ${n.raw} × ${ctx.freq.periods} pay dates × ${ctx.employees}` };
      }
      if (U.month.test(w)) return { value: round(n.v * 12, 2), raw: n.raw, confidence: 'check', note: `${lbl}: ${n.raw} × 12` };
      if (U.year.test(w)) return { value: n.v, raw: n.raw, confidence: 'check', note: `${lbl}: ${n.raw} a year` };
      return { value: null, raw: n.raw, confidence: 'check', note: `${lbl} ${n.raw} — billing unit not stated` };
    }
  };

  const PROVIDERS = ['ADP TotalSource', 'Insperity', 'TriNet', 'Justworks', 'Paychex', 'Rippling', 'Oasis', 'Vensure', 'Engage PEO', 'G&A Partners',
    'XcelHR', 'Sequoia One', 'Extensis', 'Asure', 'Aldrich', 'CoAdvantage', 'Employer Solutions Group', 'Questco', 'Infiniti HR', 'PrestigePEO',
    'Prestige PEO', 'FrankCrum', 'Frank Crum', 'Decision HR', 'Alcott HR', 'Tilson', 'ExtensisHR', 'BBSI', 'Barrett Business Services',
    'Emplicity', 'Gusto', 'Deel', 'Paylocity', 'Paycor'];
  function providerName(text, filename) {
    let best = null, count = 0, first = Infinity;
    for (const p of PROVIDERS) {
      const re = new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, m => '\\' + m) + '\\b', 'gi');
      const hits = [...text.matchAll(re)];
      if (!hits.length) continue;
      if (hits.length > count || (hits.length === count && hits[0].index < first)) { best = p; count = hits.length; first = hits[0].index; }
    }
    if (best) return { value: best, evidence: `named ${count}× in the file`, confidence: 'found' };
    const stem = String(filename || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\b(?:proposal|quote|pricing|final|draft|v\d+|copy|scan|pdf)\b/gi, ' ').replace(/\s{2,}/g, ' ').trim();
    return stem ? { value: stem.slice(0, 60), evidence: 'from the file name', confidence: 'check' } : null;
  }

  /* ------------------------------------------------------------------ main extractor */
  function extractQuote(rawText, opts = {}) {
    const lines = String(rawText || '').split(/\r?\n/).map(clean).filter(Boolean);
    const text = lines.join('\n');
    const result = { fields: {}, candidates: {}, common: {}, warnings: [], stats: { chars: text.length, lines: lines.length } };
    if (text.replace(/[^A-Za-z0-9]/g, '').length < 40) { result.outcome = 'no_text'; return result; }

    const common = commonFacts(lines, text);
    const ctx = { employees: common.employees?.value ?? opts.employees ?? null, payroll: common._payroll ?? null, enrolled: common._enrolled ?? null, freq: payFrequency(text) };
    if (!ctx.payroll && ctx.employees && common.wage) ctx.payroll = ctx.employees * common.wage.value;
    if (!ctx.enrolled && ctx.employees && common.enrollment) ctx.enrolled = Math.round(ctx.employees * common.enrollment.value / 100);
    for (const k of ['employees', 'wage', 'enrollment', 'sutaBase']) if (common[k]) result.common[k] = common[k];

    const segs = segments(lines);
    const cands = Object.fromEntries(FIELD_KEYS.map(k => [k, []]));
    for (const s of segs) {
      if (s.key === 'noise' || !R[s.key]) continue;
      const c = R[s.key](s, ctx);
      if (!c) continue;
      c.evidence = snippet(s.borrowed ? s.line + ' ' + s.win : s.line);
      c.blended = /\b(?:blended|composite|overall|weighted|average)\b/i.test(s.line);
      cands[s.key].push(c);
    }

    // Workers' comp class-code rows ("Class 8810 Clerical | $0.14 per $100 | payroll $1,800,000") rarely repeat the label.
    const classRows = [];
    for (const line of lines) {
      const cm = line.match(/\b(?:class(?: code)?|code)\s*#?\s*(\d{4})\b/i) || line.match(/^\s*(\d{4})\b/);
      if (!cm || !U.per100.test(line)) continue;
      const rate = numbers(line.replace(U.per100, ' ')).filter(n => !isClassCode(n) && !isYear(n)).find(n => !(n.dollar && n.v >= 1000) && n.v > 0 && n.v <= 60);
      if (!rate) continue;
      const pay = numbers(line).filter(n => n.v >= 10000 && n !== rate).map(n => n.v)[0] || null;
      classRows.push({ code: cm[1], rate: rate.v, raw: rate.raw, payroll: pay, line });
    }
    const codes = new Set(classRows.map(r => r.code));
    if (codes.size > 1) {
      cands.wc = cands.wc.filter(c => !classRows.some(r => r.rate === c.value) || c.blended);
      if (classRows.every(r => r.payroll)) {
        const tp = classRows.reduce((a, r) => a + r.payroll, 0);
        cands.wc.push({ value: round(classRows.reduce((a, r) => a + r.rate * r.payroll, 0) / tp, 4), confidence: 'check', blended: !cands.wc.some(c => c.blended),
          evidence: snippet(classRows.map(r => r.code + ' @ ' + r.raw).join(' · '), 160), note: 'payroll-weighted across ' + codes.size + ' class codes' });
      } else for (const r of classRows) cands.wc.push({ value: r.rate, raw: r.raw, confidence: 'check', evidence: snippet(r.line), note: 'class ' + r.code + ' only' });
    } else if (classRows.length === 1 && !cands.wc.length) cands.wc.push({ value: classRows[0].rate, raw: classRows[0].raw, confidence: 'found', evidence: snippet(classRows[0].line), note: 'class ' + classRows[0].code });

    // de-duplicate identical values (same figure repeated in a summary table)
    for (const k of FIELD_KEYS) {
      const seen = new Map();
      for (const c of cands[k]) { const key = (c.basis || '') + '|' + c.value; if (!seen.has(key)) seen.set(key, c); }
      cands[k] = [...seen.values()];
    }

    const choose = (k, list) => {
      const usable = list.filter(c => c.value !== null && c.value !== undefined);
      if (!usable.length) return null;
      const blended = usable.filter(c => c.blended);
      if (blended.length === 1) return blended[0];
      const found = usable.filter(c => c.confidence === 'found');
      const distinct = new Set(usable.map(c => (c.basis || '') + c.value));
      if (distinct.size === 1) return usable[0];
      if (found.length && new Set(found.map(c => (c.basis || '') + c.value)).size === 1) return { ...found[0], confidence: 'check', note: [found[0].note, `${distinct.size} different figures in the file — this is the one stated with a unit`].filter(Boolean).join('; ') };
      return null;  // genuinely ambiguous: offer the candidates, fill nothing
    };

    for (const k of ['fee', 'setup', 'suta', 'wc', 'health', 'epli']) {
      const pick = choose(k, cands[k]);
      if (pick) result.fields[k] = pick;
      const alts = cands[k].filter(c => c !== pick && c.value !== null);
      if (alts.length) result.candidates[k] = alts.slice(0, 4);
      const unresolved = cands[k].filter(c => c.value === null);
      if (!pick && unresolved.length) result.candidates[k] = [...(result.candidates[k] || []), ...unresolved.slice(0, 2)];
    }
    if (result.fields.fee) result.fields.feeBasis = { value: result.fields.fee.basis, evidence: result.fields.fee.evidence, confidence: result.fields.fee.confidence };

    // WC: several class-code rates and no blended rate -> refuse to average
    const wcDistinct = new Set(cands.wc.filter(c => c.value !== null).map(c => c.value));
    if (!result.fields.wc && wcDistinct.size > 1) result.warnings.push({ field: 'wc', text: `${wcDistinct.size} different workers' comp rates (likely several class codes). Enter a payroll-weighted rate; a simple average is wrong.` });

    // Other = sum of add-on lines, only when every add-on found has a usable annual amount
    const other = cands.other;
    if (other.length) {
      const zeroAll = other.find(c => c.zeroAll);
      const priced = other.filter(c => !c.zeroAll);
      if (priced.some(c => c.value === null)) {
        result.candidates.other = priced.filter(c => c.value !== null).slice(0, 4);
        result.warnings.push({ field: 'other', text: 'Add-on fees found but at least one has no usable unit: ' + priced.filter(c => c.value === null).map(c => c.note).join('; ') });
      } else if (priced.length) {
        const sum = round(priced.reduce((a, c) => a + c.value, 0), 2);
        result.fields.other = { value: sum, confidence: 'check', evidence: priced.map(c => c.evidence).join(' · ').slice(0, 220), note: priced.map(c => c.note).join(' + ') };
      } else if (zeroAll) result.fields.other = { value: 0, confidence: 'found', evidence: zeroAll.evidence, note: zeroAll.note };
    }

    const prov = providerName(text, opts.filename);
    if (prov) result.fields.provider = prov;

    // Bundled pricing: one rate covering fee + taxes and/or WC. Itemized fields would double count.
    const bundled = lines.find(l => /\b(?:bundled|all[\s-]inclusive|inclusive (?:rate|pricing)|includes? (?:all )?(?:employer )?(?:payroll )?taxes|inclusive of (?:employer |payroll )?taxes|includes? workers'? comp|one rate covers)\b/i.test(l));
    if (bundled) {
      result.bundled = true;
      result.warnings.unshift({ field: 'fee', text: 'This looks like bundled pricing (one rate that includes taxes and/or workers\' comp): "' + snippet(bundled, 90) + '". Ask the PEO for an itemized breakdown; entering the bundled rate as the admin fee and SUTA/WC again would double count.' });
      if (result.fields.fee && result.fields.fee.basis === 'pct') {
        result.candidates.fee = [result.fields.fee, ...(result.candidates.fee || [])];
        delete result.fields.fee; delete result.fields.feeBasis;
      }
    }
    if (result.fields.health && result.fields.health.confidence === 'check' && /\bemployee only|ee only|single\b/i.test(text) && !/\bemployer\b/i.test(result.fields.health.evidence))
      result.warnings.push({ field: 'health', text: 'Health figure may be a total premium, not the employer share. Use what the employer pays per enrollee per year.' });

    // Employer contribution % × employee-only premium, when the quote states both
    if (!result.fields.health) {
      const pctLine = lines.find(l => /\bemployer\b[^%\n]{0,40}\b(?:contribut\w*|pays?|covers?)\b[^%\n]{0,30}?(\d{1,3}(?:\.\d+)?)\s?%/i.test(l));
      const eeLine = lines.find(l => /\b(?:employee only|ee only|single(?: coverage)?)\b[^$\d]{0,30}\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/i.test(l));
      if (pctLine && eeLine) {
        const p = Number(pctLine.match(/(\d{1,3}(?:\.\d+)?)\s?%/)[1]);
        const prem = Number(eeLine.match(/\b(?:employee only|ee only|single(?: coverage)?)\b[^$\d]{0,30}\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/i)[1].replace(/,/g, ''));
        const monthly = prem < 5000 && !/\bannual|per year\b/i.test(eeLine);
        if (p > 0 && p <= 100 && prem > 0) result.fields.health = { value: Math.round(p / 100 * prem * (monthly ? 12 : 1)), confidence: 'check', evidence: snippet(pctLine + ' · ' + eeLine, 160), note: `${p}% employer share × ${money(prem)} employee-only premium${monthly ? ' × 12' : ''} (assumes everyone takes employee-only; family tiers cost more)` };
      }
    }

    const got = FIELD_KEYS.filter(k => result.fields[k]).length;
    result.found = got;
    result.outcome = got === 0 ? 'none_found' : got === FIELD_KEYS.length ? 'complete' : 'partial';
    return result;
  }

  /* ------------------------------------------------------------------ file readers */
  const MAX_BYTES = 15 * 1024 * 1024;

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  async function unzip(buf) {
    const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not_zip');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = new Map(), dec = new TextDecoder();
    for (let k = 0; k < count && p + 46 <= b.length; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      files.set(name, { method, csize, off });
      p += 46 + nlen + xlen + clen;
    }
    return async name => {
      const f = files.get(name); if (!f) return null;
      const lnl = dv.getUint16(f.off + 26, true), lxl = dv.getUint16(f.off + 28, true);
      const start = f.off + 30 + lnl + lxl, data = b.subarray(start, start + f.csize);
      if (f.method === 0) return dec.decode(data);
      if (f.method === 8) return dec.decode(await inflateRaw(data));
      throw new Error('zip_method');
    };
  }
  const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');

  async function readXlsx(buf) {
    const get = await unzip(buf);
    const ss = [];
    const sst = await get('xl/sharedStrings.xml');
    if (sst) for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) || []) ss.push(xmlText((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join('')));
    // percent-formatted cells hold fractions (0.027 shown as 2.7%) — map style index -> isPercent
    const pctStyle = [];
    const styles = await get('xl/styles.xml');
    if (styles) {
      const custom = {};
      for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom[m[1]] = m[2];
      const xfs = (styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
      for (const m of xfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
        const id = (m[0].match(/numFmtId="(\d+)"/) || [0, '0'])[1];
        pctStyle.push(id === '9' || id === '10' || /%/.test(custom[id] || ''));
      }
    }
    const wb = await get('xl/workbook.xml') || '';
    const rels = await get('xl/_rels/workbook.xml.rels') || '';
    const sheets = [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)].map(m => {
      const t = (rels.match(new RegExp('Id="' + m[2] + '"[^>]*Target="([^"]+)"')) || rels.match(new RegExp('Target="([^"]+)"[^>]*Id="' + m[2] + '"')) || [])[1];
      return { name: xmlText(m[1]), path: t ? 'xl/' + t.replace(/^\/?xl\//, '').replace(/^\//, '') : null };
    });
    const out = [];
    for (const sh of sheets.slice(0, 12)) {
      const xml = sh.path && await get(sh.path); if (!xml) continue;
      out.push('[' + sh.name + ']');
      for (const r of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
        const cells = [];
        for (const c of r.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
          const t = (c.match(/\bt="(\w+)"/) || [])[1], s = Number((c.match(/\bs="(\d+)"/) || [0, 0])[1]);
          const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          let val = '';
          if (t === 's') val = ss[Number(v)] ?? '';
          else if (t === 'inlineStr') val = xmlText((c.match(/<is>[\s\S]*?<\/is>/) || [''])[0]);
          else if (t === 'str' || t === 'e') val = v ? xmlText(v) : '';
          else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
          else if (v !== undefined) { const n = Number(v); val = pctStyle[s] && Number.isFinite(n) ? round(n * 100, 6) + '%' : String(Number.isFinite(n) ? round(n, 6) : v); }
          if (val !== '') cells.push(val);
        }
        if (cells.length) out.push(cells.join(' | '));
      }
    }
    return out.join('\n');
  }
  async function readDocx(buf) {
    const get = await unzip(buf);
    const xml = await get('word/document.xml'); if (!xml) throw new Error('not_docx');
    const body = xml.replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, '\n');
    const out = [];
    // tables: one line per row, cells joined with " | "; paragraphs elsewhere
    const parts = body.split(/(<w:tbl>[\s\S]*?<\/w:tbl>)/);
    for (const part of parts) {
      if (part.startsWith('<w:tbl>')) {
        for (const tr of part.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [])
          out.push((tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(tc => (tc.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).map(p => xmlText((p.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).join(''))).join(' ')).filter(Boolean).join(' | '));
      } else for (const p of part.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []) out.push(xmlText((p.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).join('')));
    }
    return out.filter(Boolean).join('\n');
  }
  function csvToText(s, delim) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
      if (ch === '"') q = true; else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.map(r => r.map(c => c.trim()).filter(Boolean).join(' | ')).filter(Boolean).join('\n');
  }

  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
  const PDFJS_SRI = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';
  let pdfjsPromise = null;
  function loadPdfjs() {
    if (G.pdfjsLib) return Promise.resolve(G.pdfjsLib);
    if (!pdfjsPromise) pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js'; s.integrity = PDFJS_SRI; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = () => { if (!G.pdfjsLib) return reject(new Error('pdf_unavailable')); G.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; resolve(G.pdfjsLib); };
      s.onerror = () => { pdfjsPromise = null; reject(new Error('pdf_unavailable')); };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }
  async function readPdf(buf) {
    const lib = await loadPdfjs();
    // isEvalSupported:false closes CVE-2024-4367 on this pdf.js line; we only read text, never render.
    const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
    const out = [];
    for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      // rebuild visual lines: group by baseline (y), order by x, mark wide gaps as table cell breaks
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
        let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, h * 0.4));
        if (!row) { row = { y, h, items: [] }; rows.push(row); }
        row.items.push({ x, w: it.width || 0, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        let line = '', end = null;
        for (const it of r.items) {
          if (end !== null) { const gap = it.x - end; line += gap > r.h * 1.6 ? ' | ' : gap > r.h * 0.15 ? ' ' : ''; }
          line += it.s; end = it.x + it.w;
        }
        out.push(line);
      }
      out.push('');
    }
    await doc.destroy();
    return out.join('\n');
  }

  async function readQuoteFile(file) {
    const name = String(file.name || ''), ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
    if (file.size > MAX_BYTES) return { error: 'too_large', kind: ext };
    if (/^(?:png|jpe?g|gif|heic|webp|tiff?|bmp)$/.test(ext) || /^image\//.test(file.type)) return { error: 'image', kind: ext };
    if (ext === 'xls' || ext === 'doc') return { error: 'legacy_office', kind: ext };
    const buf = await file.arrayBuffer();
    try {
      if (ext === 'pdf' || file.type === 'application/pdf') return { text: await readPdf(buf), kind: 'pdf' };
      if (ext === 'xlsx' || ext === 'xlsm') return { text: await readXlsx(buf), kind: 'xlsx' };
      if (ext === 'docx') return { text: await readDocx(buf), kind: 'docx' };
      const txt = new TextDecoder().decode(buf);
      if (ext === 'csv') return { text: csvToText(txt, ','), kind: 'csv' };
      if (ext === 'tsv') return { text: csvToText(txt, '\t'), kind: 'csv' };
      if (ext === 'txt' || ext === 'md' || /^text\//.test(file.type)) return { text: txt, kind: 'txt' };
      return { error: 'unsupported', kind: ext };
    } catch (e) {
      return { error: e && e.message === 'pdf_unavailable' ? 'pdf_unavailable' : 'unreadable', kind: ext };
    }
  }

  G.PEOQuoteParse = { extractQuote, readQuoteFile, _internals: { numbers, readXlsx, readDocx, csvToText, unzip, segments } };
})();
