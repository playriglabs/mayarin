/**
 * Settings → Login history: every successful sign-in to this account, newest
 * first. A sign-in you do not recognise is the cue to change the password.
 */

import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLoginHistory } from "@/hooks/auth";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";

export function LoginHistory() {
  const history = useLoginHistory();
  const logins = history.data?.logins ?? [];

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Every time someone signed in to this account. If one is not you, change your password — it
        signs out every other device.
      </p>
      {history.isPending ? (
        <PageLoader label="Loading login history" />
      ) : history.isError ? (
        <QueryError
          message={
            history.error instanceof ApiError ? history.error.message : "Failed to load logins"
          }
          retry={() => void history.refetch()}
          retrying={history.isFetching}
        />
      ) : logins.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sign-ins recorded yet.</p>
      ) : (
        <Table>
          <TableCaption>Last {logins.length} sign-ins</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>IP address</TableHead>
              <TableHead>Device</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logins.map((login) => (
              <TableRow key={login.id}>
                <TableCell className="text-muted-foreground">
                  <time dateTime={isoAttr(login.createdAt)}>{formatDateTime(login.createdAt)}</time>
                </TableCell>
                <TableCell className="font-mono text-xs">{login.ip}</TableCell>
                <TableCell className="break-all text-xs text-muted-foreground">
                  {login.userAgent === "" ? "—" : login.userAgent}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
