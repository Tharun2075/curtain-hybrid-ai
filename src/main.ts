// Curtain UI. Plain TypeScript, no framework.
// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.
import './styles.css';
import { SHOP, THREADS, type Thread } from './fixtures';
import { loadRouting, makeModels, onDeviceState, saveRun, signIn, type DeviceState, type Models, type Routing } from './firebase';
import { clearAllMaps, loadMap, saveMap } from './keymap';
import { mask } from './masker';
import { runTask, TASKS, type LedgerStep, type RunResult, type TaskId } from './pipeline';

interface State {
  threads: Thread[];
  current: string;
  showMasked: boolean;
  busy: TaskId | null;
  device: DeviceState | 'checking';
  routing: Routing | null;
  uid: string | null;
  authError: string | null;
  result: RunResult | null;
  stored: string | null;
}

const S: State = {
  threads: [...THREADS],
  current: THREADS[0].id,
  showMasked: false,
  busy: null,
  device: 'checking',
  routing: null,
  uid: null,
  authError: null,
  result: null,
  stored: null,
};
let models: Models | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const withChips = (s: string) => esc(s).replace(/\[[A-Z]+_\d+(?:_FIRST)?\]/g, (p) => `<span class="ph">${p}</span>`);
const thread = () => S.threads.find((t) => t.id === S.current)!;
const threadText = (t: Thread) => t.messages.map((m) => `From: ${m.from}\nSent: ${m.at}\n${m.body}`).join('\n\n---\n\n');
const deviceReady = () => S.device === 'available';

function deviceChip(): string {
  const map: Record<string, [string, string]> = {
    checking: ['', 'checking'],
    available: ['ok', 'ready'],
    downloadable: ['warn', 'not downloaded'],
    downloading: ['warn', 'downloading'],
    unavailable: ['bad', 'not available'],
    'no-api': ['bad', 'not in this browser'],
  };
  const [cls, txt] = map[S.device];
  return `<span class="chip"><span class="dot ${cls}"></span>On-device model: <b>${txt}</b></span>`;
}

function render() {
  const t = thread();
  const masked = S.showMasked ? mask(threadText(t)).masked : null;
  const app = document.getElementById('app')!;
  app.innerHTML = `
  <header class="top">
    <div class="brand"><h1>Curtain</h1><p>AI help with customer messages. Personal details are masked on this device before the cloud sees the text.</p></div>
    <div class="chips">
      ${deviceChip()}
      <span class="chip"><span class="dot ${S.uid ? 'ok' : S.authError ? 'bad' : ''}"></span>Session: <b>${S.uid ? 'anonymous' : S.authError ? 'offline' : 'starting'}</b></span>
      <span class="chip">Route limit: <b>${S.routing ? S.routing.ondeviceMaxChars + ' chars' : '...'}</b>${S.routing ? ` (${S.routing.source === 'remote-config' ? 'Remote Config' : 'default'})` : ''}</span>
      <span class="chip"><span class="dot ok"></span>App Check: <b>on</b></span>
    </div>
  </header>
  ${
    S.device !== 'available' && S.device !== 'checking'
      ? `<div class="banner" role="status"><strong>No on-device model in this browser.</strong> Curtain is using its regex masker only, which can miss details it has no cue for, so the cloud may see more than with the on-device model. Before any cloud call you will see exactly what will be sent and must click to allow it.</div>`
      : ''
  }
  <main class="layout">
    <section class="panel" aria-label="Inbox">
      <h2>Inbox</h2>
      <p class="label">${esc(SHOP)}</p>
      <div class="inbox">
        ${S.threads
          .map(
            (th) => `<button class="thread-btn" data-thread="${th.id}" aria-current="${th.id === S.current}">
              <div class="who">${esc(th.messages[0].from)}</div>
              <div class="sub">${esc(th.channel)} · ${th.messages.length} message${th.messages.length > 1 ? 's' : ''}</div>
              <div>${esc(th.subject)}</div></button>`,
          )
          .join('')}
      </div>
      <button class="btn ghost paste-btn" id="paste">Paste a message</button>
    </section>

    <section class="panel" aria-label="Thread">
      <div class="row"><h2>${esc(t.subject)}</h2>
        <label class="toggle"><input type="checkbox" id="masked" ${S.showMasked ? 'checked' : ''}/> Show masked view</label></div>
      ${
        masked
          ? `<p class="label">Preview from the regex masker (the on-device model may mask more when you run a task)</p><pre class="mono">${withChips(masked)}</pre>`
          : t.messages
              .map((m) => `<div class="msg"><div class="meta"><b>${esc(m.from)}</b> · ${esc(m.at)}</div><div class="body">${esc(m.body)}</div></div>`)
              .join('')
      }
      <div class="row" style="margin-top:12px">
        ${(Object.keys(TASKS) as TaskId[])
          .map((k) => `<button class="btn" data-task="${k}" title="${esc(TASKS[k].hint)}" ${S.busy || !S.routing || S.device === 'checking' ? 'disabled' : ''}>${S.busy === k ? 'Working...' : TASKS[k].label}</button>`)
          .join('')}
      </div>
      ${resultHtml()}
    </section>

    <aside class="panel ledger" aria-label="Route ledger">
      <h2>Route ledger</h2>
      ${ledgerHtml()}
    </aside>
  </main>
  <footer>
    <p><b>You are using an AI tool.</b> Answers are AI-generated and can be wrong; a person reviews and sends every reply. Curtain helps with support messages; it does not make decisions about people. For adults (18+) at work.</p>
    <p><b>What goes to the cloud:</b> short tasks run on this device when an on-device model is available (PREFER_ON_DEVICE); masking runs on-device only (ONLY_ON_DEVICE) or with the regex masker; longer tasks send <i>masked</i> text to Gemini in the cloud. The ledger shows every route and the exact text sent. Masked text still goes to the cloud, and masking can miss details.</p>
    <p><b>Unpaid tier:</b> this demo uses the Gemini API unpaid quota, so Google may use cloud prompts to improve its products and human reviewers may read them. A production launch for users in the EEA, Switzerland or the UK needs a paid tier. Firestore keeps masked text only; the key that restores names lives in this browser's IndexedDB. Data Fiduciary under India's DPDP Act: Agri Group.</p>
    <p>All demo messages are synthetic sample data. Open source under the Apache License 2.0. <button id="forget">Forget restore keys on this device</button></p>
  </footer>`;
  wire();
}

