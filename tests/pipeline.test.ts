import { describe, expect, it, vi } from 'vitest';
import { runTask, type ModelLike, type TaskId } from '../src/pipeline';
import { THREADS } from '../src/fixtures';
import { SYNTHETIC_DETAILS } from './synthetic-details';

const thread = THREADS[0].messages.map((m) => `From: ${m.from}\n${m.body}`).join('\n\n---\n\n');
const RAW_SECRETS = ['Priya', 'Raghavan', 'Arjun', '98480 22719', 'ORD-58213', 'LH-447120', '14 Lake View Road', '500034'];

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

describe('pipeline', () => {
  it('without an on-device model: asks before the cloud call, and makes none if declined (T6)', async () => {
    const masker = fake('{}', 'on_device');
    const short = fake('x', 'in_cloud');
    const cloud = fake('x', 'in_cloud');
    const confirmCloud = vi.fn(async () => false);
    for (const task of ['summarise', 'extract', 'reply'] as TaskId[]) {
      const r = await runTask(task, thread, {
        models: { masker: masker.m, short: short.m, cloud: cloud.m },
        deviceReady: false,
        ondeviceMaxChars: 1800,
        priorMap: {},
        confirmCloud,
      });
      expect(r.ok).toBe(false);
    }
    expect(confirmCloud).toHaveBeenCalledTimes(3);
    expect(masker.calls.length + short.calls.length + cloud.calls.length).toBe(0);
  });

  it('cloud receives masked text only and the answer is restored (T7, T8)', async () => {
    const cloud = fake('Summary: [NAME_1] wants a replacement for [ORDER_1] before Friday.', 'in_cloud');
    const r = await runTask('summarise', thread, {
      models: { masker: fake('{}', 'on_device').m, short: fake('', 'in_cloud').m, cloud: cloud.m },
      deviceReady: false,
      ondeviceMaxChars: 100, // force the cloud route
      priorMap: {},
      confirmCloud: async () => true,
    });
    expect(r.ok).toBe(true);
    expect(r.cloudReceived).toBe(cloud.calls[0]);
    for (const s of RAW_SECRETS) expect(cloud.calls[0]).not.toContain(s);
    expect(r.output).toContain('Priya Raghavan');
    expect(r.output).toContain('ORD-58213');
    expect(r.ledger.find((l) => l.step === 'answer')?.ranOn).toBe('cloud');
  });

  it('with an on-device model: raw text goes only to the masker, short task stays on device (T5)', async () => {
    const masker = fake('{"items":[{"kind":"NAME","text":"Arjun"},{"kind":"NAME","text":"Not In Text"}]}', 'on_device');
    const short = fake('Order: [ORDER_1]', 'on_device');
    const cloud = fake('', 'in_cloud');
    const confirmCloud = vi.fn(async () => true);
    const r = await runTask('extract', thread, {
      models: { masker: masker.m, short: short.m, cloud: cloud.m },
      deviceReady: true,
      ondeviceMaxChars: 5000,
      priorMap: {},
      confirmCloud,
    });
    expect(r.ok).toBe(true);
    expect(masker.calls[0]).toContain('Priya Raghavan'); // raw text, on-device only
    for (const s of RAW_SECRETS) expect(short.calls[0]).not.toContain(s);
    expect(cloud.calls).toHaveLength(0);
    expect(confirmCloud).not.toHaveBeenCalled();
    expect(r.cloudReceived).toBeNull();
    expect(r.maskedBy).toBe('on-device + regex');
    expect(r.output).toBe('Order: ORD-58213');
  });

  it('on-device masker throws: regex-only masking still needs the click, even on the short route (T6)', async () => {
    const masker: ModelLike = { generateContent: vi.fn(async () => { throw new Error('model crashed'); }) };
    const short = fake('x', 'in_cloud');
    const cloud = fake('x', 'in_cloud');
    const confirmCloud = vi.fn(async () => false);
    const r = await runTask('summarise', thread, {
      models: { masker, short: short.m, cloud: cloud.m },
      deviceReady: true,
      ondeviceMaxChars: 50_000, // short route (PREFER_ON_DEVICE), which can fall back to the cloud
      priorMap: {},
      confirmCloud,
    });
    expect(r.maskedBy).toBe('regex only');
    expect(confirmCloud).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(short.calls.length + cloud.calls.length).toBe(0);
  });

  it('no synthetic personal detail reaches the cloud prompt, on any demo thread (T8)', async () => {
    for (const th of THREADS) {
      const text = th.messages.map((m) => `From: ${m.from}\nSent: ${m.at}\n${m.body}`).join('\n\n---\n\n');
      for (const task of ['summarise', 'extract', 'reply'] as TaskId[]) {
        const cloud = fake('ok', 'in_cloud');
        const r = await runTask(task, text, {
          models: { masker: fake('{}', 'on_device').m, short: fake('', 'in_cloud').m, cloud: cloud.m },
          deviceReady: false,
          ondeviceMaxChars: 100,
          priorMap: {},
          confirmCloud: async () => true,
        });
        expect(r.ok, `${th.id}/${task}`).toBe(true);
        expect(cloud.calls).toHaveLength(1);
        for (const d of SYNTHETIC_DETAILS[th.id]) expect(cloud.calls[0], `${th.id}/${task}: ${d}`).not.toContain(d);
        expect(cloud.calls[0]).not.toMatch(/\bMr\b(?!\.)|\[NAME_\d+\]\. \[NAME/);
      }
    }
  });
});
