import * as core from '@actions/core';
import * as github from '@actions/github';
import { ReviewResult, ReviewFinding, PRDetails } from './types.js';
import { formatReviewComment } from './format.js';

type Octokit = ReturnType<typeof github.getOctokit>;

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string) {
    this.octokit = github.getOctokit(token);
    this.owner = github.context.repo.owner;
    this.repo = github.context.repo.repo;
  }

  async getPRDetails(prNumber: number): Promise<PRDetails> {
    const [prResponse, filesResponse, commitsResponse] = await Promise.all([
      this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      }),
      this.octokit.rest.pulls.listFiles({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
      }),
      this.octokit.rest.pulls.listCommits({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
      }),
    ]);

    const diffResponse = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    });

    return {
      number: prNumber,
      title: prResponse.data.title,
      body: prResponse.data.body ?? '',
      diff: diffResponse.data as unknown as string,
      files: filesResponse.data.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      })),
      commits: commitsResponse.data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
      })),
      base_branch: prResponse.data.base.ref,
      head_branch: prResponse.data.head.ref,
      head_sha: prResponse.data.head.sha,
    };
  }

  async postReview(prNumber: number, result: ReviewResult): Promise<void> {
    const body = formatReviewComment(this.repo, prNumber, result);

    await this.deleteExistingReviews(prNumber);

    if (result.status === 'approved') {
      try {
        await this.octokit.rest.pulls.createReview({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
          body,
          event: 'APPROVE',
        });
        return;
      } catch {
        core.info('APPROVE not permitted by token — posting as COMMENT instead');
      }
    }

    await this.octokit.rest.pulls.createReview({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      body,
      event: result.status === 'approved' ? 'COMMENT' : 'REQUEST_CHANGES',
    });
  }

  async createIssue(finding: ReviewFinding, prNumber: number): Promise<number> {
    const response = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: `[Tech Debt] ${finding.title}`,
      body: `**Source:** PR #${prNumber}\n**File:** \`${finding.file}\`${finding.line ? `:${finding.line}` : ''}\n\n${finding.description}\n\n${finding.suggested_fix ? `**Suggested approach:**\n\`\`\`\n${finding.suggested_fix}\n\`\`\`` : ''}`,
      labels: ['tech-debt', 'automated'],
    });
    return response.data.number;
  }

  async setCommitStatus(
    sha: string,
    state: 'error' | 'success' | 'failure' | 'pending',
    description: string
  ): Promise<void> {
    await this.octokit.rest.repos.createCommitStatus({
      owner: this.owner,
      repo: this.repo,
      sha,
      state,
      description,
      context: 'pr-review',
    });
  }

  async ensureLabelsExist(): Promise<void> {
    const labels = [
      { name: 'tech-debt', color: 'fbca04', description: 'Technical debt tracked by PR reviewer' },
      { name: 'automated', color: 'e6e6e6', description: 'Created by automated tooling' },
    ];

    for (const label of labels) {
      try {
        await this.octokit.rest.issues.getLabel({
          owner: this.owner,
          repo: this.repo,
          name: label.name,
        });
      } catch {
        await this.octokit.rest.issues.createLabel({
          owner: this.owner,
          repo: this.repo,
          name: label.name,
          color: label.color,
          description: label.description,
        });
      }
    }
  }

  private async deleteExistingReviews(prNumber: number): Promise<void> {
    const reviews = await this.octokit.rest.pulls.listReviews({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    for (const review of reviews.data) {
      if (review.body?.includes('<!-- PR_REVIEWER_BOT -->')) {
        try {
          await this.octokit.rest.pulls.dismissReview({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
            review_id: review.id,
            message: 'Superseded by new review',
          });
        } catch {
          // Approved reviews can't be dismissed — that's fine
        }
      }
    }
  }
}
