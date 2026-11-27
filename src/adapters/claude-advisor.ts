// Live advisor adapter backed by the Claude API.
//
// The model only ever sees the bounded AdvisorInput (states, normalized failure
// labels, policy version and the deterministic eligible set) and returns JSON text.
// That text is NOT trusted here: it goes through the same strict validator in
// src/advisor.ts as every other advisor, so an invalid, out-of-set, timed-out or
// refused answer falls back to the fixed rules. Nothing in this file can widen the
// eligible set, dispatch anything or see customer data.
//
// The pipeline's advisor port is synchronous, so the live model is used in two
// steps: precomputeAdvice() asks the model (async), then replayAdvisor() serves
// those answers to the unchanged synchronous pipeline. Live webhook processing does
// not call the model; it still uses fixed rules.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import type { Advisor, AdvisorInput } from '../advisor.ts';

export const DEFAULT_ADVISOR_MODEL = 'claude-opus-5-5';

/** The one SDK call the adapter needs; tests inject a mock with the same shape. */
export type MessagesClient = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): Promise<Anthropic.Message>;
  };
};

export type LiveAdvisor = {
  name: string;
  version: string;
  configVersion: string;
  rankAsync(input: AdvisorInput): Promise<unknown>;
};

const SYSTEM = `You rank recovery actions for a failed subscription payment.
You receive JSON with the case state, a normalized failure label and eligibleActions.
Choose exactly one action from eligibleActions. Never invent an action.
Prefer the least intrusive action that can plausibly fix the failure. If the input
does not support a confident choice, set "abstain": true.
Reply with only one JSON object, no prose and no code fence, with exactly these keys:
{"schemaVersion":"1.0","selectedAction":"<one of eligibleActions>","reasonCodes":["SHORT_UPPER_SNAKE"],"rationale":"<= 200 characters","confidence":<number 0..1>,"abstain":<boolean>}`;

export const inputKey = (input: AdvisorInput) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

export function createClaudeAdvisor(
  options: {
    client?: MessagesClient;
    model?: string;
    timeoutMs?: number;
  } = {},
): LiveAdvisor {
  const model = options.model ?? DEFAULT_ADVISOR_MODEL;
  const timeoutMs = options.timeoutMs ?? 30_000;
  // new Anthropic() resolves credentials from the environment (ANTHROPIC_API_KEY,
  // ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile). Never hardcode a key.
  const client = options.client ?? new Anthropic({ maxRetries: 1 });
  return {
    name: 'claude-advisor',
    version: model,
    configVersion: 'prompt-v1',
    async rankAsync(input) {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 4000,
          output_config: { effort: 'low' }, // a short classification, not deep reasoning
          system: SYSTEM,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        },
        { timeout: timeoutMs },
      );
      // A refusal or truncated answer is not advice; the caller falls back to fixed rules.
      if (response.stop_reason !== 'end_turn')
        throw new Error(`model stopped: ${response.stop_reason}`);
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      // Parse only. Validation (fields, eligible set, confidence) happens in advise().
      return JSON.parse(text);
    },
  };
}

export type PrecomputedAdvice = Map<string, { output: unknown } | { error: string }>;

/** Asks the live advisor once per distinct input, with a hard timeout per call. */
export async function precomputeAdvice(
  advisor: LiveAdvisor,
  inputs: AdvisorInput[],
  timeoutMs = 30_000,
  into: PrecomputedAdvice = new Map(),
): Promise<PrecomputedAdvice> {
  for (const input of inputs) {
    const key = inputKey(input);
    if (into.has(key)) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([
        advisor.rankAsync(input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('advisor timeout')), timeoutMs);
        }),
      ]);
      into.set(key, { output });
    } catch (error) {
      into.set(key, { error: error instanceof Error ? error.message : 'advisor error' });
    } finally {
      clearTimeout(timer);
    }
  }
  return into;
}

/**
 * Synchronous advisor for the pipeline that serves precomputed answers. A missing
 * answer or a recorded error throws, which advise() turns into the fixed-rule fallback.
 */
export function replayAdvisor(
  live: Pick<LiveAdvisor, 'name' | 'version' | 'configVersion'>,
  advice: PrecomputedAdvice,
  onMissing?: (input: AdvisorInput) => void,
): Advisor {
  return {
    name: live.name,
    version: live.version,
    configVersion: live.configVersion,
    rank(input) {
      const found = advice.get(inputKey(input));
      if (!found) {
        onMissing?.(input);
        throw new Error('no precomputed advice');
      }
      if ('error' in found) throw new Error(found.error);
      return found.output;
    },
  };
}
