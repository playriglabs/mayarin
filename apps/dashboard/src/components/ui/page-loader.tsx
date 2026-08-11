import { Square } from "ldrs/react";
import "ldrs/react/Square.css";
import { cn } from "@/lib/utils";

interface PageLoaderProps {
  readonly label: string;
  readonly className?: string;
  readonly size?: number;
}

export function PageLoader({ label, className, size = 48 }: PageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex min-h-64 items-center justify-center", className)}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="mayarin-square-loader">
        <Square size={size} stroke={size < 40 ? 3 : 4} color="var(--loader-color)" />
      </span>
    </div>
  );
}
