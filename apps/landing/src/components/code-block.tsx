import type { Snippet } from "virtual:code-snippets";
import { useState } from "preact/hooks";

/**
 * The markup comes from Shiki at build time; this only adds the chrome —
 * filename, language and a copy button that works off the original source
 * rather than the rendered text.
 */
export function CodeBlock({ snippet }: { snippet: Snippet }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(snippet.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div class="border border-line-inverse bg-[#080808]">
      <div class="flex items-center justify-between border-b border-line-inverse px-5 py-3.5">
        <div class="flex items-center gap-3">
          <span aria-hidden="true" class="size-1.5 rounded-full bg-accent" />
          <span class="label text-slate-inverse">{snippet.filename}</span>
        </div>
        <button
          type="button"
          onClick={copy}
          class="label cursor-pointer text-slate-inverse transition-colors duration-200 hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Shiki output, generated at build time from a checked-in file. */}
      <div class="code-surface" dangerouslySetInnerHTML={{ __html: snippet.html }} />
    </div>
  );
}
