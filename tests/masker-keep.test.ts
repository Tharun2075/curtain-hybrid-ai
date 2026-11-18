import { describe, expect, it } from 'vitest';
// Only the masker is imported here: the shop keep-list must load with the masker itself.
import { leakCheck, mask, restore } from '../src/masker';

const THREAD = 'From: Loomhouse support\nThanks from Loomhouse Linens, Mr. Daniel Mensah';

describe('masker owns its keep-list', () => {
  it('keeps the shop and "Mr.", masks the person', () => {
    const r = mask(THREAD);
    expect(r.masked).toContain('Loomhouse support');
    expect(r.masked).toContain('Loomhouse Linens');
    expect(r.masked).toContain('Mr.');
    expect(r.masked).not.toMatch(/Daniel|Mensah/);
    expect(leakCheck(r.masked, r.map)).toEqual([]);
  });

  it('keeps the shop in ALL CAPS and with another verb', () => {
    for (const t of [THREAD.toUpperCase(), 'Loomhouse Linens wrote back to Mr. Daniel Mensah today']) {
      const r = mask(t);
      expect(r.masked.toLowerCase()).toContain('loomhouse linens');
      expect(r.masked.toLowerCase()).not.toMatch(/daniel|mensah/);
      expect(restore(r.masked, r.map)).toBe(t);
    }
  });

  it('keeps the shop word on its own ("Hi Loomhouse")', () => {
    for (const t of ['Hi Loomhouse,\nMy name is Grace Okafor', 'HI LOOMHOUSE,\nMY NAME IS GRACE OKAFOR']) {
      const r = mask(t);
      expect(r.masked.toLowerCase()).toContain('hi loomhouse');
      expect(r.masked.toLowerCase()).not.toMatch(/grace|okafor/);
    }
  });

  for (const t of ['MY UPI ID IS GRACE.OK@OKBANK', 'send the refund to grace.ok@okbank', 'UPI id is grace.ok@okbank']) {
    it(`masks the UPI id in "${t}"`, () => {
      const r = mask(t);
      expect(r.masked).toContain('[ACCOUNT_1]');
      expect(r.masked.toLowerCase()).not.toContain('grace.ok@okbank');
      expect(leakCheck(r.masked, r.map)).toEqual([]);
    });
  }
});
