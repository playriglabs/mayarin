/**
 * Company logo storage.
 *
 * A logo is an image a buyer may later see, so the bytes are checked here
 * rather than trusted from the upload's `content-type`: only PNG and JPEG are
 * stored, recognised by their magic bytes. Not WebP: the logo is embedded in
 * invoice PDFs (pdf-lib reads PNG and JPEG only) and in emails, where Outlook
 * does not render WebP. Each upload gets a fresh key, so
 * a replaced logo is never served stale from a cache.
 *
 * R2 speaks the S3 API; Bun's built-in `S3Client` talks to it with no SDK.
 */

import { ConfigurationError, ulid, ValidationError } from "@mayarin/shared";
import { S3Client } from "bun";
import type { Config } from "../config.ts";

/** 2 MB. The dashboard crops to a small square before it uploads, so this is generous. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export interface LogoStorage {
  /** Stores the image and returns the public URL it is served from. */
  put(merchantId: string, bytes: Uint8Array, now: Date): Promise<string>;
}

type ImageType = { readonly mime: string; readonly ext: string };

/** The image type the bytes actually are, or `undefined` for anything else. */
export function sniffImage(bytes: Uint8Array): ImageType | undefined {
  const at = (offset: number, signature: readonly number[]) =>
    signature.every((byte, index) => bytes[offset + index] === byte);

  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", ext: "png" };
  }
  if (at(0, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  return undefined;
}

export function assertLogo(bytes: Uint8Array): ImageType {
  if (bytes.byteLength === 0) throw new ValidationError("The logo is empty", {});
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new ValidationError("A logo must be 2 MB or smaller", { bytes: bytes.byteLength });
  }
  const type = sniffImage(bytes);
  if (type === undefined) {
    throw new ValidationError("A logo must be a PNG or JPEG image", {});
  }
  return type;
}

export class R2LogoStorage implements LogoStorage {
  readonly #client: S3Client;
  readonly #publicUrl: string;

  constructor(options: {
    readonly accountId: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
    readonly publicUrl: string;
  }) {
    this.#client = new S3Client({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      bucket: options.bucket,
      endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
    });
    this.#publicUrl = options.publicUrl;
  }

  async put(merchantId: string, bytes: Uint8Array, now: Date): Promise<string> {
    const type = assertLogo(bytes);
    const key = `merchant-logos/${merchantId}/${ulid(now.getTime())}.${type.ext}`;
    await this.#client.write(key, bytes, { type: type.mime });
    return `${this.#publicUrl}/${key}`;
  }
}

/** A deployment with no bucket: the dashboard still boots, an upload is refused. */
export class UnavailableLogoStorage implements LogoStorage {
  async put(): Promise<string> {
    throw new ConfigurationError("Logo upload is not configured on this deployment", {});
  }
}

export function logoStorageFor(config: Config): LogoStorage {
  const { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket, r2PublicUrl } = config;
  if (
    r2AccountId === undefined ||
    r2AccessKeyId === undefined ||
    r2SecretAccessKey === undefined ||
    r2Bucket === undefined ||
    r2PublicUrl === undefined
  ) {
    return new UnavailableLogoStorage();
  }
  return new R2LogoStorage({
    accountId: r2AccountId,
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
    bucket: r2Bucket,
    publicUrl: r2PublicUrl,
  });
}
