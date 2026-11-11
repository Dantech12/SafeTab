export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}
export const forbidden = (code = "forbidden") => new HttpError(403, code);
export const notFound = (code = "not_found") => new HttpError(404, code);
export const unauthorized = (code = "unauthorized") => new HttpError(401, code);
export const conflict = (code: string) => new HttpError(409, code);
export const paymentRequired = (code: string) => new HttpError(402, code);
