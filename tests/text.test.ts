import { describe, expect, it } from 'vitest';
import { mdToHtml, parsePasted, stripMd } from '../src/text';
import { DEMO_LONG } from './demo-long';

describe('pasted thread header (F1)', () => {
  it('reads the sender from the first From: line', () => {
    const p = parsePasted(DEMO_LONG);
    expect(p.from).toBe('Anjali Deshpande');
    expect(p.subject).toBe('Hello Loomhouse team,');
  });
  it('uses Subject: when present and strips an email in angle brackets', () => {
    expect(parsePasted('From: Grace Okafor <g@x.example>\nSubject: Wrong size\nHi')).toEqual({ from: 'Grace Okafor', subject: 'Wrong size' });
  });
  it('falls back to "Pasted thread"', () => {
    expect(parsePasted('hello there').from).toBe('Pasted thread');
    expect(parsePasted('').subject).toBe('Pasted thread');
  });
});

describe('markdown in model output (F2)', () => {
  const nano = '**Issue:** wrong colour\n* 12 sets grey\n* 3 torn hems\n## Next\nReply by *Friday*';
  it('renders bold and bullets, never raw ** or "* "', () => {
    const h = mdToHtml(nano);
    expect(h).toContain('<b>Issue:</b>');
    expect(h).toContain('• 12 sets grey');
    expect(h).not.toMatch(/\*|##/);
  });
  it('escapes HTML', () => {
    expect(mdToHtml('<script>x</script>')).not.toContain('<script>');
  });
  it('strips marks for the plain draft box', () => {
    expect(stripMd(nano)).toBe('Issue: wrong colour\n- 12 sets grey\n- 3 torn hems\nNext\nReply by *Friday*');
  });
});
