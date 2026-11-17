# Muninn

> Read between the lines, without anyone reading yours.

Muninn is a private assistant for understanding work messages. In Norse myth, Muninn is one of Odin's two ravens: it flies out, reads the world, and brings back what it learned. Muninn reads a message for you and brings back what it means, without the message having to leave your computer.

Built for **#BuildHybridAI 2026** with the **Firebase AI Logic Hybrid Inference SDK**. It runs on-device (Gemini Nano) when a local model is available and uses the cloud (Gemini) only with your consent, and only with anonymized text.

## The problem

At work, short or ambiguous messages ("Can we talk tomorrow?", "Per my last email", "ok.") cost time and focus. This is hardest for people working in a second language, new hires, remote teams, and neurodivergent professionals. Many paste these messages into public chatbots for help, which exposes colleagues' names, clients and internal projects, and is why many companies ban those tools.

## What it does

1. **Open any work message** in Muninn: select it on any page and right-click, or paste it into the side panel.
2. **On your device**, Muninn shows:
   - **A summary and urgency** level.
   - **Possible readings**, never a single confident verdict ("Most likely a routine check-in; could also be about the deadline").
   - **A reply plan**, plus a professional clarifying question you can copy.
3. **Draft check** (planned): how your reply might read to the recipient, with options to change the tone, refine, or ignore.
4. **Cloud only with consent, anonymized**: people become role pseudonyms like `[MANAGER_1]` and secrets are masked. You see exactly what will be sent before anything leaves.
5. **Huginn Shield** (optional toggle): masks API keys, passwords, card numbers, emails and phone numbers when you paste into AI chatbots.

## Hybrid design

| Task | Where | Why |
|---|---|---|
| Message reading | On device only | Colleagues' and clients' private words |
| Redaction (rules first, Nano for names) | On device only | Must happen before anything leaves |
| Draft tone check | Prefer on device | Fast, free |
| Deep reasoning and rewrites | Cloud, pseudonymized | Better quality, no identities |

If no on-device model is available, Muninn does not silently send messages to the cloud. It masks secrets with fixed rules first and asks for consent with a preview of exactly what will be sent.

## Honest limits

- Detection covers common secret and PII patterns. It is not perfect; review before sending.
- Files and images are not scanned.
- Tone readings are suggestions, not facts about what the sender meant.

## How Muninn routes each request

Muninn does not use `PREFER_ON_DEVICE`, because a silent fallback would send a raw message to the cloud. Instead it creates two Firebase AI Logic models and picks one explicitly:

1. **Chrome's on-device model is available:** `InferenceMode.ONLY_ON_DEVICE`. The raw message stays on the computer. Muninn does not store messages.
2. **Otherwise:** the message is redacted on the device, people become relationship pseudonyms like `[MANAGER_1]`, and the user sees **exactly** what would be sent. Only after they click "Send anonymized" does `InferenceMode.ONLY_IN_CLOUD` run. The outgoing payload is re-scanned first, and placeholders are restored locally in the answer.
3. Every response shows where it ran, using the SDK's `inferenceSource`. The **Privacy receipt** lists every cloud payload.

## Project layout

```
public/manifest.json      MV3 manifest (no host permissions)
sidepanel.html            Side panel UI
src/background.ts         Toolbar button + "Ask Muninn about this message" context menu
src/sidepanel/main.ts     UI flow: status, consent, results, privacy receipt
src/lib/firebase.ts       Firebase app, App Check, on-device and cloud models
src/lib/reader.ts         Routing, device status, cloud consent plan, placeholder restore
src/lib/redact.ts         Rule-based redaction (keys, cards, emails, phones, people, terms)
src/lib/prompts.ts        Prompt that treats the message as untrusted data
src/lib/schema.ts         Structured output schema + output sanitizing
tests/                    Vitest unit tests
```

## Setup

**Requirements:** Node 22+, desktop Chrome 139+.

1. **Firebase project**
   - Create a project in the [Firebase console](https://console.firebase.google.com/) and add a **Web app**.
   - Open **AI Logic** and enable the **Gemini Developer API**.
   - Open **Security > App Check** and make sure Firebase AI Logic is **enforced**.
2. **Configure**
   ```bash
   cp .env.example .env
   ```
   Fill in the Web app config values.
3. **Build**
   ```bash
   npm install
   npm run build
   ```
4. **Load the extension:** go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `dist/` folder.
5. **App Check debug token**
   - Open the side panel, right-click it, choose **Inspect**, and read the debug token printed in the console after your first request.
   - Register it in Firebase console > **Security > App Check > Apps > Manage debug tokens**.
   - Put it in `.env` as `VITE_APPCHECK_DEBUG_TOKEN` and rebuild.
6. **On-device model (optional, for private mode)**
   - Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart Chrome.
   - In the side panel, click **Enable private mode** to download the model.
   - Your hardware must meet Chrome's requirements for its built-in AI.

Run tests with `npm test`.

## Status

🚧 Early development (day-1 feasibility build): side panel, explicit on-device/cloud routing, consent screen, redaction, and the privacy receipt.

## License

[Apache 2.0](LICENSE)
