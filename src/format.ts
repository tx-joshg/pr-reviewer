import { ReviewResult, ReviewFinding } from './types.js';

export function formatReviewComment(
  repo: string,
  prNumber: number,
  result: ReviewResult
): string {
  const blocking = result.findings.filter((finding) => finding.severity === 'blocking');
  const suggestions = result.findings.filter((finding) => finding.severity === 'suggestion');
  const techDebt = result.findings.filter((finding) => finding.severity === 'tech_debt');

  const jsonData = JSON.stringify({
    status: result.status,
    findings: result.findings,
  });

  const lines: string[] = [
    '<!-- PR_REVIEWER_BOT -->',
    `<!-- PR_REVIEW_DATA: ${jsonData} -->`,
    '',
    `## PR Review — ${repo} #${prNumber}`,
    '',
    `### Status: ${result.status === 'approved' ? 'APPROVED' : 'CHANGES_REQUESTED'}`,
    '',
    result.summary,
    '',
  ];

  if (blocking.length > 0) {
    lines.push(`### Blocking Issues (${blocking.length})`, '');
    for (const finding of blocking) {
      lines.push(formatFinding(finding));
    }
    lines.push('');
  }

  if (suggestions.length > 0) {
    lines.push(`### Suggestions (${suggestions.length})`, '');
    for (const finding of suggestions) {
      lines.push(formatFinding(finding));
    }
    lines.push('');
  }

  if (techDebt.length > 0) {
    lines.push(`### Tech Debt (${techDebt.length})`, '');
    for (const finding of techDebt) {
      lines.push(formatFinding(finding));
    }
    lines.push('');
  }

  if (result.findings.length === 0) {
    lines.push('No issues found. Code looks good!', '');
  }

  return lines.join('\n');
}

function formatFinding(finding: ReviewFinding): string {
  const location = finding.line
    ? `\`${finding.file}:${finding.line}\``
    : `\`${finding.file}\``;

  let text = `- **[${finding.id}] ${finding.title}** | ${location} | severity: ${finding.severity}\n  ${finding.description}`;

  if (finding.suggested_fix) {
    text += `\n  \`\`\`\n  ${finding.suggested_fix}\n  \`\`\``;
  }

  return text;
}
