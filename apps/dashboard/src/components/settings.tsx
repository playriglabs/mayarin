/**
 * Merchant settings — a React island over `/settings` (#95, #15).
 *
 * Two groups of fields that look alike and are not:
 *
 *   - Settlement: which stablecoin the merchant is paid in, what a payer may
 *     pay with, and the address the money is sent to. Changing the address
 *     redirects this merchant's money, which is why the surface has its own
 *     permission and every edit is written to an audit trail shown below.
 *   - Profile: city and country. Frozen into the snapshot every payment link
 *     and payment carries, so a buyer sees them; they move no money.
 *
 * `effectiveSettlementAddress` is where the money actually goes — what the
 * merchant chose, or their managed wallet when they chose nothing. It is shown
 * separately from the chosen address because "blank" is not "nowhere", and a
 * merchant should be able to read the answer rather than infer it.
 */

import { BankIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PanelSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSettings, useSettingsHistory, useUpdateSettings } from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";
import type { SettingsDto } from "@/types/settings";

/** A merchant settles in a stablecoin — the domain refuses anything else. */
const SETTLEMENT_OPTIONS: readonly SelectOption[] = [
  { value: "USDC", label: "USDC" },
  { value: "USDT", label: "USDT" },
  { value: "IDRX", label: "IDRX" },
];

/** What a payer may pay with. The settlement asset itself is the no-swap path. */
const PAYABLE_ASSETS: readonly string[] = ["USDC", "USDT", "IDRX", "ETH"];

interface Draft {
  readonly settlementAsset: string;
  readonly acceptedAssets: readonly string[];
  readonly settlementAddress: string;
  readonly city: string;
  readonly countryCode: string;
}

function draftOf(settings: SettingsDto): Draft {
  return {
    settlementAsset: settings.settlementAsset,
    acceptedAssets: settings.acceptedAssets,
    settlementAddress: settings.settlementAddress ?? "",
    city: settings.city ?? "",
    countryCode: settings.countryCode ?? "",
  };
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load settings";
}

