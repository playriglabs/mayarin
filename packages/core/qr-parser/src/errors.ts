import { MayarrError } from "@mayarr/shared";

/** A QR payload could not be decoded, failed its checksum, or is unsupported. */
export class QrParseError extends MayarrError {
  readonly code = "QR_PARSE_ERROR";
  readonly httpStatus = 400;
}
