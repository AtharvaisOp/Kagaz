export interface FileLoadIssue {
  readonly fileName: string;
  readonly message: string;
}

export interface LoadingProgress {
  readonly currentIndex: number;
  readonly total: number;
  readonly fileName: string;
}
