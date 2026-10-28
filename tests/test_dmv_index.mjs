// DMV index calculator model (assets/js/dmv-cost-index.js) against hand-derived figures.
// Run: node tests/test_dmv_index.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rates-2026.json'), 'utf8'));
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/dmv-index-2026.json'), 'utf8'));
const ctx = { window: {}, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/dmv-cost-index.js'), 'utf8'), ctx);
const { compute } = ctx.window.PEODmv;

let pass = 0, fail = 0;
const near = (a, b, m) => { if (Math.abs(a - b) < 0.005) pass++; else { fail++; console.log('FAIL', m, a, '!=', b); } };

// $60,000, 20 employees, 2026: FICA 4,590 + FUTA 42 in every jurisdiction.
near(compute('DC', 60000, 2026, 20, R, D).total, 4632 + 0.029 * 9000 + 0.0075 * 60000, 'DC 2026');
near(compute('MD', 60000, 2026, 20, R, D).total, 4632 + 0.026 * 8500, 'MD 2026');
near(compute('VA', 60000, 2026, 20, R, D).total, 4632 + 0.0273 * 8000, 'VA 2026');
// 2027: FAMLI employer share only at 15+ employees.
near(compute('MD', 60000, 2027, 20, R, D).famli, 270, 'MD 2027 FAMLI at 20 employees');
near(compute('MD', 60000, 2027, 14, R, D).famli, 0, 'MD 2027 FAMLI under 15 employees');
// Social Security base switches in 2027.
near(compute('VA', 200000, 2026, 20, R, D).ss, 0.062 * 184500, 'SS capped 2026');
near(compute('VA', 200000, 2027, 20, R, D).ss, 0.062 * 192300, 'SS capped 2027');
near(compute('MD', 200000, 2027, 20, R, D).famli, 0.0045 * 192300, 'FAMLI capped at SS base');
// DC paid leave has no wage cap.
near(compute('DC', 200000, 2026, 20, R, D).pfl, 1500, 'DC PFL uncapped');
near(compute('DC', 0, 2026, 20, R, D).total, 0, 'zero wage');

console.log(`dmv-index model: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
