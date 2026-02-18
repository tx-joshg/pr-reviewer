import OpenAI from 'openai';
import { ReviewConfig, ReviewResult, PRDetails } from './types.js';
import { buildSystemPrompt, buildUserMessage } from './prompts.js';

const REVIEW_FUNCTION = {
  type: 'function' as const,
  name: 'submit_review',
  description: 'Submit the structured PR review with categorized findings',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['approved', 'changes_requested'],
        description: 'Overall review status. "approved" only if zero blocking findings.',
      },
      summary: {
        type: 'string',
        description: 'Brief 2-3 sentence summary of the review.',
      },
      findings: {
        type: 'array',
        description: 'All findings from the review, categorized by severity.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description:
                'Unique ID: B1, B2... for blocking, S1, S2... for suggestion, T1, T2... for tech_debt',
            },
            title: { type: 'string', description: 'Short title of the finding' },
            file: { type: 'string', description: 'File path relative to repo root' },
            line: {
              type: 'number',
              description: 'Approximate line number, or null if not applicable',
            },
            severity: {
              type: 'string',
              enum: ['blocking', 'suggestion', 'tech_debt'],
              description:
                'blocking = must fix before merge, suggestion = auto-fixable trivial issue, tech_debt = tracked as issue',
            },
            description: {
              type: 'string',
              description: 'Detailed description of the issue and why it matters',
            },
            suggested_fix: {
              type: 'string',
              description:
                'For suggestions: the corrected code snippet. For blocking: guidance on how to fix.',
            },
          },
          required: ['id', 'title', 'file', 'severity', 'description'],
        },
      },
    },
    required: ['status', 'summary', 'findings'],
  },
};

export class Reviewer {
  private client: OpenAI;
  private config: ReviewConfig;
  private model: string;

  constructor(apiKey: string, config: ReviewConfig, model: string) {
    this.client = new OpenAI({ apiKey });
    this.config = config;
    this.model = model;
  }

  async review(pr: PRDetails): Promise<ReviewResult> {
    const systemPrompt = buildSystemPrompt(this.config);
    const userMessage = buildUserMessage(pr.title, pr.body, pr.commits, pr.diff, pr.files);

    const response = await this.client.responses.create({
      model: this.model,
      instructions: systemPrompt,
      input: userMessage,
      tools: [REVIEW_FUNCTION],
      tool_choice: { type: 'function', name: 'submit_review' },
    });

    const functionCall = response.output.find(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === 'function_call' && item.name === 'submit_review'
    );

    if (!functionCall) {
      throw new Error('Model did not return a structured review via submit_review function');
    }

    const result: ReviewResult = JSON.parse(functionCall.arguments);

    const hasBlocking = result.findings.some((finding) => finding.severity === 'blocking');
    if (hasBlocking && result.status === 'approved') {
      result.status = 'changes_requested';
    }

    return result;
  }
}
