/**
 * Users table — a React island listing the caller's own merchant accounts.
 *
 * Reads `useAdminUsers` (GET `/admin/users`). Render state is matched with
 * `ts-pattern`'s `.exhaustive()` over the React Query `status`. `withQuery`
 * mounts this component below the shared `QueryClientProvider` so SSR resolves
 * the context; the singleton client means a successful create in
 * `create-user-form` invalidates this list automatically.
 */

import { UsersThreeIcon } from "@phosphor-icons/react";
import { match } from "ts-pattern";
import { PermissionBadges } from "@/components/permission-badges";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminUsers } from "@/hooks/admin";
import { ApiError } from "@/lib/api/client";
import { ICON_CARD } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";
import type { UserDto } from "@/types/user";

function reasonOf(error: unknown): string {
  return match(error)
    .when(
      (e): e is ApiError => e instanceof ApiError,
      (e) => e.message,
    )
    .otherwise(() => "Failed to load users");
}

function UsersTable() {
  const users = useAdminUsers();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground">Accounts in this merchant</h2>
      {match(users)
        .with({ status: "pending" }, () => <PageLoader label="Loading accounts" />)
        .with({ status: "error" }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void users.refetch()}
            retrying={users.isFetching}
          />
        ))
        .with({ status: "success" }, ({ data }) =>
          data.users.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <UsersThreeIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No accounts yet.</EmptyTitle>
              <EmptyDescription>
                Grant access to the first member of this merchant.
              </EmptyDescription>
              <EmptyAction>
                <Button onClick={() => window.dispatchEvent(new Event("mayarin:grant-account"))}>
                  Grant an account
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Merchant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((u: UserDto) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <PermissionBadges permissions={u.permissions} />
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {u.merchantId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )
        .exhaustive()}
    </section>
  );
}

export default withQuery(UsersTable);
