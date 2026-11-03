// Maryland FAMLI calculator model (assets/js/famli-calc.js) against hand-derived figures.
// Run: node tests/test_famli.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/dmv-index-2026.json'), 'utf8'));
const ctx = { window: {}, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/famli-calc.js'), 'utf8'), ctx);
const { compute, parseWages } = ctx.window.PEOFamli;

let pass = 0, fail = 0;
const near = (a, b, m) => { if (Math.abs(a - b) < 0.005) pass++; else { fail++; console.log('FAIL', m, a, '!=', b); } };
const eq = (a, b, m) => { if (a === b) pass++; else { fail++; console.log('FAIL', m, a, '!==', b); } };
const run = (total, wages, cover = 0, periods = 26) => compute({ totalEmployees: total, wages, coverShare: cover, payPeriods: periods }, D);
const fill = (n, w) => Array.from({ length: n }, () => w);

// 20 x $60,000, withhold everything: 0.45% each side.
let r = run(20, fill(20, 60000));
near(r.employerCost, 5400, 'employer cost'); near(r.withheld, 5400, 'withheld');
near(r.remitted, 10800, 'remitted'); near(r.quarterly, 2700, 'quarterly');
near(r.employerCostPerEmployee, 270, 'per employee'); near(r.withheldPerPaycheck, 270 / 26, 'per paycheck');
// Employer pays the whole employee half: cost doubles, nothing withheld, remittance unchanged.
r = run(20, fill(20, 60000), 1);
near(r.employerCost, 10800, 'cover all: employer'); near(r.withheld, 0, 'cover all: withheld'); near(r.remitted, 10800, 'cover all: remitted');
r = run(20, fill(20, 60000), 0.5);
near(r.employerCost, 8100, 'cover half: employer'); near(r.withheld, 2700, 'cover half: withheld');
// Under 15: no employer share, employee share still remitted.
r = run(14, fill(14, 60000));
eq(r.small, true, '14 is small'); near(r.employerCost, 0, 'small: employer'); near(r.remitted, 0.0045 * 60000 * 14, 'small: remitted');
eq(run(15, fill(15, 60000)).small, false, '15 is not small');
// Headcount counts employees outside Maryland: 5 in MD of 30 total owes the employer share.
r = run(30, fill(5, 60000));
near(r.employerCost, 0.0045 * 60000 * 5, 'out-of-state staff count toward 15');
// Total below the Maryland count is raised to it.
eq(run(3, fill(20, 60000)).total, 20, 'total raised to MD headcount');
// Wage cap per person.
r = run(20, [250000, 50000]);
near(r.capped, 192300 + 50000, 'capped wages'); eq(r.overCap, 1, 'one over cap');
near(r.employerShare, 0.0045 * (192300 + 50000), 'capped employer share');
// No Maryland employees.
r = run(20, []);
near(r.remitted, 0, 'no MD staff'); near(r.employerCostPerEmployee, 0, 'no MD staff per-ee');
// Wage paste parsing: commas are thousands separators, not list separators.
let p = parseWages('48,500\n$62,000\n210000\n\nn/a\t75000.50;30000');
eq(p.wages.length, 5, 'parsed count'); eq(p.ignored, 1, 'ignored count');
near(p.wages[0], 48500, 'comma thousands'); near(p.wages[1], 62000, 'dollar sign'); near(p.wages[3], 75000.5, 'tab + decimals');

console.log(`famli model: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
