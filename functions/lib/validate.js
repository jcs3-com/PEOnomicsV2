/* Shared validation for PEOnomics Pages Functions.
   Used by /api/enrich and /api/report-request so business-email and SSRF rules
   can never drift apart. Pure functions — unit tested. */

/* Personal / consumer mailbox providers. Exact-domain match. */
export const PERSONAL_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com',
  'hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com','passport.com',
  'aol.com','aim.com','icloud.com','me.com','mac.com','mail.com','email.com','usa.com',
  'proton.me','protonmail.com','pm.me','gmx.com','gmx.net','zoho.com','zohomail.com',
  'yandex.com','yandex.ru','tutanota.com','tuta.io','fastmail.com','hey.com',
  'comcast.net','verizon.net','att.net','sbcglobal.net','bellsouth.net','cox.net',
  'charter.net','earthlink.net','optonline.net','frontier.com','windstream.net',
  'juno.com','netzero.net','mailinator.com','duck.com','qq.com','163.com'
]);

/* Suffixes that are never public company websites, or that resolve to
   caller-chosen IPs (wildcard-DNS services) — classic SSRF vectors. */
const BLOCKED_SUFFIXES = [
  'localhost','local','localdomain','internal','intranet','lan','home','corp','private',
  'test','example','invalid','arpa','onion','alt','home.arpa',
  'nip.io','sslip.io','xip.io','localtest.me','lvh.me','traefik.me','readme.localhost',
  'workers.dev','pages.dev' /* no reason to research Cloudflare dev hosts */
];

/** Returns a normalized public hostname or null. Pure function — unit tested. */
export function validateDomain(input) {
  const d = String(input || '').trim().toLowerCase().replace(/\.$/, '');
  if (d.length < 4 || d.length > 253) return null;
  const labels = d.split('.');
  if (labels.length < 2) return null;
  for (const l of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return null;
  }
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) return null;      // no numeric TLD => no IPv4 literal
  if (/(?:^|[.-])\d{1,3}[.-]\d{1,3}[.-]\d{1,3}[.-]\d{1,3}(?:[.-]|$)/.test(d)) return null; // embedded IPv4 (1-2-3-4.host)
  if (/(?:^|\.)0x[0-9a-f]+(?:\.|$)/.test(d)) return null;                     // hex host labels
  for (const s of BLOCKED_SUFFIXES) {
    if (d === s || d.endsWith('.' + s)) return null;
  }
  return d;
}

/** Returns {email, domain} for a business address, or null. Unit tested. */
export function parseBusinessEmail(input) {
  const email = String(input || '').trim().toLowerCase();
  if (email.length > 254) return null;
  const m = email.match(/^([a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})@([^@\s]+)$/);
  if (!m) return null;
  const domain = validateDomain(m[2]);
  if (!domain || PERSONAL_DOMAINS.has(domain)) return null;
  return { email, domain };
}

/** True for addresses a public company website must never resolve to. */
export function isPrivateAddress(ip) {
  const s = String(ip).toLowerCase();
  if (s.includes(':')) {                              // IPv6
    if (s === '::' || s === '::1') return true;
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return true;    // ULA, link-local
    if (/^ff/.test(s)) return true;                               // multicast
    if (/^::ffff:/.test(s)) return isPrivateAddress(s.slice(7));  // v4-mapped
    if (/^(64:ff9b|2001:db8|2001:0db8|100::)/.test(s)) return true;
    return false;
  }
  const p = s.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||             // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || (a === 203 && b === 0);
}

