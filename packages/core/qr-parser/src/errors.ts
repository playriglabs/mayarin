import { MayarinError } from "@mayarin/shared";

/** A QR payload could not be decoded, failed its checksum, or is unsupported. */
export class QrParseError extends MayarinError {
  readonly code = "QR_PARSE_ERROR";
  readonly httpStatus = 400;
}
