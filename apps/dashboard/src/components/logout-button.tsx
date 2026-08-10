/**
 * Logout button — a React island.
 *
 * Signing out asks first. It is one click away from every page in the shell, so
 * an accidental press would otherwise end the session and lose whatever was on
 * screen. `AlertDialog` is the right shape: it does not dismiss on an outside
 * press, so the choice has to be made rather than clicked away.
 *
 * Runs `authApi.logout` as a React Query mutation (the centralized client
 * auto-attaches the double-submit CSRF token). On success the server has
 * revoked the session and cleared the cookies; redirect to `/login`. A failure
 * keeps the dialog open and shows why — closing it would hide the only
 * explanation the user gets.
 *
 * `withQuery` mounts this below the shared `QueryClientProvider` so SSR
 * resolves the context, and supplies the motion provider the dialog animates
 * with.
 */

import { SignOutIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/hooks/auth";
import { ApiError } from "@/lib/api/client";
import { ICON_NAV } from "@/lib/icons";
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
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const logout = useLogout();

  function onConfirm() {
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
    <>
      <Button
        variant="ghost"
        size="icon"
        // Ghost recolored for the void sidebar this button lives on.
        className="text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        onClick={() => {
          setReason(null);
          setConfirming(true);
        }}
        aria-label="Sign out"
      >
        <SignOutIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
      </Button>

      <AlertDialog
        open={confirming}
        // A request in flight must not be dismissed out from under itself.
        onOpenChange={(next) => {
          if (!next && !logout.isPending) setConfirming(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will need to sign in again to see payments and settlement.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {reason !== null && <Alert variant="destructive">{reason}</Alert>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={logout.isPending} />
            {/* Signing out ends a session; it destroys nothing, so this is the
                ordinary filled button rather than the destructive one. */}
            <AlertDialogAction variant="default" onClick={onConfirm} disabled={logout.isPending}>
              {logout.isPending ? "Signing out…" : "Sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default withQuery(LogoutButton);
