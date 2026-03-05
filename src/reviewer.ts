import { LLMProvider } from './llm/index.js';
import { ReviewConfig, ReviewResult, PRDetails } from './types.js';
import { buildSystemPrompt, buildUserMessage } from './prompts.js';

const REVIEW_PARAMETERS: Record<string, unknown> = {
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
};

const REVIEW_REQUIRED_FIELDS = ['status', 'summary', 'findings'];

export class Reviewer {
  private provider: LLMProvider;
  private config: ReviewConfig;

  constructor(provider: LLMProvider, config: ReviewConfig) {
    this.provider = provider;
    this.config = config;
  }

  async review(pr: PRDetails, excludedFiles?: string[]): Promise<ReviewResult> {
    const systemPrompt = buildSystemPrompt(this.config);
    const userMessage = buildUserMessage(pr.title, pr.body, pr.commits, pr.diff, pr.files, excludedFiles);

    const result = await this.provider.generateStructured<ReviewResult>({
      systemPrompt,
      userMessage,
      functionName: 'submit_review',
      functionDescription: 'Submit the structured PR review with categorized findings',
      parameters: REVIEW_PARAMETERS,
      requiredFields: REVIEW_REQUIRED_FIELDS,
    });

    const hasBlocking = result.findings.some((finding) => finding.severity === 'blocking');
    if (hasBlocking && result.status === 'approved') {
      result.status = 'changes_requested';
    }

    return result;
  }
}
