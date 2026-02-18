import * as core from '@actions/core';
import * as github from '@actions/github';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import OpenAI from 'openai';
import { ReviewFinding } from './types.js';

const execAsync = promisify(exec);

const AUTO_FIX_COMMIT_PREFIX = 'fix: auto-fix review suggestions';

export function isAutoFixCommit(commitMessage: string): boolean {
  return commitMessage.startsWith(AUTO_FIX_COMMIT_PREFIX);
}

export async function autoFixSuggestions(
  apiKey: string,
  model: string,
  suggestions: ReviewFinding[],
  token: string
): Promise<boolean> {
  if (suggestions.length === 0) {
    return false;
  }

  const fileGroups = new Map<string, ReviewFinding[]>();
  for (const finding of suggestions) {
    if (!finding.suggested_fix) continue;
    const existing = fileGroups.get(finding.file) ?? [];
    existing.push(finding);
    fileGroups.set(finding.file, existing);
  }

  if (fileGroups.size === 0) {
    core.info('No suggestions with concrete fixes to auto-apply');
    return false;
  }

  const client = new OpenAI({ apiKey });
  let filesChanged = 0;

  for (const [filePath, findings] of fileGroups) {
    try {
      const originalContent = await readFile(filePath, 'utf-8');

      const fixDescriptions = findings
        .map(
          (finding) =>
            `- [${finding.id}] ${finding.title} (line ~${finding.line ?? 'unknown'}): ${finding.suggested_fix}`
        )
        .join('\n');

      const response = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        messages: [
          {
            role: 'system',
            content:
              'You are a code fixer. Apply the requested fixes to the file content. Return ONLY the complete fixed file content with no explanation, no markdown fences, no commentary. Preserve all existing code that is not being fixed.',
          },
          {
            role: 'user',
            content: `Apply these fixes to the file:\n\n${fixDescriptions}\n\nOriginal file content:\n\n${originalContent}`,
          },
        ],
      });

      const fixedContent = response.choices[0]?.message?.content;
      if (!fixedContent) continue;

      let cleanContent = fixedContent;
      if (cleanContent.startsWith('```')) {
        const firstNewline = cleanContent.indexOf('\n');
        const lastFence = cleanContent.lastIndexOf('```');
        if (lastFence > firstNewline) {
          cleanContent = cleanContent.substring(firstNewline + 1, lastFence);
        }
      }

      if (cleanContent.trim() !== originalContent.trim()) {
        await writeFile(filePath, cleanContent);
        filesChanged++;
        core.info(`Auto-fixed: ${filePath} (${findings.length} suggestions applied)`);
      }
    } catch (error) {
      core.warning(`Failed to auto-fix ${filePath}: ${error}`);
    }
  }

  if (filesChanged === 0) {
    return false;
  }

  try {
    const prNumber = github.context.payload.pull_request?.number;
    const headRef = github.context.payload.pull_request?.head?.ref;

    if (!headRef) {
      core.warning('Could not determine PR head branch for auto-fix push');
      return false;
    }

    await execAsync('git config user.name "pr-reviewer[bot]"');
    await execAsync('git config user.email "pr-reviewer[bot]@users.noreply.github.com"');
    await execAsync('git add -A');
    await execAsync(
      `git commit -m "${AUTO_FIX_COMMIT_PREFIX}\n\nAuto-fixed ${filesChanged} file(s) from PR #${prNumber} review"`
    );

    const remote = `https://x-access-token:${token}@github.com/${github.context.repo.owner}/${github.context.repo.repo}.git`;
    await execAsync(`git push ${remote} HEAD:${headRef}`);

    core.info(`Pushed auto-fix commit for ${filesChanged} files`);
    return true;
  } catch (error) {
    core.warning(`Failed to push auto-fix commit: ${error}`);
    return false;
  }
}
