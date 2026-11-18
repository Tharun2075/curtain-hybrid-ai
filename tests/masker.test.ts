import { describe, expect, it } from 'vitest';
import { detect, findingsFromStrings, leakCheck, mask, restore } from '../src/masker';
import { THREADS } from '../src/fixtures';
import { SYNTHETIC_DETAILS } from './synthetic-details';

const values = (text: string, kind: string) => detect(text).filter((f) => f.kind === kind).map((f) => f.value);

describe('names', () => {
  it('finds names from greetings, sign-offs, honorifics and labels', () => {
    const t = 'Hi Priya,\nMr. Daniel Mensah called. My name is Grace Okafor.\nName: Tomasz Wierzbicki\nEmail: a@b.co\n\nThanks,\nAnil Kumar';
    const r = mask(t);
    for (const n of ['Priya', 'Daniel Mensah', 'Grace Okafor', 'Tomasz Wierzbicki', 'Anil Kumar']) {
      expect(r.masked).not.toContain(n);
      expect(Object.values(r.map)).toContain(n);
    }
    expect(r.masked).not.toContain('Email [NAME'); // label word not swallowed
  });

  it('masks every later mention of a detected name, incl. first name alone', () => {
    const t = 'Hello, this is Grace Okafor.\nThanks Grace, we are on it. Grace said the parcel was late.';
    const r = mask(t);
    expect(r.masked).not.toMatch(/Grace|Okafor/);
    expect(r.masked).toContain('[NAME_1]');
    expect(r.masked).toContain('[NAME_1_FIRST]');
  });

  it('does not treat greetings to the team or sir/madam as names', () => {
    expect(values('Hi team, Dear Sir/Madam, Hello there', 'NAME')).toEqual([]);
    expect(values('Regards,\nSupport desk', 'NAME')).toEqual([]);
  });
});

describe('phones', () => {
  it.each([
    ['+91 98480 22719'],
    ['07700 900461'],
    ['+44 20 7946 0958'],
    ['(555) 010-4477'],
    ['0484 2391 776'],
    ['9848022719'],
  ])('masks %s', (p) => {
    const r = mask(`Call me on ${p} after six.`);
    expect(r.masked).not.toContain(p);
    expect(Object.values(r.map)).toContain(p);
    expect(r.masked).toMatch(/\[PHONE_1\]/);
  });

  it('leaves prices, dates and short numbers alone', () => {
    const t = 'Refund of 1,499 rupees on 2 November 2026, 40 sets, 24-48 hours.';
    expect(mask(t).masked).toBe(t);
  });
});

describe('addresses', () => {
  it.each([
    ['14 Lake View Road, Banjara Hills, Hyderabad 500034'],
    ['Flat 3, 22 Holloway Street, Leeds LS6 2AB'],
    ['9 Orchard Close, York YO10 5DD'],
    ['5 Station Road, Kochi 682011'],
    ['221B Baker Street, London NW1 6XE'],
  ])('masks %s', (a) => {
    const r = mask(`Please deliver to ${a}. Thanks`);
    expect(r.masked).toContain('[ADDRESS_1]');
    for (const part of a.split(/,\s*/)) expect(r.masked).not.toContain(part);
  });

  it('masks a labelled PIN code and a bare UK postcode', () => {
    const r = mask('PIN code: 500 034, and the depot is at SW1A 1AA');
    expect(r.masked).not.toContain('500 034');
    expect(r.masked).not.toContain('SW1A 1AA');
  });
});

describe('order and account numbers', () => {
  it.each([
    ['My order ORD-58213 arrived', 'ORD-58213'],
    ['order #77310 last week', '77310'],
    ['Tracking number TRK-99120443.', 'TRK-99120443'],
    ['return RMA-30418 on Monday', 'RMA-30418'],
    ['the first was invoice INV-2210.', 'INV-2210'],
    ['Order no. 4471-AX-09 please', '4471-AX-09'],
  ])('masks the reference in "%s"', (t, ref) => {
    const r = mask(t);
    expect(r.masked).not.toContain(ref);
    expect(r.masked).toMatch(/\[ORDER_1\]/);
  });

  it('masks account, customer and UPI ids, emails and card numbers', () => {
    const t = 'account no. LH-447120, customer id CUST-88104, UPI id grace.ok@okbank, mail tomasz.wierz@example.net, card 4111 1111 1111 1111';
    const r = mask(t);
    for (const v of ['LH-447120', 'CUST-88104', 'grace.ok@okbank', 'tomasz.wierz@example.net', '4111 1111 1111 1111']) {
      expect(r.masked).not.toContain(v);
    }
  });

  it('does not mask the word "order" without a number', () => {
    expect(mask('Your order is on the way.').masked).toBe('Your order is on the way.');
  });
});

