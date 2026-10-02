/**
 * A dispute's evidence thread (#313): what the payer, the merchant and the
 * arbiter wrote, oldest first, and a box to add to it while the dispute is
 * open. Append-only on the server, so there is no edit and no delete here.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { DisputeMessageDto } from "@/types/payment";

type Viewer = "merchant" | "arbiter";

const AUTHOR_LABELS: Readonly<Record<Viewer, Record<DisputeMessageDto["author"], string>>> = {
  merchant: { payer: "Buyer", merchant: "You", arbiter: "Mayarin Resolution" },
  arbiter: { payer: "Buyer", merchant: "Merchant", arbiter: "You" },
};

export function DisputeThread({
  messages,
  viewer,
  open,
  pending,
  onSend,
}: {
  readonly messages: readonly DisputeMessageDto[];
  readonly viewer: Viewer;
  /** Whether the dispute still takes messages. */
  readonly open: boolean;
  readonly pending: boolean;
  /** Resolves once the message is stored; the box clears only then. */
  readonly onSend: (body: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLOListElement>(null);

  // The thread scrolls inside a fixed height; keep the newest message in view.
  useEffect(() => {
    const element = list.current;
    if (element !== null && messages.length > 0) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  async function send() {
    await onSend(draft);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">No messages yet.</p>
      ) : (
        <ol
          ref={list}
          className="flex max-h-80 flex-col gap-2 overflow-y-auto overscroll-contain pr-1"
        >
          {messages.map((message) => {
            const own = message.author === viewer;
            return (
              <li
                key={message.id}
                className={cn(
                  "flex flex-col gap-1 rounded-md border border-border px-3 py-2",
                  own ? "bg-muted/40" : "bg-card",
                )}
              >
                <span className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-foreground">
                    {AUTHOR_LABELS[viewer][message.author]}
                  </span>
                  <time className="text-subtle-foreground" dateTime={message.createdAt}>
                    {formatDateTime(message.createdAt)}
                  </time>
                </span>
                <p className="whitespace-pre-wrap break-words text-foreground text-sm">
                  {message.body}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {open && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder={
              viewer === "merchant"
                ? "Proof of delivery, tracking, links — or what you offer the buyer."
                : "Ask either side for more, or explain the decision."
            }
            aria-label="Message"
          />
          <Button type="submit" className="w-fit" disabled={pending || draft.trim() === ""}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </form>
      )}
    </div>
  );
}
