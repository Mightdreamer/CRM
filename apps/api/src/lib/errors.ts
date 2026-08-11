import { ZodError } from 'zod';
import type { FieldErrors } from './responses';

type AppErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502;

export class AppError extends Error {
  constructor(
    public readonly status: AppErrorStatus,
    message: string,
    public readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFoundError = (message = 'Not found') =>
  new AppError(404, message);
export const forbiddenError = (message = 'Forbidden') =>
  new AppError(403, message);
export const conflictError = (message: string) => new AppError(409, message);
export const validationError = (message: string, fieldErrors?: FieldErrors) =>
  new AppError(422, message, fieldErrors);
export const badGatewayError = (message: string) => new AppError(502, message);

export function zodToFieldErrors(error: ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!result[path]) result[path] = [];
    result[path].push(issue.message);
  }
  return result;
}
