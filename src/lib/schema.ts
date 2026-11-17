import { Schema } from 'firebase/ai';

export type Likelihood = 'likely' | 'possible' | 'less likely';
export type Urgency = 'low' | 'medium' | 'high';

export interface MessageReading {
  summary: string;
  urgency: Urgency;
  readings: { meaning: string; likelihood: Likelihood }[];
  replyPlan: string[];
  clarifyingQuestion: string;
}

const LIKELIHOOD: Likelihood[] = ['likely', 'possible', 'less likely'];
const URGENCY: Urgency[] = ['low', 'medium', 'high'];

/** Structured output schema for the cloud model (Gemini responseSchema). */
export const cloudSchema = Schema.object({
  properties: {
    summary: Schema.string(),
    urgency: Schema.enumString({ enum: URGENCY }),
    readings: Schema.array({
      items: Schema.object({
        properties: {
          meaning: Schema.string(),
          likelihood: Schema.enumString({ enum: LIKELIHOOD }),
        },
      }),
    }),
    replyPlan: Schema.array({ items: Schema.string() }),
    clarifyingQuestion: Schema.string(),
  },
});

/** The same shape as a plain JSON schema, for the on-device Prompt API responseConstraint. */
export const deviceSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    urgency: { type: 'string', enum: URGENCY },
    readings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          meaning: { type: 'string' },
          likelihood: { type: 'string', enum: LIKELIHOOD },
        },
        required: ['meaning', 'likelihood'],
      },
    },
    replyPlan: { type: 'array', items: { type: 'string' } },
    clarifyingQuestion: { type: 'string' },
  },
  required: ['summary', 'urgency', 'readings', 'replyPlan', 'clarifyingQuestion'],
};

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Removes links: a received message is untrusted, so Muninn never tells anyone to click anything. */
function stripLinks(s: string): string {
  return s.replace(URL_RE, '[link removed]').trim();
}

/** Parses and sanity-checks model output. Throws if it is not usable. */
export function parseReading(raw: string): MessageReading {
  const json = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const data = JSON.parse(json) as Partial<MessageReading>;
  if (typeof data.summary !== 'string' || !Array.isArray(data.readings)) {
    throw new Error('Model response did not match the expected shape');
  }
  return {
    summary: stripLinks(data.summary),
    urgency: URGENCY.includes(data.urgency as Urgency) ? (data.urgency as Urgency) : 'medium',
    readings: data.readings
      .filter((r) => r && typeof r.meaning === 'string')
      .slice(0, 3)
      .map((r) => ({
        meaning: stripLinks(r.meaning),
        likelihood: LIKELIHOOD.includes(r.likelihood) ? r.likelihood : 'possible',
      })),
    replyPlan: (Array.isArray(data.replyPlan) ? data.replyPlan : [])
      .filter((s): s is string => typeof s === 'string')
      .slice(0, 4)
      .map(stripLinks),
    clarifyingQuestion: typeof data.clarifyingQuestion === 'string' ? stripLinks(data.clarifyingQuestion) : '',
  };
}
