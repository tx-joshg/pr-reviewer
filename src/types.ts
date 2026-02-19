export type Severity = 'blocking' | 'suggestion' | 'tech_debt';

export interface ReviewFinding {
  id: string;
  title: string;
  file: string;
  line: number | null;
  severity: Severity;
  description: string;
  suggested_fix: string | null;
}

export interface ReviewResult {
  status: 'approved' | 'changes_requested';
  summary: string;
  findings: ReviewFinding[];
}

export interface ExcludePath {
  path: string;
  reason: string;
}

export interface ReviewConfig {
  project_type: string;
  language: string;
  schema?: {
    orm: string;
    path: string;
  };
  multi_tenancy?: {
    enabled: boolean;
    scope_column: string;
    check_description: string;
    applies_to?: string[];
  };
  auth?: {
    provider: string;
    middleware_import: string;
    protected_routes: string;
    except: string[];
    applies_to?: string[];
  };
  testing?: {
    framework: string;
    test_dir: string;
    source_dirs: string[];
  };
  routes?: {
    file: string;
    data_access: string;
  };
  exclude_paths?: ExcludePath[];
  conventions?: string[];
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PRAutoMerge {
  merge_method: MergeMethod;
}

export interface PRDetails {
  number: number;
  title: string;
  body: string;
  diff: string;
  files: PRFile[];
  commits: PRCommit[];
  base_branch: string;
  head_branch: string;
  head_sha: string;
  auto_merge: PRAutoMerge | null;
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | undefined;
}

export interface PRCommit {
  sha: string;
  message: string;
}
