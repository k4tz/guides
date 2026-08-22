export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function publicError(error) {
  if (error instanceof AppError) {
    return { status: error.statusCode, body: { error: error.code, message: error.message } };
  }

  console.error('unexpected error', error);
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Internal server error' } };
}
