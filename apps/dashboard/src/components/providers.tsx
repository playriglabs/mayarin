/**
 * React Query provider island.
 *
 * Wraps islands that need queries/mutations in a single shared `QueryClient`
 * (see `lib/query`). Each island is hydrated independently; sharing the client
 * means a mutation in one island can invalidate a query another island reads.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "@/lib/query";

export default function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
