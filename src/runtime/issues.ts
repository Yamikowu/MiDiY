/** Serializable diagnostics. UI language is deliberately not a runtime dependency. */
export interface Issue {
  code: string;
  message: string;
  params?: Record<string, string | number>;
  detail?: Issue;
}
export class AppError extends Error implements Issue {
  constructor(readonly code: string, message: string, readonly params: Record<string, string | number> = {}) {
    super(message); this.name = 'AppError';
  }
}
export function toIssue(error: unknown): Issue {
  const value = error as Partial<Issue> | null;
  return { code: typeof value?.code === 'string' ? value.code : '',
    message: value?.message ?? String(error), params: value?.params };
}
