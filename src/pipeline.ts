// The Curtain pipeline: mask on the device, route, call, restore in the browser.
// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.
import { countByKind, findingsFromStrings, leakCheck, mask, restore, type Finding, type KeyMap } from './masker';

export type TaskId = 'summarise' | 'extract' | 'reply';

export const TASKS: Record<TaskId, { label: string; hint: string }> = {
  summarise: { label: 'Summarise thread', hint: 'What happened, what the customer wants, by when.' },
  extract: { label: 'Extract fields', hint: 'Order, issue, request, deadline, mood as fields.' },
  reply: { label: 'Draft reply', hint: 'An AI-generated draft for a person to edit and send.' },
};

/** Minimal shape of a Firebase AI Logic GenerativeModel we use (easy to fake in tests). */
export interface ModelLike {
  generateContent(prompt: string): Promise<{
    response: { text(): string; inferenceSource?: string };
  }>;
}
export interface ModelsLike {
  masker: ModelLike;
  short: ModelLike;
  cloud: ModelLike;
}

export type Handle = 'masker' | 'short' | 'cloud' | 'regex';
export const HANDLE_MODE: Record<Handle, string> = {
  masker: 'ONLY_ON_DEVICE',
  short: 'PREFER_ON_DEVICE',
  cloud: 'ONLY_IN_CLOUD',
  regex: 'regex floor (no model)',
};

export interface LedgerStep {
  step: 'mask' | 'route' | 'answer' | 'store' | 'blocked';
  handle?: Handle;
  mode?: string;
  ranOn?: 'on-device' | 'cloud' | 'this browser' | 'not run';
  note: string;
  /** Exact text that a model which may reach the cloud received. */
  sent?: string;
  /** Real elapsed time of this step in milliseconds (shown in the ledger). */
  ms?: number;
}

export interface RunResult {
  ok: boolean;
  task: TaskId;
  maskedInput: string;
  maskedOutput: string;
  output: string;
  map: KeyMap;
  ledger: LedgerStep[];
  cloudReceived: string | null;
  maskedBy: 'on-device + regex' | 'regex only';
}

export interface RunDeps {
  models: ModelsLike;
  deviceReady: boolean;
  ondeviceMaxChars: number;
  priorMap: KeyMap;
  /**
   * Asked before any call that may reach the cloud when masking ran without the
   * on-device model. Must resolve true (user clicked) or no cloud call happens.
   */
  confirmCloud: (outgoing: string, why: string) => Promise<boolean>;
}

const MASKER_PROMPT = (text: string) =>
  'You find personal details in customer-support text so they can be hidden.\n' +
  'List every personal name, street address or place of residence, phone number, email, ' +
  'order/ticket/tracking number, account, customer or UPI id, IBAN, link/URL, card number, and gate/door/access code that appears in the TEXT.\n' +
  'Copy each item EXACTLY as written. Ignore anything already in square brackets like [NAME_1].\n' +
  'Answer with JSON only, no prose: {"items":[{"kind":"NAME|ADDRESS|PHONE|EMAIL|ORDER|ACCOUNT|CARD|LINK|CODE","text":"..."}]}\n\n' +
  'TEXT:\n' +
  text;

const COMMON =
  'Placeholders in square brackets such as [NAME_1], [PHONE_1], [ORDER_1] stand for hidden personal details. ' +
  'Keep every placeholder exactly as written, never guess what it stands for, never invent new personal details. ' +
  'Write plain text only, no markdown: no asterisks, no # headings; start list lines with "- ".\n\n';

export function taskPrompt(task: TaskId, maskedThread: string): string {
  switch (task) {
    case 'summarise':
      return (
        COMMON +
        'Summarise this customer-support thread for a busy support agent in at most 5 short bullet points: ' +
        'what happened, what the customer is asking for, any deadline, and what is still open.\n\nTHREAD:\n' +
        maskedThread
      );
    case 'extract':
      return (
        COMMON +
        'Extract these fields from the thread and answer with one line per field, as "Field: value" ' +
        '(use "unknown" when missing): Customer, Order reference, Issue, Requested action, Deadline, ' +
        'Contact detail given, Mood (calm / frustrated / urgent).\n\nTHREAD:\n' +
        maskedThread
      );
    case 'reply':
      return (
        COMMON +
        'Draft a short, warm, practical reply from the shop support team to the customer in this thread. ' +
        'Address the customer by their placeholder name. Do not promise refunds or dates the thread does not support; ' +
        'where a decision is needed, say the team will confirm. Sign off as "The support team". ' +
        'Output only the reply text.\n\nTHREAD:\n' +
        maskedThread
      );
  }
}

function parseItems(raw: string): { kind: string; text: string }[] {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]);
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`no answer after ${ms / 1000} s`)), ms))]);
}

const sourceOf = (s?: string): 'on-device' | 'cloud' => (s === 'on_device' ? 'on-device' : 'cloud');

