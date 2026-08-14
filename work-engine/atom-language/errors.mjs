export class AtomLanguageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AtomLanguageError';
    this.code = code;
    this.details = details;
  }
}

export function atomLanguageError(code, message, details = {}) {
  return new AtomLanguageError(code, message, details);
}

export function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}
