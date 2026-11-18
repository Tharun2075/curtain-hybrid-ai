// Curtain masker: the deterministic regex floor.
// It always runs, with or without an on-device model. On-device findings
// (from the ONLY_ON_DEVICE model) are merged in through `mask(text, extra)`.
// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.

import { SHOP_TERMS } from './fixtures';

export type Kind =
  | 'NAME'
  | 'PHONE'
  | 'EMAIL'
  | 'ADDRESS'
  | 'POSTCODE'
  | 'ORDER'
  | 'ACCOUNT'
  | 'CARD'
  | 'LINK';

export const KINDS: Kind[] = ['NAME', 'PHONE', 'EMAIL', 'ADDRESS', 'POSTCODE', 'ORDER', 'ACCOUNT', 'CARD', 'LINK'];

export interface Finding {
  kind: Kind;
  value: string;
  start: number;
  end: number;
  source: 'regex' | 'on-device';
}

/** placeholder -> original value. Lives only in the browser (IndexedDB). */
export type KeyMap = Record<string, string>;

export interface MaskResult {
  masked: string;
  map: KeyMap;
  findings: Finding[];
}

const PLACEHOLDER_RE = /\[(NAME|PHONE|EMAIL|ADDRESS|POSTCODE|ORDER|ACCOUNT|CARD|LINK)_(\d+)(?:_FIRST)?\]/g;

// ---------- detectors ----------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// UPI ids and other handles with no TLD ("grace.ok@okbank", "98480@ybl"). Emails win on overlap.
const HANDLE_RE = /(?<![\w.@-])[A-Za-z0-9][\w.-]{1,}@[A-Za-z][A-Za-z0-9]{1,}\b(?![.@-]?[A-Za-z0-9])/g;
// IBAN-like ids: 2 letters, 2 check digits, then 3-8 groups (spaces optional).
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g;
// Links can carry ids, names or tracking tokens; they never go out as written.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"']+[^\s<>()"'.,;:!?]/gi;
// Partial card numbers ("card ending 4417", "ending in 4417").
const CARD_LAST4_RE = /\bending(?:\s+in)?\s+(\d{4})\b/gi;

