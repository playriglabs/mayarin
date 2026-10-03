/**
 * The merchant's profile header on Settings → General: company logo, name,
 * registration number, when it registered and who registered it.
 *
 * The logo defaults to a DiceBear avatar seeded by the merchant id, so every
 * merchant has a stable mark before uploading anything. Clicking the pencil
 * picks an image, which is cropped to a square in the browser before upload —
 * the server stores the cropped PNG, never the original.
 */

import { Avatar, Style } from "@dicebear/core";
import loopsDefinition from "@dicebear/styles/loops.json" with { type: "json" };
import {
  PencilSimpleIcon,
  SealCheckIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRemoveLogo, useUploadLogo } from "@/hooks/settings";
import { formatDate, isoAttr } from "@/lib/date";
import type { SettingsDto } from "@/types/settings";

/** What the picker offers. The server checks the bytes again; this only filters the dialog. */
const ACCEPTED = "image/png,image/jpeg,image/webp";
/** The uploaded logo's edge, in pixels. Large enough for a retina 2x at 128px. */
const OUTPUT_SIZE = 512;

const loopsStyle = new Style(loopsDefinition);

function defaultLogo(seed: string): string {
  const svg = new Avatar(loopsStyle, { seed, size: 128 }).toString();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Draws the cropped area onto a square canvas and returns it as a PNG. */
async function cropToPng(src: string, area: Area): Promise<Blob> {
  const image = new Image();
  image.src = src;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas is not available");
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("Could not encode the image")) : resolve(blob)),
      "image/png",
    ),
  );
}

function CropDialog({
  src,
  onCancel,
  onDone,
}: {
  readonly src: string | null;
  readonly onCancel: () => void;
  readonly onDone: (image: Blob) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  async function apply() {
    if (src === null || area === null) return;
    onDone(await cropToPng(src, area));
  }

  return (
    <Dialog open={src !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crop logo</DialogTitle>
          <DialogDescription>Drag to position, and zoom to fit.</DialogDescription>
        </DialogHeader>

        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
          {src !== null && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={1}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>

        <input
          type="range"
          aria-label="Zoom"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full accent-brand"
        />

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={apply} disabled={area === null}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MerchantProfile({ settings }: { readonly settings: SettingsDto }) {
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");

  function pick(file: File | undefined) {
    setPickError("");
    if (file === undefined) return;
    if (!ACCEPTED.split(",").includes(file.type)) {
      setPickError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    setPicked(URL.createObjectURL(file));
  }

  function closeCrop() {
    if (picked !== null) URL.revokeObjectURL(picked);
    setPicked(null);
  }

  async function save(image: Blob) {
    closeCrop();
    await upload.mutateAsync(image).catch(() => undefined);
  }

  const busy = upload.isPending || remove.isPending;
  const owner = settings.createdBy;

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <div className="relative size-28 shrink-0">
          <img
            src={settings.logoUrl ?? defaultLogo(settings.merchantId)}
            alt={`${settings.name} logo`}
            width={112}
            height={112}
            className="size-28 rounded-xl border border-border bg-muted object-cover"
          />
          <button
            type="button"
            aria-label="Change logo"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="absolute -right-2 -bottom-2 flex size-9 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PencilSimpleIcon size={16} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              // Cleared so picking the same file again still fires `change`.
              e.target.value = "";
            }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {settings.registrationNumber !== null && (
              <span className="font-mono text-muted-foreground text-xl">
                #{settings.registrationNumber}
              </span>
            )}
            <h2 className="truncate font-medium text-foreground text-xl">{settings.name}</h2>
            {owner?.emailVerified === true ? (
              <Badge variant="success">
                <SealCheckIcon size={14} weight="fill" aria-hidden="true" />
                Verified
              </Badge>
            ) : (
              <Badge variant="warning">Unverified</Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <UploadSimpleIcon size={14} aria-hidden="true" />
              {upload.isPending ? "Uploading…" : "Upload logo"}
            </Button>
            {settings.logoUrl !== null && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove.mutate()}>
                <TrashIcon size={14} aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
          {pickError !== "" && <p className="text-destructive text-sm">{pickError}</p>}
        </div>
      </div>

      <dl className="grid border-border border-t text-sm sm:grid-cols-3 sm:divide-x sm:divide-border">
        <div className="flex flex-col gap-1 px-5 py-4">
          <dt className="text-muted-foreground text-xs">Registration number</dt>
          <dd className="font-mono">
            {settings.registrationNumber === null ? "—" : `#${settings.registrationNumber}`}
          </dd>
        </div>
        <div className="flex flex-col gap-1 border-border border-t px-5 py-4 sm:border-t-0">
          <dt className="text-muted-foreground text-xs">Registered</dt>
          <dd>
            <time dateTime={isoAttr(settings.registeredAt)}>
              {formatDate(settings.registeredAt)}
            </time>
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-border border-t px-5 py-4 sm:border-t-0">
          <dt className="text-muted-foreground text-xs">Created by</dt>
          <dd className="truncate" {...(owner === null ? {} : { title: owner.email })}>
            {owner?.email ?? "—"}
          </dd>
        </div>
      </dl>

      <CropDialog src={picked} onCancel={closeCrop} onDone={save} />
    </Card>
  );
}
