import { describe, expect, it, vi } from 'vitest';
import { leakCheck, mask, restore } from '../src/masker';
import { runTask, type ModelLike } from '../src/pipeline';
import { DEMO_LONG, DEMO_LONG_SECRETS } from './demo-long';

const thread = `From: Anjali Deshpande\nSent: 2026-11-16 17:55\n${DEMO_LONG}`;

function fake(answer: string, source: 'on_device' | 'in_cloud') {
  const calls: string[] = [];
  const m: ModelLike = {
    generateContent: vi.fn(async (p: string) => {
      calls.push(p);
      return { response: { text: () => answer, inferenceSource: source } };
    }),
  };
  return { m, calls };
}

describe('demo long thread (F3)', () => {
  it('regex floor masks street, locality, PIN and gate code', () => {
    const r = mask(thread);
    for (const s of DEMO_LONG_SECRETS) expect(r.masked, s).not.toContain(s);
    expect(r.masked).toContain('[ADDRESS_1]');
    expect(r.masked).toContain('[CODE_1]');
    expect(r.masked).toContain('Saffron Court');
    expect(leakCheck(r.masked, r.map)).toEqual([]);
    expect(restore(r.masked, r.map)).toBe(thread);
  });

  it('gate / door / access codes in other wordings', () => {
    for (const t of ['door code: 2580', 'Access code is 90210', 'GATE CODE 1234']) {
      const r = mask(t);
      expect(r.masked).toContain('[CODE_1]');
      expect(r.masked).not.toMatch(/\d{4}/);
    }
  });

  for (const [label, nanoItems] of [
    ['Nano finds nothing (regex floor still runs after it)', []],
    ['Nano finds some items', [{ kind: 'NAME', text: 'Anjali Deshpande' }, { kind: 'ADDRESS', text: '14 Banyan Street' }, { kind: 'CODE', text: '4471' }]],
  ] as const) {
    it(`Nano path, ${label}: the cloud prompt holds no original value`, async () => {
      const masker = fake(JSON.stringify({ items: nanoItems }), 'on_device');
      const short = fake('x', 'on_device');
      const cloud = fake('Dear [NAME_1], the replacements go to [ADDRESS_1]. The support team', 'in_cloud');
      const r = await runTask('reply', thread, {
        models: { masker: masker.m, short: short.m, cloud: cloud.m },
        deviceReady: true,
        ondeviceMaxChars: 1800,
        priorMap: {},
        confirmCloud: async () => true,
      });
      expect(r.ok).toBe(true);
      expect(masker.calls.length).toBe(1);
      expect(cloud.calls.length).toBe(1);
      for (const s of DEMO_LONG_SECRETS) expect(cloud.calls[0], s).not.toContain(s);
      expect(r.cloudReceived).toBe(cloud.calls[0]);
      expect(r.output).toContain('Anjali Deshpande');
      // F5: real elapsed time on the mask and answer steps
      expect(r.ledger.find((l) => l.step === 'mask')?.ms).toBeGreaterThanOrEqual(0);
      expect(r.ledger.find((l) => l.step === 'answer')?.ms).toBeGreaterThanOrEqual(0);
    });
  }

  it('regex-only path (no Nano): the confirm dialog text holds no original value', async () => {
    const cloud = fake('ok', 'in_cloud');
    let shown = '';
    const r = await runTask('summarise', thread, {
      models: { masker: fake('{}', 'on_device').m, short: fake('x', 'in_cloud').m, cloud: cloud.m },
      deviceReady: false,
      ondeviceMaxChars: 1800,
      priorMap: {},
      confirmCloud: async (out) => ((shown = out), true),
    });
    expect(r.ok).toBe(true);
    for (const s of DEMO_LONG_SECRETS) expect(shown, s).not.toContain(s);
  });

  it('task prompts ask for plain text, no markdown (F2)', async () => {
    const short = fake('- ok', 'on_device');
    await runTask('summarise', 'Hi Priya Raghavan, order ORD-58213', {
      models: { masker: fake('{}', 'on_device').m, short: short.m, cloud: fake('x', 'in_cloud').m },
      deviceReady: true,
      ondeviceMaxChars: 1800,
      priorMap: {},
      confirmCloud: async () => true,
    });
    expect(short.calls[0]).toContain('no markdown');
  });
});
