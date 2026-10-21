/**
 * Logout button — a React island.
 *
 * Signing out asks first. It is one click away from every page in the shell, so
 * an accidental press would otherwise end the session and lose whatever was on
 * screen. `AlertDialog` is the right shape: it does not dismiss on an outside
 * press, so the choice has to be made rather than clicked away.
 *
 * Runs `authApi.logout` as a React Query mutation (the centralized client
 * auto-attaches the double-submit CSRF token). Confirming closes the dialog and
 * covers the page with a blurred overlay and a centred loader until the redirect
 * to `/login`; the server has by then revoked the session and cleared the
 * cookies. A failure reopens the dialog and shows why — closing it for good
 * would hide the only explanation the user gets.
 *
 * `withQuery` mounts this below the shared `QueryClientProvider` so SSR
 * resolves the context, and supplies the motion provider the dialog animates
 * with.
 */

import { SignOutIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { createPortal } from "react-dom";
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
import { PageLoader } from "@/components/ui/page-loader";
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
  const [leaving, setLeaving] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const logout = useLogout();

  function onConfirm() {
    setReason(null);
    setConfirming(false);
    setLeaving(true);
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/login";
      },
      onError: (error) => {
        setReason(reasonOf(error));
        setLeaving(false);
        setConfirming(true);
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
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
      >
        <AlertDialogContent className="max-w-md gap-6 p-6">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              You’ll be signed out of this dashboard on this device. Sign in again to view payments,
              settlements, and account settings.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {reason !== null && <Alert variant="destructive">{reason}</Alert>}

          {/* Two equal halves: side by side at their own widths, the two
              buttons read as different sizes. */}
          <AlertDialogFooter className="grid grid-cols-2">
            <AlertDialogCancel className="h-10 w-full" />
            {/* Signing out ends a session; it destroys nothing, so this is the
                ordinary filled button rather than the destructive one. */}
            <AlertDialogAction variant="default" className="h-10 w-full" onClick={onConfirm}>
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Portalled to the body: the sidebar is transformed on mobile, which
          would make `fixed` cover the sidebar instead of the page. */}
      {leaving &&
        createPortal(
          <div className="app-scrim fixed inset-0 z-60 flex items-center justify-center">
            <PageLoader label="Signing out" className="min-h-0" />
          </div>,
          document.body,
        )}
    </>
  );
}

export default withQuery(LogoutButton);
