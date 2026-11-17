import { describe, expect, it } from 'vitest';
import { entropy, luhnValid, redact, restore, unresolvedPlaceholders } from '../src/lib/redact';

describe('redact: secrets', () => {
  it.each([
    ['AWS key', 'key AKIAIOSFODNN7EXAMPLE here', 'API_KEY'],
    ['OpenAI key', 'use sk-proj-abcdEFGH1234ijklMNOP5678qrst', 'API_KEY'],
    ['GitHub token', 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', 'API_KEY'],
    ['Slack token', 'xoxb-123456789012-abcdefABCDEF', 'API_KEY'],
    ['Google API key', 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q', 'API_KEY'],
    ['JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N', 'JWT'],
  ])('%s', (_name, input, kind) => {
    const r = redact(input);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.kind).toBe(kind);
    expect(r.text).toContain(`[${kind}_1]`);
  });

  it('private key block', () => {
    const input = 'x\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----\ny';
    const r = redact(input);
    expect(r.text).toBe('x\n[PRIVATE_KEY_1]\ny');
  });

  it('password assignment keeps the label, hides the value', () => {
    const r = redact('db password: hunter2!x and API_KEY="zz9Qw8rt"');
    expect(r.text).toBe('db password: [SECRET_1] and API_KEY="[SECRET_2]"');
  });

  it('connection string credentials', () => {
    const r = redact('postgres://admin:s3cr3t@db.internal:5432/app');
    expect(r.items[0]!.kind).toBe('SECRET');
    expect(r.text).not.toContain('s3cr3t');
  });

  it('unknown high-entropy token', () => {
    const r = redact('token is Zx81kQp0LmN4vB7rT2yW9sHd');
    expect(r.items.map((i) => i.kind)).toEqual(['SECRET']);
  });

  it('leaves ordinary long words and slugs alone', () => {
    const input = 'see read-between-the-lines-without-anyone and internationalization';
    expect(redact(input).text).toBe(input);
  });
});

describe('redact: PII', () => {
  it('email', () => {
    expect(redact('mail dana.smith@acme.co.uk now').text).toBe('mail [EMAIL_1] now');
  });

  it('valid card number only', () => {
    expect(redact('card 4111 1111 1111 1111').text).toBe('card [CARD_1]');
    expect(redact('order 4111 1111 1111 1112').items.some((i) => i.kind === 'CARD')).toBe(false);
  });

  it('phone numbers but not dates or short numbers', () => {
    expect(redact('call +91 98765 43210').text).toBe('call [PHONE_1]');
    expect(redact('call (555) 123-4567 ok').text).toBe('call [PHONE_1] ok');
    const plain = 'due 2026-11-30, room 1234, budget 50000';
    expect(redact(plain).text).toBe(plain);
  });
});

describe('redact: people and terms', () => {
  it('pseudonymizes people by relationship, sharing one placeholder across name parts', () => {
    const r = redact('Dana Smith said ok. Ask Dana tomorrow.', {
      people: [{ name: 'Dana Smith', label: 'manager' }],
    });
    expect(r.text).toBe('[MANAGER_1] said ok. Ask [MANAGER_1] tomorrow.');
  });

  it('does not match names inside other words', () => {
    const r = redact('Danaher Corp', { people: [{ name: 'Dana', label: 'peer' }] });
    expect(r.text).toBe('Danaher Corp');
  });

  it('confidential terms, case-insensitive', () => {
    const r = redact('Status of project falcon?', { terms: ['Project Falcon'] });
    expect(r.text).toBe('Status of [TERM_1]?');
  });

  it('repeated values reuse the same placeholder', () => {
    const r = redact('a@b.co then a@b.co then c@d.co');
    expect(r.text).toBe('[EMAIL_1] then [EMAIL_1] then [EMAIL_2]');
    expect(r.items).toHaveLength(2);
  });
});

describe('restore', () => {
  const r = redact('Dana Smith emailed dana@acme.com', {
    people: [{ name: 'Dana Smith', label: 'manager' }],
  });

  it('round-trips', () => {
    expect(restore(r.text, r.items)).toBe('Dana Smith emailed dana@acme.com');
  });

  it('tolerates case and spacing changes from a model', () => {
    expect(restore('Reply to [ manager_1 ] at [Email_1].', r.items)).toBe('Reply to Dana Smith at dana@acme.com.');
  });

  it('reports placeholders it could not resolve', () => {
    const out = restore('Ask [MANAGER_1] and [PEER_2]', r.items);
    expect(unresolvedPlaceholders(out)).toEqual(['[PEER_2]']);
  });
});

describe('helpers', () => {
  it('luhn', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('entropy', () => {
    expect(entropy('aaaa')).toBe(0);
    expect(entropy('abcd')).toBe(2);
  });
});
