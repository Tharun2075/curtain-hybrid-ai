# Curtain

Curtain is a support-inbox helper. Personal details in a customer thread are masked on your device first. Only the masked text can reach Gemini in the cloud, and the answer is restored in your browser from a key that stays in this browser.

Built with Firebase AI Logic hybrid inference (web), for the Build with Hybrid AI (Firebase) 2026 contest. Licence: Apache-2.0. Entrant: Agri Group.

**Try it:** preview URL https://curtain-agrigroup--agrigroup-preview-mq1l83wq.web.app (Firebase Hosting preview channel, expires 2026-12-18; the live URL <HOSTING_URL> is published at submission).

## What it does

- **Inbox with synthetic data.** Four made-up threads from a made-up shop, "Loomhouse Linens (sample shop)". You can also paste a message.
- **Three tasks:**
  - Summarise thread.
  - Extract fields.
  - Draft reply. The draft is labelled AI-generated, opens in an editable box and needs human review before sending.
- **Route ledger.** Every run lists which model handle ran, its inference mode, and whether it ran on the device or in the cloud. A "What the cloud received" block shows the exact masked prompt.
- **No-Nano warning.** If this browser has no on-device model, a banner says so. Masking then uses the regex floor only. Before any cloud call, a dialog shows the exact outgoing text, and nothing is sent until you click to confirm.

## The three Firebase AI Logic model handles

All three are created in `src/firebase.ts` (`makeModels`, `src/firebase.ts:82-84`) and called in `src/pipeline.ts` (`runTask`: masker at `src/pipeline.ts:134`, short/cloud at `src/pipeline.ts:211`). The SDK import is `src/firebase.ts:9`.

| Handle | Mode | Gets | Used for |
|---|---|---|---|
| `masker` | `InferenceMode.ONLY_ON_DEVICE` | raw text | finding names, addresses and similar details the regex cannot catch; the SDK throws rather than fall back to the cloud |
| `short` | `InferenceMode.PREFER_ON_DEVICE` | masked text | short tasks when an on-device model is available |
| `cloud` | `InferenceMode.ONLY_IN_CLOUD` (`gemini-3.5-flash-lite`) | masked text | long synthesis, and every task when no on-device model exists |

Pipeline (`src/pipeline.ts`):

1. **Mask.** The on-device model (when present) and the regex floor (`src/masker.ts`) mask the text.
2. **Leak check.** If any known value is still visible, the run is blocked.
3. **Route.** The route depends on the masked prompt size. The limit is `ondevice_max_chars` from Remote Config, default 1800.
4. **Confirm.** If masking ran without the on-device model (no Nano, or the on-device masker failed), the user must click before any model call that could reach the cloud, including the `PREFER_ON_DEVICE` route.
5. **Call and restore.** The model is called on masked text, and the answer is restored from the IndexedDB key map.

Firebase services used:
- App Check with reCAPTCHA Enterprise.
- Anonymous Auth.
- Firestore, which stores masked text only, under `users/{uid}/runs` (rules in `firestore.rules`).
- Remote Config, with keys `ondevice_max_chars` and `cloud_model`. It falls back to the documented defaults within 5 s.

## Run locally

```
npm install
cp .env.example .env.local   # paste the App Check debug token; .env.local is git-ignored, never commit it
npm run dev
npm test                     # masker, key map and pipeline tests (vitest)
npm run test:rules           # Firestore rules check in the emulator (port 8188); needs the firebase CLI (npm i -g firebase-tools) and Java
npm run build
```

On-device inference needs Chrome with the Prompt API (Gemini Nano) enabled. Without it, Curtain runs on the regex floor and asks before each cloud call.

## Testing App Check (for reviewers)

- **Hosted app:** a normal desktop Chrome passes App Check (reCAPTCHA Enterprise) on its own. Open the preview or hosting URL and run a task; no token is needed.
- **Local run or a headless/automated browser:** App Check blocks the cloud call unless the browser is registered with a debug token.
  1. In the Firebase console, open the project, then App Check > Apps > the web app > menu > Manage debug tokens > Add debug token. Copy the token (it is a secret: do not paste it into issues, screenshots or commits).
  2. `cp .env.example .env.local` and set `VITE_APPCHECK_DEBUG_TOKEN` to that token. `.env.local` is git-ignored.
  3. `npm run dev`. The token is read only in dev builds (`import.meta.env.DEV`, `src/firebase.ts:17`); production builds never contain it.
  4. Check: the cloud call succeeds with the token, and fails with an App Check error once you remove it (or delete the token in the console).
- Judges who need a debug token for the hosted project can ask the entrant; it is sent privately and revoked after judging. No real token appears in this repository.

## Public config (not secrets)

`src/firebase-config.json` holds the Firebase web config (API key, app id), and `src/firebase.ts:13` holds the reCAPTCHA Enterprise **site** key. These are public by design: they are shipped to every browser and are protected by App Check, Firestore rules and the reCAPTCHA allowed-domains list. They are allow-listed by exact value in `.gitleaks.toml`. No server secret, service account or debug token is in the repo.

## Notices

- **AI tool.** Curtain is an AI tool for support staff aged 18 or over. Answers are AI-generated and can be wrong. A person reviews and sends every reply, and Curtain makes no decisions about people.
- **Where text goes.** Raw text goes only to the on-device masker. Masked text may go to Gemini in the cloud (`PREFER_ON_DEVICE` fallback or `ONLY_IN_CLOUD`), and the ledger shows each time it did. The regex floor can miss names it has no cue for.
- **Unpaid tier.** This demo uses the Gemini API unpaid tier, so Google may use cloud prompts to improve its products, and human reviewers may read them. A launch for users in the EEA, Switzerland or the UK needs a paid tier.
- **Storage.** Firestore keeps masked text only. The restore key map stays in this browser's IndexedDB, and "Forget restore keys" deletes it.
- **DPDP consent notice.** Agri Group is the Data Fiduciary under India's DPDP Act for this demo. Use synthetic data only.
- **App Check.** Requests are protected by Firebase App Check with reCAPTCHA Enterprise.

## Open-source search (reuse before building)

I searched GitHub code for `InferenceMode.ONLY_ON_DEVICE`, searched repos for "firebase ai logic hybrid", and searched npm for PII redaction.

- **firebase/firebase-js-sdk** (Apache-2.0). Used as the `firebase` dependency.
- **firebase/quickstart-js** (Apache-2.0). Has no hybrid sample, so there was nothing to adapt.
- **Several 0-star contest repos.** Not reused: they are immature and have unclear licences.
- **npm `redact-pii`** (MIT). Not used: it is Node-only, depends on `@google-cloud/dlp`, and has no reversible key map.

The masker (`src/masker.ts`) was therefore written from scratch. It also masks UPI ids and other `name@handle` ids, IBAN-like ids, links and partial card numbers, and never masks the shop's own name or titles such as "Mr.".

## Status

- Hosting: site `curtain-agrigroup` (see `firebase.json`); only a preview channel is deployed, nothing is live yet. Firestore rules are not deployed, so saving runs fails with "permission denied" until `firebase deploy --only firestore:rules` is run. The app keeps working and notes this in the ledger.
- The Remote Config parameters are not created in the console, so the defaults are used.
- The brand lock is a proposal (`brand/BRAND.lock.proposed`) until it is initialised.
