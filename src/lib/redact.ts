// Rule-based redaction. Runs on the device before any text can reach the cloud.
//
// Deterministic by design: fixed patterns, checksums and entropy scores are instant, testable
// and never "hallucinate" a miss the way a small language model can. People are pseudonymized
// with their relationship label (e.g. [MANAGER_1]) so the cloud keeps the context it needs to
// read tone, without learning who anyone is.

export type RedactionKind =
  | 'PRIVATE_KEY'
  | 'JWT'
  | 'API_KEY'
  | 'SECRET'
  | 'CARD'
  | 'EMAIL'
  | 'PHONE'
  | 'TERM'
  | 'PERSON';

export interface RedactedItem {
  placeholder: string;
  original: string;
  kind: RedactionKind;
}

export interface Redaction {
  text: string;
  items: RedactedItem[];
}

export interface Person {
  name: string;
  /** Relationship label used in the placeholder, e.g. "manager" -> [MANAGER_1]. */
  label: string;
}

export interface RedactOptions {
  /** Organization or personal confidential terms (project code names, client names). */
  terms?: string[];
  /** Known people to pseudonymize with their relationship label. */
  people?: Person[];
}

interface Span {
  start: number;
  end: number;
  kind: RedactionKind;
  /** Placeholder label; defaults to the kind. */
  label: string;
}

// Lower number wins when two detections overlap.
const PRIORITY: Record<RedactionKind, number> = {
  PRIVATE_KEY: 0,
  JWT: 1,
  API_KEY: 2,
  SECRET: 3,
  CARD: 4,
  EMAIL: 5,
  PHONE: 6,
  TERM: 7,
  PERSON: 8,
};

const KNOWN_KEY_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bsk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic style
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\b(?:sk|rk|pk)_live_[0-9A-Za-z]{16,}\b/g, // Stripe live keys
];

function collect(re: RegExp, text: string, kind: RedactionKind, spans: Span[], label: string = kind): void {
  for (const m of text.matchAll(re)) {
    spans.push({ start: m.index, end: m.index + m[0].length, kind, label });
  }
}

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive matcher for a literal phrase. */
function phraseRegExp(phrase: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}_])`, 'giu');
}

function detect(text: string, opts: RedactOptions): Span[] {
  const spans: Span[] = [];

  collect(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, text, 'PRIVATE_KEY', spans);
  collect(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, text, 'JWT', spans);
  for (const re of KNOWN_KEY_PATTERNS) collect(re, text, 'API_KEY', spans);

  // Credentials embedded in connection strings: scheme://user:password@host
  collect(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@\S+/gi, text, 'SECRET', spans);

  // Assignments like `password: hunter2` or `API_KEY="..."` - redact only the value.
  for (const m of text.matchAll(
    /\b(?:pass(?:word)?|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]\s*["']?([^\s"',;]{6,})/gid,
  )) {
    const [start, end] = m.indices![1]!;
    spans.push({ start, end, kind: 'SECRET', label: 'SECRET' });
  }

  // Card numbers: 13-19 digits with optional spaces/dashes, Luhn-checked.
  for (const m of text.matchAll(/(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (luhnValid(digits)) spans.push({ start: m.index, end: m.index + m[0].length, kind: 'CARD', label: 'CARD' });
  }

  collect(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, text, 'EMAIL', spans);

  // Phone numbers: 9-15 digits with typical separators. Plain 8-digit dates are excluded.
  for (const m of text.matchAll(/(?<![\w+])\+?\(?\d[\d\s().-]{7,}\d(?!\w)/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(m[0])) continue; // ISO date prefix
    spans.push({ start: m.index, end: m.index + m[0].length, kind: 'PHONE', label: 'PHONE' });
  }

  for (const term of opts.terms ?? []) {
    if (term.trim().length >= 2) collect(phraseRegExp(term.trim()), text, 'TERM', spans);
  }

  for (const person of opts.people ?? []) {
    const label = normalizeLabel(person.label);
    const full = person.name.trim();
    if (!full) continue;
    collect(phraseRegExp(full), text, 'PERSON', spans, label);
    for (const part of full.split(/\s+/)) {
      if (part.length >= 3 && part !== full) collect(phraseRegExp(part), text, 'PERSON', spans, label);
    }
  }

  // Generic high-entropy tokens (unknown key formats). Needs a digit and mixed character
  // classes so ordinary long words and slugs are left alone.
  for (const m of text.matchAll(/[A-Za-z0-9_\-+/=]{20,}/g)) {
    const tok = m[0];
    const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((r) => r.test(tok)).length;
    if (/\d/.test(tok) && classes >= 2 && entropy(tok) >= 4.0) {
      spans.push({ start: m.index, end: m.index + tok.length, kind: 'SECRET', label: 'SECRET' });
    }
  }

  return spans;
}

function normalizeLabel(label: string): string {
  const cleaned = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'PERSON';
}

/** Picks non-overlapping spans, preferring higher-priority kinds, then longer matches. */
function resolveOverlaps(spans: Span[]): Span[] {
  const ordered = [...spans].sort(
    (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const accepted: Span[] = [];
  for (const s of ordered) {
    if (accepted.every((a) => s.end <= a.start || s.start >= a.end)) accepted.push(s);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Replaces sensitive values with stable placeholders like [EMAIL_1] or [MANAGER_1].
 * The same original value always maps to the same placeholder within one call.
 * People are matched by full name and by each name part, all sharing one placeholder.
 */
export function redact(input: string, opts: RedactOptions = {}): Redaction {
  const spans = resolveOverlaps(detect(input, opts));
  const counters = new Map<string, number>();
  const byKey = new Map<string, RedactedItem>();
  const personPlaceholders = new Map<string, string>(); // label+name -> placeholder
  const items: RedactedItem[] = [];

  let out = '';
  let cursor = 0;
  for (const s of spans) {
    const original = input.slice(s.start, s.end);
    let key = `${s.kind}:${original.toLowerCase()}`;
    if (s.kind === 'PERSON') {
      const person = (opts.people ?? []).find((p) =>
        p.name.toLowerCase().split(/\s+/).concat(p.name.toLowerCase()).includes(original.toLowerCase()),
      );
      key = `PERSON:${s.label}:${person?.name.toLowerCase() ?? original.toLowerCase()}`;
    }

    let item = byKey.get(key);
    if (!item) {
      let placeholder = s.kind === 'PERSON' ? personPlaceholders.get(key) : undefined;
      if (!placeholder) {
        const n = (counters.get(s.label) ?? 0) + 1;
        counters.set(s.label, n);
        placeholder = `[${s.label}_${n}]`;
        if (s.kind === 'PERSON') personPlaceholders.set(key, placeholder);
      }
      item = { placeholder, original, kind: s.kind };
      byKey.set(key, item);
      items.push(item);
    }

    out += input.slice(cursor, s.start) + item.placeholder;
    cursor = s.end;
  }
  out += input.slice(cursor);
  return { text: out, items };
}

/**
 * Puts the original values back. Tolerates small changes a cloud model may make to a
 * placeholder (case, inner spaces), e.g. "[ manager_1 ]".
 */
export function restore(text: string, items: RedactedItem[]): string {
  let out = text;
  for (const item of items) {
    const inner = item.placeholder.slice(1, -1);
    const re = new RegExp(`\\[\\s*${escapeRegExp(inner)}\\s*\\]`, 'gi');
    out = out.replace(re, () => item.original);
  }
  return out;
}

/** Placeholders still present in text, e.g. ones a model invented or mangled. */
export function unresolvedPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[A-Z][A-Z0-9_]*_\d+\]/g) ?? [])];
}
