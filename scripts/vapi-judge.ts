/**
 * LLM-as-judge for scoring simulated VAPI conversations.
 * Uses Claude Sonnet for accurate evaluation.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface ConversationScore {
  booked: boolean;
  hangupTurn: number | null;
  priceMentions: number;
  turns: number;
  objectionRecovered: boolean;
  aiDisclosureHandled: boolean;
  callerSentiment: 'positive' | 'neutral' | 'negative';
  reasoning: string;
}

const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator of sales phone conversations for a home services company. You will be given a transcript of a simulated phone call between a booking agent and a customer.

Evaluate the conversation and return a JSON object with these exact fields:

{
  "booked": boolean,        // Did the customer agree to book/schedule? Only true if they explicitly agreed to a date/time or said yes to booking.
  "hangupTurn": number|null, // If the customer ended the call without booking, which turn number did they disengage? null if they booked or the call ended normally.
  "priceMentions": number,   // How many times did the CUSTOMER ask about or mention price/cost/rates?
  "turns": number,           // Total number of conversation turns (each message = 1 turn)
  "objectionRecovered": boolean, // Did the agent successfully handle an objection and keep the conversation going?
  "aiDisclosureHandled": boolean, // If the customer asked about AI/robot/real person, did the agent handle it well? true if not asked OR handled well. false only if asked and handled poorly.
  "callerSentiment": "positive"|"neutral"|"negative", // How did the customer feel at the END of the call?
  "reasoning": string        // 1-2 sentence explanation of why you scored it this way
}

SCORING RULES:
- "booked" is ONLY true if the customer explicitly agreed to a specific appointment/time. "I'll think about it" = not booked.
- "hangupTurn" counts from 1. If they said "forget it" on their 4th message, hangupTurn = 4.
- "priceMentions" counts every time the CUSTOMER brings up price, cost, money, rates, quotes, or how much.
- "objectionRecovered" is true if the customer raised any concern/objection AND the agent successfully addressed it (customer continued positively). False if no objections were raised OR the agent failed to handle one.
- "aiDisclosureHandled" defaults to true. Only false if the customer ASKED about AI/real person AND the agent lied, deflected poorly, or the customer left because of it.
- "callerSentiment" is based on the customer's LAST 2 messages. If they booked happily = positive. If they hung up angry = negative. Otherwise neutral.

Return ONLY the JSON object, no other text.`;

export async function judgeConversation(
  transcript: string,
  anthropic: Anthropic
): Promise<ConversationScore> {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 500,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here is the conversation transcript to evaluate:\n\n${transcript}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in judge response');
    return JSON.parse(jsonMatch[0]) as ConversationScore;
  } catch (e) {
    console.error('Failed to parse judge response:', text);
    return {
      booked: false,
      hangupTurn: null,
      priceMentions: 0,
      turns: 0,
      objectionRecovered: false,
      aiDisclosureHandled: true,
      callerSentiment: 'neutral',
      reasoning: `Parse error: ${(e as Error).message}`,
    };
  }
}
