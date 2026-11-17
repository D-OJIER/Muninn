import { missingConfig } from '../lib/firebase';
import {
  deviceStatus,
  planCloudRead,
  prepareDeviceModel,
  readInCloud,
  readOnDevice,
  type CloudPlan,
  type DeviceStatus,
  type ReadResult,
} from '../lib/reader';
import type { ReadRequest } from '../lib/prompts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  prepareBanner: $('prepare-banner'),
  prepareText: $('prepare-text'),
  prepareBtn: $<HTMLButtonElement>('prepare-btn'),
  prepareProgress: $<HTMLProgressElement>('prepare-progress'),
  configBanner: $('config-banner'),
  form: $<HTMLFormElement>('read-form'),
  message: $<HTMLTextAreaElement>('message'),
  sender: $<HTMLInputElement>('sender'),
  relationship: $<HTMLSelectElement>('relationship'),
  forceCloud: $<HTMLInputElement>('force-cloud'),
  readBtn: $<HTMLButtonElement>('read-btn'),
  consent: $('consent'),
  consentReason: $('consent-reason'),
  consentItems: $('consent-items'),
  consentPayload: $('consent-payload'),
  consentSend: $<HTMLButtonElement>('consent-send'),
  consentCancel: $<HTMLButtonElement>('consent-cancel'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  error: $('error'),
  result: $('result'),
  sourceBadge: $('source-badge'),
  urgency: $('urgency'),
  summary: $('summary'),
  readings: $('readings'),
  plan: $('plan'),
  clarifyBox: $('clarify-box'),
  clarify: $('clarify'),
  copyClarify: $<HTMLButtonElement>('copy-clarify'),
  unresolved: $('unresolved'),
  receiptCount: $('receipt-count'),
  receiptList: $('receipt-list'),
};

let status: DeviceStatus = 'unsupported';
let pendingPlan: { plan: CloudPlan; req: ReadRequest } | undefined;

// ---------- Status ----------

const STATUS_COPY: Record<DeviceStatus, { text: string; dot: string; banner?: string }> = {
  available: { text: 'Private mode: on-device', dot: 'device' },
  downloading: { text: 'Private mode downloading…', dot: 'cloud', banner: 'Chrome is downloading its on-device model.' },
  downloadable: { text: 'Cloud with consent', dot: 'cloud', banner: 'Download Chrome’s on-device model to read messages without anything leaving your computer.' },
  unavailable: { text: 'Cloud with consent', dot: 'cloud' },
  unsupported: { text: 'Cloud with consent', dot: 'cloud' },
};

async function refreshStatus(): Promise<void> {
  status = await deviceStatus();
  const copy = STATUS_COPY[status];
  els.statusText.textContent = copy.text;
  els.statusDot.className = `dot ${copy.dot}`;
  els.prepareBanner.hidden = !copy.banner;
  if (copy.banner) els.prepareText.textContent = copy.banner;
}

function showConfigProblems(): void {
  const missing = missingConfig();
  els.configBanner.hidden = missing.length === 0;
  if (missing.length) {
    els.configBanner.textContent = `Firebase is not configured yet. Add these to .env and rebuild: ${missing.join(', ')}.`;
  }
}

// ---------- Views ----------

function show(view: 'none' | 'consent' | 'loading' | 'error' | 'result'): void {
  els.consent.hidden = view !== 'consent';
  els.loading.hidden = view !== 'loading';
  els.error.hidden = view !== 'error';
  els.result.hidden = view !== 'result';
  els.readBtn.disabled = view === 'loading';
}

function showError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  els.error.textContent = msg;
  show('error');
  console.error(err);
}

function li(text: string): HTMLLIElement {
  const el = document.createElement('li');
  el.textContent = text;
  return el;
}

function renderResult(r: ReadResult): void {
  const { reading } = r;
  els.sourceBadge.className = `badge ${r.source}`;
  els.sourceBadge.textContent =
    r.source === 'on_device' ? `On-device · ${r.ms} ms · nothing sent` : `Cloud · anonymized · ${r.ms} ms`;
  els.urgency.textContent = `Urgency: ${reading.urgency}`;
  els.summary.textContent = reading.summary;

  els.readings.replaceChildren(
    ...reading.readings.map((rd) => {
      const item = li(rd.meaning);
      const tag = document.createElement('span');
      tag.className = 'likelihood';
      tag.textContent = `(${rd.likelihood})`;
      item.append(tag);
      return item;
    }),
  );

  els.plan.replaceChildren(
    ...reading.replyPlan.map((step) => {
      const item = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox';
      const text = document.createElement('span');
      text.textContent = step;
      item.append(box, text);
      return item;
    }),
  );

  els.clarifyBox.hidden = !reading.clarifyingQuestion;
  els.clarify.textContent = reading.clarifyingQuestion;

  const unresolved = r.unresolved ?? [];
  els.unresolved.hidden = unresolved.length === 0;
  els.unresolved.textContent = `Could not map back: ${unresolved.join(', ')}`;
  show('result');
}

