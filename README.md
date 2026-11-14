# Muninn

> Read between the lines, without anyone reading yours.

Muninn is a private companion for understanding messages. In Norse myth, Muninn ("memory") is one of Odin's two ravens. Muninn remembers how each person you talk to usually writes, and that memory never leaves your device.

Built for **#BuildHybridAI 2026** with the **Firebase AI Logic Hybrid Inference SDK**. It runs on-device (Gemini Nano) when a local model is available and uses the cloud (Gemini) only for opt-in deeper help, with anonymized text.

## The problem

A message like "Can we talk tomorrow?" or "ok." can ruin an evening. People who find this hardest include neurodivergent people, people working in a second language and anxious new hires. Today they either guess, or paste private work messages into public chatbots.

## What it does

1. **Open any message** in Muninn: from Gmail in Chrome, or shared from your phone.
2. **On your device**, Muninn shows:
   - **Possible readings**, never a single confident verdict ("Most likely a routine check-in; could also be about the deadline").
   - **Sender baseline**: what's normal for this person ("Dana always writes short replies. This is normal for her").
   - **Reply plan**: what to answer, plus a clarifying question you can insert with one click.
3. **Draft check** (when you ask): how your reply might read to the recipient, with options to change the tone, refine, or ignore.
4. **Deeper help in the cloud, anonymized**: the cloud sees role- and context-preserving pseudonyms like `[MANAGER · usually terse]`, never real identities. A side-by-side view shows exactly what was sent.
5. **Huginn Shield** (optional toggle): masks API keys, passwords, card numbers, emails and phone numbers when you paste into AI chatbots.

## Hybrid design

| Task | Where | Why |
|---|---|---|
| Message reading, sender baseline | On device only | Other people's private words |
| Redaction (rules first, Nano for names) | On device only | Must happen before anything leaves |
| Draft tone check | Prefer on device | Fast, free |
| Deep reasoning and rewrites | Cloud, pseudonymized | Better quality, no identities |

If no on-device model is available, Muninn does not silently send messages to the cloud. It masks secrets with fixed rules first and asks for consent with a preview of exactly what will be sent.

## Honest limits

- Detection covers common secret and PII patterns. It is not perfect; review before sending.
- Files and images are not scanned.
- Tone readings are suggestions, not facts about what the sender meant.

## Status

🚧 Early development. Day-1 goal: prove that Firebase AI Logic, App Check and Gemini Nano work together inside a Chrome extension.

## License

[Apache 2.0](LICENSE)