/** Empty means "clear it", which the API spells `null` — absent would mean "leave it". */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function Settings() {
  const settings = useSettings();
  const history = useSettingsHistory();
  const update = useUpdateSettings();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");

  // The server's copy is the source of truth; the draft is only what is being
  // typed. Reset when the loaded settings change so a successful save leaves
  // the form showing what was actually stored, not what was submitted.
  const loaded = settings.data?.settings;
  useEffect(() => {
    if (loaded !== undefined) setDraft(draftOf(loaded));
  }, [loaded]);

  async function save() {
    if (draft === null) return;
    setFailure("");
    try {
      await update.mutateAsync({
        settlementAsset: draft.settlementAsset,
        acceptedAssets: draft.acceptedAssets,
        settlementAddress: orNull(draft.settlementAddress),
        city: orNull(draft.city),
        countryCode: orNull(draft.countryCode),
      });
      setNotice("Settings saved.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not save settings");
    }
  }

  function toggleAsset(asset: string, checked: boolean) {
    if (draft === null) return;
    const next = checked
      ? [...draft.acceptedAssets, asset]
      : draft.acceptedAssets.filter((a) => a !== asset);
    setDraft({ ...draft, acceptedAssets: next });
  }

  return (
    <section className="flex flex-col gap-8">
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {match(settings)
        .with({ isPending: true }, () => <PanelSkeleton />)
        .with({ isError: true }, ({ error }) => (
          <Alert variant="destructive">{reasonOf(error)}</Alert>
        ))
        .otherwise(() => {
          if (draft === null || loaded === undefined) return null;
          return (
            <>
              {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

              <div className="flex flex-col gap-4">
                <SectionHeader title="Settlement" />

                <Card className="flex flex-col gap-4 p-4">
                  <Field>
                    <FieldLabel htmlFor="settlement-asset">Settlement asset</FieldLabel>
                    <Select
                      items={SETTLEMENT_OPTIONS}
                      value={draft.settlementAsset}
                      onValueChange={(next) => setDraft({ ...draft, settlementAsset: next })}
                    >
                      <SelectTrigger id="settlement-asset">
                        <SelectValue placeholder="Select an asset" />
                      </SelectTrigger>
                      <SelectContent>
                        {SETTLEMENT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      What you are paid in. Whatever a payer sends is converted to this before it
                      reaches you.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel>Accepted payer assets</FieldLabel>
                    <div className="flex flex-wrap gap-4 pt-1">
                      {PAYABLE_ASSETS.map((asset) => (
                        <span key={asset} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            id={`accepted-${asset}`}
                            checked={draft.acceptedAssets.includes(asset)}
                            onCheckedChange={(checked) => toggleAsset(asset, checked === true)}
                          />
                          <label htmlFor={`accepted-${asset}`}>{asset}</label>
                        </span>
                      ))}
                    </div>
                    <FieldDescription>
                      Accepting the asset you settle in is what enables the no-swap path. It is kept
                      in the set whether you tick it or not.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="settlement-address">Settlement address</FieldLabel>
                    <Input
                      id="settlement-address"
                      value={draft.settlementAddress}
                      onChange={(e) => setDraft({ ...draft, settlementAddress: e.target.value })}
                      placeholder="0x…"
                      className="font-mono text-xs"
                    />
                    <FieldDescription>
                      Leave it blank to be paid at your managed wallet. There is no shared default:
                      one address for every merchant would pay every merchant into the same wallet.
                    </FieldDescription>
                  </Field>

                  {/* Shown in full and never truncated in the DOM: an address a
                      merchant cannot copy whole is worse than one they scroll. */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
                    <BankIcon
                      size={ICON_CARD}
                      aria-hidden="true"
                      className="text-muted-foreground"
                    />
                    <span className="text-muted-foreground">Paid to</span>
                    <span className="break-all font-mono text-xs">
                      {loaded.effectiveSettlementAddress ?? "nowhere yet"}
                    </span>
                    <Badge variant={loaded.canSettleOnChain ? "success" : "warning"}>
                      {loaded.canSettleOnChain ? "Can settle on chain" : "No address"}
                    </Badge>
                  </div>
                </Card>
              </div>

              <div className="flex flex-col gap-4">
                <SectionHeader title="Profile" />

                <Card className="flex flex-col gap-4 p-4">
                  <Field>
                    <FieldLabel htmlFor="merchant-city">City</FieldLabel>
                    <Input
                      id="merchant-city"
                      value={draft.city}
                      onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                      placeholder="Jakarta"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="merchant-country">Country</FieldLabel>
                    <Input
                      id="merchant-country"
                      value={draft.countryCode}
                      onChange={(e) => setDraft({ ...draft, countryCode: e.target.value })}
                      placeholder="ID"
                      maxLength={2}
                      className="w-24 uppercase"
                    />
                    <FieldDescription>
                      Two letters, e.g. ID. Both fields are frozen into every payment a link takes,
                      and a payment link cannot be created without them.
                    </FieldDescription>
                  </Field>
                </Card>
              </div>

              <div className="flex justify-end">
                <Button onClick={save} disabled={update.isPending}>
                  Save settings
                </Button>
              </div>

              <div className="flex flex-col gap-4">
                <SectionHeader title="Change history" />
                <p className="text-sm text-muted-foreground">
                  Who changed what, and when. Append-only — a redirect of your money survives the
                  redirect itself.
                </p>
                {(history.data?.changes.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing has been changed yet.</p>
                ) : (
                  <Table>
                    <TableCaption>Settlement setting changes</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Changed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(history.data?.changes ?? []).map((change) => (
                        <TableRow key={change.id}>
                          <TableCell className="font-mono text-xs">{change.field}</TableCell>
                          <TableCell className="break-all font-mono text-xs text-muted-foreground">
                            {change.previousValue ?? "—"}
                          </TableCell>
                          <TableCell className="break-all font-mono text-xs">
                            {change.nextValue ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <time dateTime={isoAttr(change.changedAt)}>
                              {formatDateTime(change.changedAt)}
                            </time>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          );
        })}
    </section>
  );
}

export default withQuery(Settings);
