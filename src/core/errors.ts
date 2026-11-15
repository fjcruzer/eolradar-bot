export type EolApiErrorKind = "network" | "http" | "not_found" | "schema" | "invalid";

export class EolApiError extends Error {
  readonly kind: EolApiErrorKind;
  readonly status: number | undefined;

  constructor(
    message: string,
    kind: EolApiErrorKind,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "EolApiError";
    this.kind = kind;
    this.status = options?.status;
  }
}
