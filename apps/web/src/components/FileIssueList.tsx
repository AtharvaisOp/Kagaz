import type { FileLoadIssue } from '../features/pdf-workspace/loading/types';

export function FileIssueList({
  issues,
}: {
  readonly issues: readonly FileLoadIssue[];
}) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="file-issues" role="alert" aria-live="polite">
      <div className="file-issues-heading">
        <span className="file-issues-mark" aria-hidden="true">
          !
        </span>
        <span>Some files need attention</span>
      </div>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.fileName}-${index}`}>
            <strong>{issue.fileName}</strong>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
