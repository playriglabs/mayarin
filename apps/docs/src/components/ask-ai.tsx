"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { createMarkdownRenderer } from "fumadocs-core/content/md";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import {
  type ComponentProps,
  type FormEvent,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";
import remarkGfm from "remark-gfm";
import type { AskAiMessage } from "@/lib/ask-ai";

// GFM for tables: plain remark ran a table's rows into one line of pipes.
const { Markdown } = createMarkdownRenderer({ remarkPlugins: [remarkGfm] });

/** A fenced block in an answer, highlighted like the pages' code (Shiki, loaded on first use). */
function Pre({ children }: ComponentProps<"pre">) {
  if (!isValidElement<{ className?: string; children?: unknown }>(children))
    return <pre>{children}</pre>;
  const lang = /language-(\S+)/.exec(children.props.className ?? "")?.[1] ?? "text";
  return <DynamicCodeBlock lang={lang} code={String(children.props.children ?? "").trimEnd()} />;
}

/**
 * The conversation is kept in this browser so it survives a page change, a
 * reload or closing the panel. A day without opening it starts a new one.
 */
const STORAGE_KEY = "mayarin-ask-ai";
const KEEP_MS = 24 * 60 * 60 * 1000;

type Saved = { readonly lastUsedAt: number; readonly messages: AskAiMessage[] };

function loadConversation(): AskAiMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const saved = JSON.parse(raw) as Saved;
    if (Date.now() - saved.lastUsedAt > KEEP_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    return saved.messages;
  } catch {
    return [];
  }
}

function saveConversation(messages: AskAiMessage[]): void {
  try {
    if (messages.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const saved: Saved = { lastUsedAt: Date.now(), messages };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage blocked or full: the chat still works, it just is not kept.
  }
}

const SUGGESTIONS = [
  "How do I create a subscription from my backend?",
  "Which stablecoins can a merchant settle in?",
  "How do I verify a webhook signature?",
];

/** What each tool is doing, in words a reader recognises. */
function toolLabel(part: AskAiMessage["parts"][number]): string | undefined {
  switch (part.type) {
    case "tool-search_docs":
      return `Searching the docs${part.input?.query ? ` for “${part.input.query}”` : ""}`;
    case "tool-read_page":
      return `Reading ${part.input?.url ?? "a page"}`;
    case "tool-get_api_operation":
      return `Looking up ${part.input?.query ?? "an endpoint"} in the API reference`;
    default:
      return undefined;
  }
}

/**
 * A floating "Ask AI" button and the chat panel it opens. Answers come from
 * `/api/ask`, which searches and reads these docs before replying.
 */
export function AskAi() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, setMessages, sendMessage, status, stop, error } = useChat<AskAiMessage>({
    transport: new DefaultChatTransport({ api: "/api/ask" }),
  });
  const busy = status === "submitted" || status === "streaming";

  // Restored after mount: the server render has no storage to read.
  useEffect(() => {
    setMessages(loadConversation());
  }, [setMessages]);

  // Saved once an answer settles, which also marks the conversation as used.
  // Only after the reader asks or starts over: loading a page alone must not
  // refresh the timestamp, or a conversation never opened would never expire.
  const changed = useRef(false);
  useEffect(() => {
    if (changed.current && !busy) saveConversation(messages);
  }, [messages, busy]);

  const toggle = () => {
    // Opening counts as using it, so an open conversation is never reset mid-read.
    if (!open && messages.length > 0) saveConversation(messages);
    setOpen((value) => !value);
  };

  const startOver = () => {
    changed.current = true;
    if (busy) void stop();
    setMessages([]);
  };
  const bottom = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Each new chunk or status should scroll the panel to the latest line.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  const ask = (text: string) => {
    const question = text.trim();
    if (question === "" || busy) return;
    changed.current = true;
    void sendMessage({ text: question });
    setInput("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(input);
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="ask-ai-panel"
        className="fixed right-4 bottom-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground shadow-lg transition-opacity hover:opacity-90"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
        </svg>
        {open ? "Close" : "Ask AI"}
      </button>

      {open && (
        <section
          id="ask-ai-panel"
          aria-label="Ask AI about the docs"
          className="fixed right-4 bottom-18 z-40 flex h-[min(36rem,calc(100dvh-6rem))] w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-fd-card text-fd-card-foreground shadow-2xl"
        >
          <header className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium">Ask AI</h2>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={startOver}
                  className="text-xs text-fd-muted-foreground underline-offset-2 hover:underline"
                >
                  New chat
                </button>
              )}
            </div>
            <p className="text-xs text-fd-muted-foreground">
              Answers come from these docs. Check the linked pages before you ship.
            </p>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-fd-muted-foreground">Try asking:</p>
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="block w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-fd-accent"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {messages.map((message) =>
              message.role === "user" ? (
                <div
                  key={message.id}
                  className="ml-auto w-fit max-w-[85%] rounded-lg bg-fd-primary px-3 py-2 text-fd-primary-foreground"
                >
                  {message.parts.map((part) => (part.type === "text" ? part.text : null))}
                </div>
              ) : (
                <div key={message.id} className="space-y-2">
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: Parts carry no id and only ever append.
                        <div key={index} className="prose prose-sm max-w-none">
                          <Markdown components={{ pre: Pre }}>{part.text}</Markdown>
                        </div>
                      );
                    }
                    const label = toolLabel(part);
                    return label === undefined ? null : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: Parts carry no id and only ever append.
                      <p key={index} className="text-xs text-fd-muted-foreground">
                        {label}…
                      </p>
                    );
                  })}
                </div>
              ),
            )}

            {status === "submitted" && (
              <p className="text-xs text-fd-muted-foreground">Thinking…</p>
            )}
            {error !== undefined && (
              <p className="text-xs text-red-500">
                {error.message.includes("Too many")
                  ? "Too many questions. Try again in a few minutes."
                  : error.message.includes("out of capacity")
                    ? "Ask AI is out of capacity for today. Try again tomorrow."
                    : "Something went wrong. Try again."}
              </p>
            )}
            <div ref={bottom} />
          </div>

          <form onSubmit={onSubmit} className="flex items-stretch gap-2 border-t p-3">
            <label htmlFor="ask-ai-input" className="sr-only">
              Your question
            </label>
            <textarea
              id="ask-ai-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  ask(input);
                }
              }}
              rows={2}
              maxLength={1_000}
              placeholder="Ask about the API, SDK or concepts…"
              className="min-h-11 flex-1 resize-none rounded-lg border bg-fd-background px-3 py-2 text-sm outline-none focus:border-fd-primary"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => void stop()}
                aria-label="Stop"
                className="flex min-h-11 items-center justify-center rounded-lg border px-5"
              >
                {/* Lucide "square", filled */}
                <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={input.trim() === ""}
                aria-label="Send"
                className="flex min-h-11 items-center justify-center rounded-lg bg-fd-primary px-5 text-fd-primary-foreground disabled:opacity-50"
              >
                {/* Lucide "send" */}
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                  <path d="m21.854 2.147-10.94 10.939" />
                </svg>
              </button>
            )}
          </form>
        </section>
      )}
    </>
  );
}