function resultHtml(): string {
  const r = S.result;
  if (!r) return `<p class="empty" style="margin-top:14px">Pick a task. The ledger on the right will show where it ran.</p>`;
  if (!r.ok) return `<div class="result"><p class="error">${esc(r.ledger[r.ledger.length - 1]?.note ?? 'Stopped.')}</p></div>`;
  const where = r.cloudReceived ? 'Gemini in the cloud (masked text)' : 'on this device';
  return `<div class="result">
    <header><b>${TASKS[r.task].label}</b><span class="tag ai">AI-generated</span><span class="tag">ran ${where}</span></header>
    ${
      r.task === 'reply'
        ? `<p class="review">Human review before sending: edit this draft, then copy it into your own mail tool.</p>
           <textarea id="draft" aria-label="AI-generated draft reply">${esc(r.output)}</textarea>
           <div class="row"><button class="btn ghost" id="copy">Copy draft</button></div>`
        : `<div class="out">${esc(r.output)}</div>`
    }
  </div>`;
}

function ledgerHtml(): string {
  const r = S.result;
  if (!r) {
    return `<p class="empty">Every run lists: which model ran, in which mode, on the device or in the cloud, what was masked, and the exact text the cloud received.</p>`;
  }
  const cls = (l: LedgerStep) => (l.step === 'blocked' ? 'blocked' : l.ranOn === 'cloud' ? 'cloud' : l.ranOn === 'on-device' || l.ranOn === 'this browser' ? 'on-device' : '');
  const title: Record<LedgerStep['step'], string> = { mask: 'Mask', route: 'Route', answer: 'Answer', store: 'Store', blocked: 'Stopped' };
  const items = [...r.ledger];
  if (S.stored) items.push({ step: 'store', ranOn: 'cloud', note: S.stored });
  return `<ol>${items
    .map(
      (l) => `<li class="${cls(l)}"><div class="where">${title[l.step]}${l.ranOn ? ': ' + l.ranOn : ''}</div>
      ${l.mode ? `<div class="mode">${l.handle} · ${l.mode}</div>` : ''}<div>${esc(l.note)}</div></li>`,
    )
    .join('')}</ol>
    ${
      r.cloudReceived
        ? `<details class="received" open><summary>What the cloud received</summary><pre class="mono">${withChips(r.cloudReceived)}</pre></details>`
        : r.ok
          ? `<p class="label" style="margin-top:12px">No cloud call in this run.</p>`
          : ''
    }`;
}

function confirmCloud(outgoing: string, why: string): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h2>Send masked text to the cloud?</h2><p>${esc(why)}</p>
      <p class="label">Exactly this will be sent to Gemini in the cloud</p><pre class="mono">${withChips(outgoing)}</pre>
      <div class="row"><button class="btn" data-ok="1">Send masked text</button><button class="btn ghost" data-ok="0">Cancel</button></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-ok]') as HTMLElement | null;
      if (!b) return;
      d.close();
      d.remove();
      resolve(b.dataset.ok === '1');
    });
    d.addEventListener('cancel', () => {
      d.remove();
      resolve(false);
    });
    d.showModal();
  });
}

