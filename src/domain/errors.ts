export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export function requireThat(condition: unknown, code: string, message: string, status = 409): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