describe('map, restore and leak check', () => {
  it('gives the same value the same placeholder and restores exactly', () => {
    const t = 'Order ORD-58213 for Priya Raghavan. Again: ORD-58213. Call +91 98480 22719.\n\nThanks,\nPriya Raghavan';
    const r = mask(t);
    expect(r.masked.match(/\[ORDER_1\]/g)?.length).toBe(2);
    expect(restore(r.masked, r.map)).toBe(t);
  });

  it('keeps placeholders stable with a prior map', () => {
    const a = mask('Hi Priya Raghavan, order ORD-58213');
    const b = mask('Thanks,\nArjun Rao\nre ORD-58213', [], a.map);
    expect(b.masked).toContain(a.masked.match(/\[ORDER_\d+\]/)![0]);
    expect(b.masked).toContain('[NAME_2]');
  });

  it('merges on-device findings only when the text really occurs', () => {
    const t = 'the parcel for Meera at Gachibowli was late';
    const extra = findingsFromStrings(t, [
      { kind: 'NAME', text: 'Meera' },
      { kind: 'ADDRESS', text: 'Gachibowli' },
      { kind: 'NAME', text: 'Invented Person' },
      { kind: 'BOGUS', text: 'parcel' },
    ]);
    expect(extra).toHaveLength(2);
    const r = mask(t, extra);
    expect(r.masked).toBe('the parcel for [NAME_1] at [ADDRESS_1] was late');
  });

  it('leak check passes masked text and catches a leaked value', () => {
    const r = mask('Hi Priya Raghavan, call +91 98480 22719 about ORD-58213');
    expect(leakCheck(r.masked, r.map)).toEqual([]);
    expect(leakCheck(r.masked + ' Priya Raghavan', r.map)).toContain('Priya Raghavan');
    expect(leakCheck('call 07700 900461', {})).toContain('07700 900461');
  });

  it('masks every synthetic demo thread with no leaks', () => {
    for (const th of THREADS) {
      const text = th.messages.map((m) => `From: ${m.from}\n${m.body}`).join('\n\n---\n\n');
      const r = mask(text);
      expect(leakCheck(r.masked, r.map), th.id).toEqual([]);
      expect(restore(r.masked, r.map)).toBe(text);
      for (const m of th.messages) {
        if (m.from === 'Loomhouse support') expect(r.masked, th.id).toContain('From: Loomhouse support');
        else for (const part of m.from.replace(/^Mr\.\s*/, '').split(' ')) expect(r.masked, th.id).not.toContain(part);
      }
    }
  });

  it('does not mask dates and timestamps as phones, but still masks the phone beside them', () => {
    const r = mask('Sent: 2026-11-16 09:12\nOn 16/11/2026 10:30 call 98480 22719 please.');
    expect(r.masked).toContain('2026-11-16 09:12');
    expect(r.masked).toContain('16/11/2026 10:30');
    expect(r.masked).not.toContain('98480 22719');
  });
});

describe('ids with no TLD, IBANs and links (T8)', () => {
  it('masks a UPI id after "is" and the leak check catches a bare one', () => {
    const r = mask('My UPI id is grace.ok@okbank if that is easier.');
    expect(r.masked).not.toContain('grace.ok');
    expect(leakCheck('pay to grace.ok@okbank', {})).toContain('grace.ok@okbank');
    expect(leakCheck('pay to 9848022719@ybl', {}).join(' ')).toContain('@ybl');
  });

  it('keeps emails whole and masks IBAN-like ids and links', () => {
    const r = mask('mail a.b@example.co.uk, IBAN GB82 WEST 1234 5698 7654 32, see https://track.example.com/p?id=PR-1234&n=Priya.');
    expect(Object.values(r.map)).toContain('a.b@example.co.uk');
    expect(r.masked).not.toContain('GB82');
    expect(r.masked).not.toContain('track.example.com');
    expect(r.masked).toMatch(/\[LINK_1\]\.$/);
    expect(restore(r.masked, r.map)).toContain('https://track.example.com/p?id=PR-1234&n=Priya');
  });
});

describe('shop names and titles survive (no over-masking)', () => {
  it('never masks the shop name or an honorific as a person', () => {
    const r = mask('From: Loomhouse support\nHi\n\nFrom: Mr. Daniel Mensah\nThanks from Loomhouse Linens');
    expect(r.masked).toContain('From: Loomhouse support');
    expect(r.masked).toContain('Loomhouse Linens');
    expect(r.masked).toContain('From: Mr. [NAME_1]');
    expect(Object.values(r.map)).not.toContain('Mr');
    expect(Object.values(r.map)).not.toContain('Loomhouse');
  });

  it('over ALL synthetic threads: shop/brand names and titles kept, every personal detail masked', () => {
    expect(Object.keys(SYNTHETIC_DETAILS).sort()).toEqual(THREADS.map((t) => t.id).sort());
    for (const th of THREADS) {
      const text = th.messages.map((m) => `From: ${m.from}\nSent: ${m.at}\n${m.body}`).join('\n\n---\n\n');
      const r = mask(text);
      const kept = Object.values(r.map).join(' | ');
      expect(kept, th.id).not.toMatch(/Loomhouse|Linens|\bMr\b/);
      for (const m of th.messages) if (m.from === 'Loomhouse support') expect(r.masked, th.id).toContain('Loomhouse support');
      if (text.includes('Mr. ')) expect(r.masked, th.id).toContain('Mr. ');
      for (const d of SYNTHETIC_DETAILS[th.id]) expect(r.masked, `${th.id}: ${d}`).not.toContain(d);
      expect(leakCheck(r.masked, r.map), th.id).toEqual([]);
    }
  });
});
