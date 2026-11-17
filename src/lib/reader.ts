import { deviceAvailabilityOptions, getModels } from './firebase';
import { buildReadPrompt, type ReadRequest } from './prompts';
import { redact, restore, unresolvedPlaceholders, type RedactedItem, type Person } from './redact';
import { parseReading, type MessageReading } from './schema';

export type DeviceStatus = LanguageModelAvailability | 'unsupported';

export interface ReadResult {
  reading: MessageReading;
  /** Where inference actually ran, as reported by the SDK. */
  source: 'on_device' | 'in_cloud';
  ms: number;
  /** For cloud calls: the exact prompt that left the device. */
  sentPayload?: string;
  /** Placeholders the cloud model returned that could not be mapped back. */
  unresolved?: string[];
}

export interface CloudPlan {
  prompt: string;
  items: RedactedItem[];
}

/** Checks Chrome's built-in model without triggering a download. */
export async function deviceStatus(): Promise<DeviceStatus> {
  if (typeof LanguageModel === 'undefined') return 'unsupported';
  try {
    return await LanguageModel.availability(deviceAvailabilityOptions);
  } catch {
    return 'unavailable';
  }
}

/**
 * Starts or finishes the on-device model download. Must be called from a user gesture
 * (a click in the side panel).
 */
export async function prepareDeviceModel(onProgress: (fraction: number) => void): Promise<void> {
  await getModels().onDevice.initializeDeviceModel(onProgress);
}

/** Reads a message entirely on the device. The raw text never leaves Chrome. */
export async function readOnDevice(req: ReadRequest): Promise<ReadResult> {
  const t0 = performance.now();
  const result = await getModels().onDevice.generateContent(buildReadPrompt(req));
  return {
    reading: parseReading(result.response.text()),
    source: result.response.inferenceSource === 'in_cloud' ? 'in_cloud' : 'on_device',
    ms: Math.round(performance.now() - t0),
  };
}

/**
 * Prepares a cloud request without sending it: redacts secrets and replaces the sender's name
 * with a relationship pseudonym. The caller shows `prompt` to the user for consent.
 */
export function planCloudRead(req: ReadRequest, opts: { sender?: Person; terms?: string[] }): CloudPlan {
  const { text, items } = redact(req.message, {
    people: opts.sender?.name ? [opts.sender] : [],
    terms: opts.terms,
  });
  return {
    prompt: buildReadPrompt({ message: text, relationship: req.relationship }),
    items,
  };
}

/** Sends an already-approved, redacted plan to the cloud and restores placeholders locally. */
export async function readInCloud(plan: CloudPlan): Promise<ReadResult> {
  // Last-line check: re-scan the exact outgoing payload. Anything still detectable blocks the call.
  const recheck = redact(plan.prompt);
  if (recheck.items.length) {
    throw new Error(`Blocked: ${recheck.items.length} sensitive item(s) still present in the cloud request.`);
  }

  const t0 = performance.now();
  const result = await getModels().cloud.generateContent(plan.prompt);
  const ms = Math.round(performance.now() - t0);
  const restoredJson = restore(result.response.text(), plan.items);
  return {
    reading: parseReading(restoredJson),
    source: result.response.inferenceSource === 'on_device' ? 'on_device' : 'in_cloud',
    ms,
    sentPayload: plan.prompt,
    unresolved: unresolvedPlaceholders(restoredJson),
  };
}