// ---------- Privacy receipt ----------

interface ReceiptEntry {
  at: number;
  payload: string;
}

async function addReceipt(payload: string): Promise<void> {
  const { receipts = [] } = (await chrome.storage.session.get('receipts')) as { receipts?: ReceiptEntry[] };
  receipts.unshift({ at: Date.now(), payload });
  await chrome.storage.session.set({ receipts: receipts.slice(0, 50) });
  await renderReceipts();
}

async function renderReceipts(): Promise<void> {
  const { receipts = [] } = (await chrome.storage.session.get('receipts')) as { receipts?: ReceiptEntry[] };
  els.receiptCount.textContent = `${receipts.length} cloud call${receipts.length === 1 ? '' : 's'}`;
  els.receiptList.replaceChildren(
    ...receipts.map((r) => {
      const item = document.createElement('li');
      const when = document.createElement('div');
      when.className = 'muted small';
      when.textContent = new Date(r.at).toLocaleTimeString();
      const pre = document.createElement('pre');
      pre.textContent = r.payload;
      item.append(when, pre);
      return item;
    }),
  );
}

// ---------- Flow ----------

function currentRequest(): ReadRequest {
  return {
    message: els.message.value.trim(),
    relationship: els.relationship.selectedOptions[0]?.textContent?.toLowerCase() ?? 'colleague',
  };
}

async function onRead(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const message = els.message.value.trim();
  if (!message) return;
  if (missingConfig().length) return showConfigProblems();

  const sender = els.sender.value.trim();
  await refreshStatus();

  if (status === 'available' && !els.forceCloud.checked) {
    show('loading');
    els.loadingText.textContent = 'Reading on your device…';
    try {
      renderResult(await readOnDevice(currentRequest()));
    } catch (err) {
      showError(err);
    }
    return;
  }

  // Cloud path: never silent. Redact, show exactly what would be sent, wait for consent.
  const req = currentRequest();
  const plan = planCloudRead(req, {
    sender: sender ? { name: sender, label: els.relationship.value } : undefined,
  });
  pendingPlan = { plan, req };
  els.consentReason.textContent = els.forceCloud.checked
    ? 'Testing mode: sending to the cloud even though private mode is available.'
    : 'Private mode is not available on this computer, so this message would be read in the cloud. Names and secrets are replaced first.';
  els.consentItems.replaceChildren(
    ...(plan.items.length
      ? plan.items.map((i) => li(`${i.placeholder} ← ${i.kind.toLowerCase().replace('_', ' ')}`))
      : [li('No names or secrets detected')]),
  );
  els.consentPayload.textContent = plan.prompt;
  show('consent');
}

async function onConsentSend(): Promise<void> {
  if (!pendingPlan) return;
  const { plan } = pendingPlan;
  pendingPlan = undefined;
  show('loading');
  els.loadingText.textContent = 'Reading in the cloud (anonymized)…';
  try {
    const result = await readInCloud(plan);
    await addReceipt(plan.prompt);
    renderResult(result);
  } catch (err) {
    showError(err);
  }
}

async function onPrepare(): Promise<void> {
  if (missingConfig().length) return showConfigProblems();
  els.prepareBtn.disabled = true;
  els.prepareProgress.hidden = false;
  try {
    await prepareDeviceModel((fraction) => {
      els.prepareProgress.value = fraction;
      els.prepareText.textContent = `Downloading on-device model… ${Math.round(fraction * 100)}%`;
    });
  } catch (err) {
    showError(err);
  } finally {
    els.prepareBtn.disabled = false;
    els.prepareProgress.hidden = true;
    await refreshStatus();
  }
}

// Text sent from the right-click menu ("Ask Muninn about this message").
async function takePendingMessage(): Promise<void> {
  const { pendingMessage } = (await chrome.storage.session.get('pendingMessage')) as {
    pendingMessage?: { text: string };
  };
  if (!pendingMessage?.text) return;
  els.message.value = pendingMessage.text;
  show('none');
  await chrome.storage.session.remove('pendingMessage');
  els.message.focus();
}

// ---------- Wire up ----------

els.form.addEventListener('submit', (e) => void onRead(e));
els.consentSend.addEventListener('click', () => void onConsentSend());
els.consentCancel.addEventListener('click', () => {
  pendingPlan = undefined;
  show('none');
});
els.prepareBtn.addEventListener('click', () => void onPrepare());
els.copyClarify.addEventListener('click', () => {
  void navigator.clipboard.writeText(els.clarify.textContent ?? '');
  els.copyClarify.textContent = 'Copied';
  setTimeout(() => (els.copyClarify.textContent = 'Copy'), 1500);
});
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pendingMessage?.newValue) void takePendingMessage();
});

showConfigProblems();
void refreshStatus();
void renderReceipts();
void takePendingMessage();
