import * as core from '@actions/core';
import * as github from '@actions/github';
import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import { GitHubClient } from './github.js';
import { Reviewer } from './reviewer.js';
import { ReviewConfig } from './types.js';
import { isAutoFixCommit, autoFixSuggestions } from './auto-fixer.js';

async function run(): Promise<void> {
  try {
    const openaiApiKey = core.getInput('openai_api_key', { required: true });
    const githubToken = core.getInput('github_token', { required: true });
    const configPath = core.getInput('review_config', { required: true });
    const autoFixEnabled = core.getInput('auto_fix') !== 'false';
    const model = core.getInput('model');

    const prNumber = github.context.payload.pull_request?.number;
    if (!prNumber) {
      core.setFailed('This action must be triggered by a pull_request event');
      return;
    }

    core.info(`Reviewing PR #${prNumber}...`);

    const configContent = await readFile(configPath, 'utf-8');
    const config: ReviewConfig = parseYaml(configContent);

    const ghClient = new GitHubClient(githubToken);
    const reviewer = new Reviewer(openaiApiKey, config, model);

    await ghClient.ensureLabelsExist();

    const pr = await ghClient.getPRDetails(prNumber);

    const latestCommitMessage = pr.commits.at(-1)?.message ?? '';
    const isAutoFix = isAutoFixCommit(latestCommitMessage);
    if (isAutoFix) {
      core.info('Latest commit is an auto-fix — skipping auto-fix to prevent loops');
    }

    await ghClient.setCommitStatus(pr.head_sha, 'pending', 'Review in progress...');

    core.info(`PR "${pr.title}" — ${pr.files.length} files changed, ${pr.commits.length} commits`);

    const result = await reviewer.review(pr);

    core.info(`Review complete: ${result.status} — ${result.findings.length} findings`);

    const blocking = result.findings.filter((finding) => finding.severity === 'blocking');
    const suggestions = result.findings.filter((finding) => finding.severity === 'suggestion');
    const techDebt = result.findings.filter((finding) => finding.severity === 'tech_debt');

    if (autoFixEnabled && !isAutoFix && suggestions.length > 0) {
      core.info(`Attempting auto-fix for ${suggestions.length} suggestions...`);
      const pushed = await autoFixSuggestions(openaiApiKey, model, suggestions, githubToken);
      if (pushed) {
        core.info('Auto-fix commit pushed — this will trigger a re-review');
        await ghClient.setCommitStatus(
          pr.head_sha,
          'pending',
          'Auto-fix applied, awaiting re-review'
        );
        return;
      }
    }

    for (const finding of techDebt) {
      try {
        const issueNumber = await ghClient.createIssue(finding, prNumber);
        core.info(`Created tech debt issue #${issueNumber}: ${finding.title}`);
      } catch (error) {
        core.warning(`Failed to create issue for ${finding.id}: ${error}`);
      }
    }

    await ghClient.postReview(prNumber, result);

    const statusState = blocking.length > 0 ? 'failure' : 'success';
    const statusDesc =
      blocking.length > 0
        ? `${blocking.length} blocking issue(s) found`
        : 'Review passed';

    await ghClient.setCommitStatus(pr.head_sha, statusState, statusDesc);

    core.info(`Posted review: ${result.status}`);
    core.info(`  Blocking: ${blocking.length}`);
    core.info(`  Suggestions: ${suggestions.length}`);
    core.info(`  Tech debt: ${techDebt.length}`);

    if (blocking.length > 0) {
      core.setFailed(`PR review found ${blocking.length} blocking issue(s)`);
    }
  } catch (error) {
    core.setFailed(`PR review failed: ${error}`);
  }
}

run();