/** Wall clock in ms; performance.now() where it exists. */
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** "1.9 s" / "420 ms" for the ledger. */
export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export async function runTask(task: TaskId, rawThread: string, deps: RunDeps): Promise<RunResult> {
  const ledger: LedgerStep[] = [];
  const t0 = now();

  // 1. MASK. Raw text goes only to the ONLY_ON_DEVICE model; the regex floor always runs.
  let extra: Finding[] = [];
  let maskedBy: RunResult['maskedBy'] = 'regex only';
  if (deps.deviceReady) {
    try {
      const r = await withTimeout(deps.models.masker.generateContent(MASKER_PROMPT(rawThread)), 60_000);
      if (r.response.inferenceSource && r.response.inferenceSource !== 'on_device') {
        throw new Error('masker answered from a non-device source'); // defensive; ONLY_ON_DEVICE should never do this
      }
      extra = findingsFromStrings(rawThread, parseItems(r.response.text()));
      maskedBy = 'on-device + regex';
    } catch (e) {
      ledger.push({
        step: 'mask',
        handle: 'masker',
        mode: HANDLE_MODE.masker,
        ranOn: 'not run',
        note: `On-device masker failed (${(e as Error).message}); using the regex floor only. Nothing was sent anywhere.`,
      });
    }
  }
  const m = mask(rawThread, extra, deps.priorMap);
  const maskMs = now() - t0;
  const counts = countByKind(m.map);
  const countText = Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'nothing';
  ledger.push(
    maskedBy === 'on-device + regex'
      ? {
          step: 'mask',
          handle: 'masker',
          mode: HANDLE_MODE.masker,
          ranOn: 'on-device',
          note: `Masked on this device by the on-device model (${extra.length} hits) plus the regex floor: ${countText}.`,
          ms: maskMs,
        }
      : {
          step: 'mask',
          handle: 'regex',
          mode: HANDLE_MODE.regex,
          ranOn: 'this browser',
          note: `No on-device model: masked by the regex floor only (${countText}). It can miss names it has no cue for, so the cloud may see more.`,
          ms: maskMs,
        },
  );

  // 2. LEAK GATE before anything can reach the cloud.
  const prompt = taskPrompt(task, m.masked);
  const leaks = leakCheck(prompt, m.map);
  const fail = (note: string): RunResult => {
    ledger.push({ step: 'blocked', ranOn: 'not run', note });
    return { ok: false, task, maskedInput: m.masked, maskedOutput: '', output: '', map: m.map, ledger, cloudReceived: null, maskedBy };
  };
  if (leaks.length) return fail(`Blocked: ${leaks.length} personal detail(s) still visible after masking. No model was called.`);

  // 3. ROUTE by size of the masked prompt (threshold from Remote Config or the documented default).
  // Without an on-device model the PREFER_ON_DEVICE handle would only fall back to the cloud
  // (and on some browsers the availability probe never settles), so go to the cloud handle directly.
  const short = prompt.length <= deps.ondeviceMaxChars;
  const handle: Handle = short && deps.deviceReady ? 'short' : 'cloud';
  // A PREFER_ON_DEVICE call can still fall back to the cloud, so any run whose masking
  // was regex-only counts as "may reach the cloud" and needs the user's click (T6).
  const mayReachCloud = handle === 'cloud' || !deps.deviceReady || maskedBy === 'regex only';
  ledger.push({
    step: 'route',
    handle,
    mode: HANDLE_MODE[handle],
    note:
      handle === 'short'
        ? `Masked prompt is ${prompt.length} chars (limit ${deps.ondeviceMaxChars}): short task, on-device first.`
        : short
          ? `Masked prompt is ${prompt.length} chars (limit ${deps.ondeviceMaxChars}): short task, but no on-device model here, so it goes to Gemini in the cloud.`
          : `Masked prompt is ${prompt.length} chars (limit ${deps.ondeviceMaxChars}): long task, sent to Gemini in the cloud.`,
  });

  // 4. CONFIRM. Without the on-device masker, nothing goes to the cloud before the user clicks.
  if (mayReachCloud && maskedBy === 'regex only') {
    const ok = await deps.confirmCloud(prompt, 'Masking ran without an on-device model. Check what the cloud will receive.');
    if (!ok) return fail('You cancelled. No cloud call was made.');
  }

  // 5. CALL. Only masked text is ever passed to a model that may reach the cloud.
  const model = handle === 'short' ? deps.models.short : deps.models.cloud;
  let text: string;
  let ranOn: 'on-device' | 'cloud';
  const tCall = now();
  try {
    const r = await withTimeout(model.generateContent(prompt), 90_000);
    text = r.response.text();
    ranOn = handle === 'cloud' ? 'cloud' : sourceOf(r.response.inferenceSource);
  } catch (e) {
    return fail(`Model call failed: ${(e as Error).message}`);
  }
  ledger.push({
    step: 'answer',
    handle,
    mode: HANDLE_MODE[handle],
    ranOn,
    note: ranOn === 'cloud' ? 'Answered by Gemini in the cloud. It received the masked text shown below.' : 'Answered on this device. No cloud call.',
    sent: ranOn === 'cloud' ? prompt : undefined,
    ms: now() - tCall,
  });

  // 6. RESTORE in the browser from the local key map.
  return {
    ok: true,
    task,
    maskedInput: m.masked,
    maskedOutput: text,
    output: restore(text, m.map),
    map: m.map,
    ledger,
    cloudReceived: ranOn === 'cloud' ? prompt : null,
    maskedBy,
  };
}