// Order / ticket / invoice style references. Group 1 is the reference itself.
const ORDER_LABEL_RE =
  /\b(?:order|invoice|ticket|booking|tracking|reference|ref|awb|case|return|rma|parcel|consignment)\s*(?:no\.?|number|num|#|id)?\s*[:#]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,})\b/gi;
const ORDER_CODE_RE = /\b(?:ORD|INV|TKT|REF|BK|RMA|AWB|CS|SO|PO)[-_]?\d{3,}[A-Z0-9-]*\b/g;
const HASH_NUM_RE = /#\d{4,}\b/g;

// Account / customer / UPI identifiers. Group 1 is the identifier.
const ACCOUNT_RE =
  /\b(?:account|acct|a\/c|customer\s+id|member(?:ship)?\s+(?:id|no\.?|number)|loyalty\s+(?:id|no\.?|number)|upi(?:\s+id)?|iban)\s*(?:no\.?|number|#|id)?\s*[:#]?\s*(?:is\s+|=\s*)?((?=[A-Za-z0-9@._-]*[\d@])[A-Za-z0-9@._-]{4,})/gi;

const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

// Phone candidates; filtered by digit count afterwards.
const DATE_LIKE_RE = /^(?:(?:19|20)\d\d[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d\d)(?!\d)/;
const PHONE_CANDIDATE_RE = /(?<![\w-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,5}\)[\s.-]?)?\d{2,5}(?:[ .-]?\d{1,5}){1,4}(?![\d-])/g;

const STREET_SUFFIX =
  '(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Close|Way|Nagar|Colony|Layout|Marg|Boulevard|Blvd|Court|Ct|Place|Pl|Crescent|Terrace|Gardens|Park|Main Road|Cross|Square|Sq|Row|Hill|Mews|Grove|Street East|Street West)';
const UK_POSTCODE = '[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}';
const ADDRESS_RE = new RegExp(
  '(?:(?:Flat|Apt|Apartment|Unit|House|Door|Plot|Suite)\\s*(?:No\\.?\\s*)?[\\w/-]+,?\\s+)?' +
    '\\b\\d{1,5}[A-Za-z]?(?:[/-]\\d{1,4})?,?\\s+' +
    "(?:[A-Z][A-Za-z']+\\.?\\s+){1,4}" +
    STREET_SUFFIX +
    '\\b\\.?' +
    "(?:,\\s*[A-Z][A-Za-z']+(?:\\s[A-Z][A-Za-z']+){0,2}){0,3}" +
    '(?:,?\\s*(?:\\d{3}\\s?\\d{3}|' + UK_POSTCODE + '|[A-Z]{2}\\s\\d{5}(?:-\\d{4})?))?',
  'g',
);
const POSTCODE_RE = new RegExp('\\b' + UK_POSTCODE + '\\b', 'g');
const PIN_LABEL_RE = /\b(?:pin(?:\s*code)?|pincode|postcode|zip(?:\s*code)?)\s*[:#]?\s*(\d{3}\s?\d{3}|\d{5}(?:-\d{4})?)/gi;

const NAME_WORD = "[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?";
const FULL_NAME = `${NAME_WORD}(?:[ \\t]+${NAME_WORD}){0,2}`;
const HONORIFIC = '(?:Mr|Mrs|Ms|Miss|Mx|Dr|Shri|Smt|Sri)';
const NAME_CONTEXT_RES: RegExp[] = [
  new RegExp(`\\b${HONORIFIC}\\.?[ \\t]+(${FULL_NAME})`, 'g'),
  new RegExp(`\\b(?:Hi|Hello|Dear|Hey|Hiya)[ \\t]+(${FULL_NAME})`, 'g'),
  new RegExp(`\\b(?:[Mm]y name is|[Tt]his is|[Ii] am|I'm|[Ss]peaking with|[Ss]poke (?:to|with))\\s+(${FULL_NAME})`, 'g'),
  new RegExp(
    `\\b(?:Thanks|Thank you|Regards|Best|Cheers|Sincerely|Warm regards|Kind regards|Best regards|Many thanks|Thanks again)[,!.]?[ \\t]*\\r?\\n+[ \\t]*[-–]?[ \\t]*(${FULL_NAME})`,
    'g',
  ),
  new RegExp(`^(?:From|To|Cc)[ \\t]*:[ \\t]*(?:${HONORIFIC}\\.?[ \\t]+)?(${FULL_NAME})`, 'gm'),
  new RegExp(`\\b(?:Name|Customer|Contact|Recipient|Deliver to|Ship to|Account holder|Caller)[ \\t]*:[ \\t]*(${FULL_NAME})`, 'g'),
  new RegExp(`\\b(?:husband|wife|son|daughter|mother|father|neighbour|neighbor|partner|colleague)\\s+(${FULL_NAME})`, 'g'),
];

// Cue words written in lowercase inside NAME_CONTEXT_RES ("my name is", "spoke to", "wife").
const LOWER_CUES = new Set(['name', 'is', 'this', 'am', 'speaking', 'with', 'spoke', 'to', 'husband', 'wife', 'son', 'daughter', 'mother', 'father', 'neighbour', 'neighbor', 'partner', 'colleague']);

// Words that look like names after a greeting or "I am" but are not.
const NAME_STOP = new Set(
  [
    'team', 'support', 'sir', 'madam', 'there', 'all', 'everyone', 'customer', 'service', 'again', 'writing',
    'sorry', 'not', 'still', 'very', 'so', 'just', 'really', 'trying', 'going', 'happy', 'unhappy', 'afraid',
    'the', 'a', 'an', 'and', 'or', 'please', 'thanks', 'thank', 'regards', 'order', 'invoice', 'today',
    'tomorrow', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
    'november', 'december', 'subject', 're', 'fw', 'fwd', 'hello', 'hi', 'dear', 'best', 'kind', 'warm',
    'waiting', 'calling', 'emailing', 'following', 'checking', 'looking', 'contacting', 'disappointed',
    'concerned', 'confused', 'sure', 'glad', 'pleased', 'new', 'manager', 'owner', 'admin', 'folks',
    'guys', 'friends', 'shop', 'store', 'delivery', 'help', 'desk',
    // honorifics are titles, not names
    'from', 'sent', 'to', 'cc', 'date',
    'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'shri', 'smt', 'sri',
  ],
);

// A sender line ending in one of these is an organisation ("Loomhouse support"), not a person.
const ORG_TAIL = new Set(['support', 'team', 'desk', 'service', 'services', 'shop', 'store', 'help', 'helpdesk', 'admin', 'sales', 'billing', 'returns']);

// Shop and brand names the app knows about. They are never masked as names.
const KEEP = new Set<string>();
/** Register shop/brand words that must survive masking (e.g. the shop's own name). */
export function addKeepTerms(terms: string[]): void {
  for (const t of terms) for (const w of t.split(/[^A-Za-z']+/)) if (w.length >= 2) KEEP.add(w.toLowerCase());
}
const isKept = (w: string) => NAME_STOP.has(w.toLowerCase()) || KEEP.has(w.toLowerCase());
// The masker owns its keep-list: the shop's own words load with the masker, never through
// an import side effect elsewhere, so every caller of mask()/leakCheck keeps them.
addKeepTerms(SHOP_TERMS);

function luhnOk(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function* matches(re: RegExp, text: string, group = 0): Generator<{ value: string; start: number; end: number }> {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[group];
    if (value === undefined) continue;
    const start = group === 0 ? m.index : m.index + m[0].lastIndexOf(value);
    yield { value, start, end: start + value.length };
    if (m[0].length === 0) re.lastIndex++;
  }
}

function trimName(raw: string): string | null {
  const words = raw.split(/\s+/);
  if (words.length > 1 && ORG_TAIL.has(words[words.length - 1].toLowerCase())) return null;
  // drop trailing stop-words ("Priya Thanks") and leading ones
  while (words.length && isKept(words[words.length - 1])) words.pop();
  while (words.length && isKept(words[0])) words.shift();
  if (words.some((w) => KEEP.has(w.toLowerCase()))) return null;
  if (!words.length) return null;
  return words.join(' ');
}

/** Names found from context cues (greetings, sign-offs, honorifics, labels). */
export function detectNameStrings(text: string): string[] {
  const out = new Set<string>();
  for (const re of NAME_CONTEXT_RES) {
    for (const m of matches(re, text, 1)) {
      const n = trimName(m.value);
      if (n && n.length >= 2) out.add(n);
    }
  }
  // A full name also exposes its parts ("Thanks Grace", "Mr Raghavan").
  for (const n of [...out]) {
    const parts = n.split(' ');
    if (parts.length < 2) continue;
    for (const p of [parts[0], parts[parts.length - 1]]) if (p.length >= 3 && !isKept(p)) out.add(p);
  }
  return [...out];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every occurrence of `value` in `text` on word boundaries. */
function occurrences(text: string, value: string): { start: number; end: number }[] {
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])`, 'g');
  const out: { start: number; end: number }[] = [];
  for (const m of matches(re, text)) out.push({ start: m.start, end: m.end });
  return out;
}

function digitCount(s: string): number {
  return (s.match(/\d/g) || []).length;
}

/** All regex findings in `text`, overlapping allowed (resolved in `mask`). */
export function detect(text: string): Finding[] {
  const f: Finding[] = [];
  const add = (kind: Kind, value: string, start: number, end: number) => {
    const v = value.replace(/[\s,.;:]+$/, '');
    if (v.length) f.push({ kind, value: v, start, end: start + v.length, source: 'regex' });
  };

  for (const m of matches(EMAIL_RE, text)) add('EMAIL', m.value, m.start, m.end);
  for (const m of matches(HANDLE_RE, text)) add('ACCOUNT', m.value, m.start, m.end);
  for (const m of matches(IBAN_RE, text)) add('ACCOUNT', m.value, m.start, m.end);
  for (const m of matches(URL_RE, text)) add('LINK', m.value, m.start, m.end);
  for (const m of matches(CARD_LAST4_RE, text, 1)) add('CARD', m.value, m.start, m.end);
  for (const m of matches(ADDRESS_RE, text)) add('ADDRESS', m.value, m.start, m.end);
  for (const m of matches(ORDER_LABEL_RE, text, 1)) add('ORDER', m.value, m.start, m.end);
  for (const m of matches(ORDER_CODE_RE, text)) add('ORDER', m.value, m.start, m.end);
  for (const m of matches(HASH_NUM_RE, text)) add('ORDER', m.value.slice(1), m.start + 1, m.end);
  for (const m of matches(ACCOUNT_RE, text, 1)) add('ACCOUNT', m.value, m.start, m.end);
  for (const m of matches(CARD_CANDIDATE_RE, text)) {
    const d = m.value.replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhnOk(d)) add('CARD', m.value, m.start, m.end);
  }
  for (const m of matches(PHONE_CANDIDATE_RE, text)) {
    const n = digitCount(m.value);
    const plus = m.value.trim().startsWith('+');
    // Dates and timestamps ("2026-11-16 09:12", "16.11.2026 09") are not phone numbers.
    if (!plus && (DATE_LIKE_RE.test(m.value.trim()) || text[m.end] === ':')) continue;
    if ((n >= 10 && n <= 13) || (plus && n >= 8 && n <= 15)) add('PHONE', m.value.trim(), m.start + (m.value.length - m.value.trimStart().length), m.end);
  }
  for (const m of matches(POSTCODE_RE, text)) add('POSTCODE', m.value, m.start, m.end);
  for (const m of matches(PIN_LABEL_RE, text, 1)) add('POSTCODE', m.value, m.start, m.end);

  // Names: find by context, then mask every occurrence of each name string.
  // A shouted thread ("MR. DANIEL MENSAH") is read as Title Case, once more with the lowercase
  // cue words ("MY NAME IS") lowered; same length, so offsets hold.
  const cased = text.replace(/\b[A-Z]{2,}(?:[-'][A-Z]+)?\b/g, (w) => w[0] + w.slice(1).toLowerCase());
  const cued = cased.replace(/\b[A-Z][a-z]+\b/g, (w, at: number) => (/[A-Z]{2}/.test(text.slice(at, at + w.length)) && LOWER_CUES.has(w.toLowerCase()) ? w.toLowerCase() : w));
  for (const read of text === cased ? [text] : [cased, cued]) {
    for (const name of detectNameStrings(read)) {
      for (const o of occurrences(read, name)) add('NAME', text.slice(o.start, o.end), o.start, o.end);
    }
  }
  return f;
}

const KIND_PRIORITY: Record<Kind, number> = {
  LINK: 0, EMAIL: 0, CARD: 1, ACCOUNT: 2, ORDER: 3, ADDRESS: 4, PHONE: 5, POSTCODE: 6, NAME: 7,
};

/** Pick non-overlapping findings: earliest first, then longest, then kind priority. */
function resolve(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind],
  );
  const out: Finding[] = [];
  let cursor = -1;
  for (const f of sorted) {
    if (f.start >= cursor) {
      out.push(f);
      cursor = f.end;
    } else {
      // overlap: keep the one that covers more text
      const last = out[out.length - 1];
      if (f.end - f.start > last.end - last.start && f.start <= last.start) {
        out[out.length - 1] = f;
        cursor = f.end;
      } else if (f.end > cursor && f.start < cursor) {
        // partial overlap past the current span: extend the kept span to cover it
        out[out.length - 1] = { ...last, end: f.end, value: '' };
        cursor = f.end;
      }
    }
  }
  return out;
}

/**
 * Turn extra strings reported by the on-device model into findings, keeping only
 * strings that really occur in the text (model output is never trusted blindly).
 */
export function findingsFromStrings(text: string, items: { kind: string; text: string }[]): Finding[] {
  const out: Finding[] = [];
  for (const it of items) {
    const kind = (KINDS as string[]).includes(String(it.kind).toUpperCase()) ? (String(it.kind).toUpperCase() as Kind) : null;
    const value = String(it.text ?? '').trim();
    if (!kind || value.length < 2 || value.length > 200) continue;
    if (kind === 'NAME' && (isKept(value) || value.split(/\s+/).some((w) => KEEP.has(w.toLowerCase())))) continue;
    for (const o of occurrences(text, value)) out.push({ kind, value, start: o.start, end: o.end, source: 'on-device' });
  }
  return out;
}

/**
 * Mask `text`. `extra` are findings from the on-device model; `prior` is an
 * existing key map for the same thread so placeholders stay stable across runs.
 */
export function mask(text: string, extra: Finding[] = [], prior: KeyMap = {}): MaskResult {
  const chosen = resolve([...detect(text), ...extra]).map((f) => ({ ...f, value: text.slice(f.start, f.end) }));

  const map: KeyMap = { ...prior };
  const byValue = new Map<string, string>();
  const counters: Record<string, number> = {};
  for (const [ph, val] of Object.entries(prior)) {
    byValue.set(val, ph);
    const m = /^\[([A-Z]+)_(\d+)/.exec(ph);
    if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, Number(m[2]));
  }

  // Full names first so a lone first name can point at the same person.
  const names = chosen.filter((f) => f.kind === 'NAME').map((f) => f.value);
  const fullNames = [...new Set(names.filter((n) => n.includes(' ')))];
  const placeholderFor = (f: Finding): string => {
    const existing = byValue.get(f.value);
    if (existing) return existing;
    let ph: string;
    if (f.kind === 'NAME' && !f.value.includes(' ')) {
      const full = fullNames.find((n) => n.split(' ')[0] === f.value);
      if (full) {
        const fullPh = byValue.get(full) ?? assign('NAME', full);
        ph = fullPh.replace(/\]$/, '_FIRST]');
        map[ph] = f.value;
        byValue.set(f.value, ph);
        return ph;
      }
    }
    ph = assign(f.kind, f.value);
    return ph;
  };
  function assign(kind: Kind, value: string): string {
    counters[kind] = (counters[kind] ?? 0) + 1;
    const ph = `[${kind}_${counters[kind]}]`;
    map[ph] = value;
    byValue.set(value, ph);
    return ph;
  }
  for (const n of fullNames) if (!byValue.has(n)) assign('NAME', n);

  let masked = '';
  let pos = 0;
  for (const f of chosen) {
    masked += text.slice(pos, f.start) + placeholderFor(f);
    pos = f.end;
  }
  masked += text.slice(pos);
  return { masked, map, findings: chosen };
}

/** Put the original values back. Runs only in the browser. */
export function restore(text: string, map: KeyMap): string {
  return text.replace(PLACEHOLDER_RE, (ph) => map[ph] ?? ph).replace(/\[(NAME_\d+)_FIRST\]/g, (ph) => map[ph] ?? ph);
}

/**
 * Last gate before any text may reach a cloud model: no original value from the
 * key map may appear in it, and the regex floor must find nothing new.
 * Returns the list of leaked values (empty = safe).
 */
export function leakCheck(outgoing: string, map: KeyMap): string[] {
  const leaked = new Set<string>();
  for (const v of Object.values(map)) {
    if (v.length >= 3 && occurrences(outgoing, v).length) leaked.add(v);
  }
  const stripped = outgoing.replace(PLACEHOLDER_RE, ' ');
  for (const f of detect(stripped)) leaked.add(f.value);
  return [...leaked];
}

export function countByKind(map: KeyMap): Partial<Record<Kind, number>> {
  const out: Partial<Record<Kind, number>> = {};
  for (const ph of Object.keys(map)) {
    if (ph.endsWith('_FIRST]')) continue;
    const k = /^\[([A-Z]+)_/.exec(ph)?.[1] as Kind | undefined;
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
