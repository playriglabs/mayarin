/**
 * Logout button — a React island.
 *
 * Runs `authApi.logout` as a React Query mutation (the centralized client
 * auto-attaches the double-submit CSRF token). On success the server has
 * revoked the session and cleared the cookies; redirect to `/login`. `withQuery`
 * mounts this component below the shared `QueryClientProvider` so SSR resolves
 * the context.
 */

import { useState } from "react";
import { match } from "ts-pattern";
import { useLogout } from "@/hooks/auth";
import { ApiError } from "@/lib/api/client";
import { withQuery } from "@/lib/with-query";

function reasonOf(error: unknown): string {
  return match(error)
    .when(
      (e): e is ApiError => e instanceof ApiError,
      (e) => e.message,
    )
    .otherwise(() => "Logout failed");
}

function LogoutButton() {
  const [reason, setReason] = useState<string | null>(null);
  const logout = useLogout();

  const isBusy = logout.isPending;

  function onLogout() {
    setReason(null);
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/login";
      },
      onError: (error) => {
        setReason(reasonOf(error));
      },
    });
  }

  return (
    <span className="flex items-center gap-2">
      {reason !== null && <span className="text-xs text-red-600">{reason}</span>}
      <button
        type="button"
        onClick={onLogout}
        disabled={isBusy}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-60"
      >
        {isBusy ? "Signing out…" : "Sign out"}
      </button>
    </span>
  );
}

export default withQuery(LogoutButton);