function pasteDialog() {
  const d = document.createElement('dialog');
  d.innerHTML = `<h2>Paste a customer message</h2>
    <p>Use sample data for demos. The text stays in this browser until you run a task; then the ledger shows where it went.</p>
    <textarea class="paste" aria-label="Customer message"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" data-add="1">Add to inbox</button><button class="btn ghost" data-add="0">Cancel</button></div>`;
  document.body.appendChild(d);
  d.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-add]') as HTMLElement | null;
    if (!b) return;
    const text = (d.querySelector('textarea') as HTMLTextAreaElement).value.trim();
    if (b.dataset.add === '1' && text) {
      const id = 'pasted-' + Date.now();
      S.threads.unshift({ id, subject: text.split('\n')[0].slice(0, 60) || 'Pasted message', channel: 'Pasted', messages: [{ from: 'Pasted', at: new Date().toISOString().slice(0, 16).replace('T', ' '), body: text }] });
      S.current = id;
      S.result = null;
      S.stored = null;
    }
    d.close();
    d.remove();
    render();
  });
  d.showModal();
}

async function run(task: TaskId) {
  if (!models || !S.routing) return;
  const t = thread();
  S.busy = task;
  S.stored = null;
  render();
  try {
    const priorMap = await loadMap(t.id);
    S.result = await runTask(task, threadText(t), {
      models,
      deviceReady: deviceReady(),
      ondeviceMaxChars: S.routing.ondeviceMaxChars,
      priorMap,
      confirmCloud,
    });
    await saveMap(t.id, S.result.map);
    if (S.result.ok) {
      const route = S.result.ledger.find((l) => l.step === 'answer');
      if (S.uid) {
        try {
          const id = await saveRun(S.uid, {
            task,
            threadId: t.id,
            maskedInput: S.result.maskedInput,
            maskedOutput: S.result.maskedOutput,
            route: `${route?.handle}/${route?.mode}/${route?.ranOn}`,
            maskCount: Object.keys(S.result.map).length,
          });
          S.stored = `Saved masked text only to Firestore (users/{you}/runs/${id}). The restore key stayed in this browser.`;
        } catch (e) {
          S.stored = `Not saved to Firestore (${(e as Error).message}). The answer above is unaffected.`;
        }
      } else {
        S.stored = 'Not saved: no session. The answer above is unaffected.';
      }
    }
  } finally {
    S.busy = null;
    render();
  }
}

function wire() {
  document.querySelectorAll<HTMLElement>('[data-thread]').forEach((b) =>
    b.addEventListener('click', () => {
      S.current = b.dataset.thread!;
      S.result = null;
      S.stored = null;
      render();
    }),
  );
  document.querySelectorAll<HTMLElement>('[data-task]').forEach((b) => b.addEventListener('click', () => run(b.dataset.task as TaskId)));
  document.getElementById('masked')?.addEventListener('change', (e) => {
    S.showMasked = (e.target as HTMLInputElement).checked;
    render();
  });
  document.getElementById('paste')?.addEventListener('click', pasteDialog);
  document.getElementById('copy')?.addEventListener('click', () => {
    const v = (document.getElementById('draft') as HTMLTextAreaElement).value;
    navigator.clipboard?.writeText(v);
  });
  document.getElementById('forget')?.addEventListener('click', async () => {
    await clearAllMaps();
    alert('Restore keys removed from this browser.');
  });
}

function firstRunNotice(): Promise<void> {
  try {
    if (localStorage.getItem('curtain-notice-v1') === 'ok') return Promise.resolve();
  } catch {
    /* storage blocked: show the notice every time */
  }
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h2>Before you start</h2>
      <ul>
        <li>Curtain is an AI tool for support staff (18+). Its answers are AI-generated; you review and send replies yourself.</li>
        <li>Personal details are masked on this device first. Longer tasks then send the <b>masked</b> text to Gemini in the cloud; masking can miss things, and the ledger shows exactly what was sent.</li>
        <li>This demo uses the Gemini API unpaid quota: Google may use cloud prompts to improve its products and human reviewers may read them.</li>
        <li>Firestore stores masked text only, under an anonymous session. The restore key stays in this browser.</li>
        <li>Consent notice: Agri Group is the Data Fiduciary under India's DPDP Act for this demo. Use synthetic sample data, not real customers.</li>
      </ul>
      <div class="row"><button class="btn" id="agree">I understand, continue</button></div>`;
    document.body.appendChild(d);
    d.querySelector('#agree')!.addEventListener('click', () => {
      try {
        localStorage.setItem('curtain-notice-v1', 'ok');
      } catch {
        /* ignore */
      }
      d.close();
      d.remove();
      resolve();
    });
    d.addEventListener('cancel', (e) => e.preventDefault());
    d.showModal();
  });
}

async function boot() {
  render();
  await firstRunNotice();
  await Promise.all([
    onDeviceState().then((d) => {
      S.device = d;
      render();
    }),
    loadRouting().then((r) => {
      S.routing = r;
      models = makeModels(r.cloudModel);
      render();
    }),
  ]);
  try {
    S.uid = (await signIn()).uid;
  } catch (e) {
    S.authError = (e as Error).message;
  }
  render();
}

boot();
