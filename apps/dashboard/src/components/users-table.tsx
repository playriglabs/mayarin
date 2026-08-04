/**
 * Users table — a React island listing the caller's own merchant accounts.
 *
 * Reads `useAdminUsers` (GET `/admin/users`). Render state is matched with
 * `ts-pattern`'s `.exhaustive()` over the React Query `status`. `withQuery`
 * mounts this component below the shared `QueryClientProvider` so SSR resolves
 * the context; the singleton client means a successful create in
 * `create-user-form` invalidates this list automatically.
 */

import { match } from "ts-pattern";
import { useAdminUsers } from "@/hooks/admin";
import { ApiError } from "@/lib/api/client";
import { withQuery } from "@/lib/with-query";
import type { Permission, UserDto } from "@/types/user";

const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  "payments:read": "Payments",
  "users:manage": "Manage users",
  "admin:access": "Admin",
} as const;

function reasonOf(error: unknown): string {
  return match(error)
    .when(
      (e): e is ApiError => e instanceof ApiError,
      (e) => e.message,
    )
    .otherwise(() => "Failed to load users");
}

function permBadges(permissions: readonly Permission[]): string {
  return permissions.map((p) => PERMISSION_LABELS[p]).join(", ");
}

function UsersTable() {
  const users = useAdminUsers();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-stone-800">Accounts in this merchant</h2>
      {match(users)
        .with({ status: "pending" }, () => (
          <p className="text-sm text-stone-500">Loading accounts…</p>
        ))
        .with({ status: "error" }, ({ error }) => (
          <p className="text-sm text-red-600">{reasonOf(error)}</p>
        ))
        .with({ status: "success" }, ({ data }) =>
          data.users.length === 0 ? (
            <p className="text-sm text-stone-500">No accounts yet.</p>
          ) : (
            <table className="w-full max-w-3xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Permissions</th>
                  <th className="py-2 font-medium">Merchant</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u: UserDto) => (
                  <tr key={u.id} className="border-b border-stone-100">
                    <td className="py-2 pr-4 text-stone-800">{u.email}</td>
                    <td className="py-2 pr-4 text-stone-600">{permBadges(u.permissions)}</td>
                    <td className="py-2 font-mono text-xs text-stone-400">{u.merchantId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ),
        )
        .exhaustive()}
    </section>
  );
}

export default withQuery(UsersTable);
