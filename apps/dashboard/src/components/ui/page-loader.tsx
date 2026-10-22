import { Squircle } from "ldrs/react";
import "ldrs/react/Squircle.css";
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
      // `flex-1`: in a page that grows to the bottom of the frame the loader takes the spare height, so it
      // sits in the middle of the page. Inside a card nothing grows, and `min-h-64` is all it gets.
      className={cn("flex min-h-64 flex-1 items-center justify-center", className)}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="mayarin-square-loader">
        <Squircle size={size} stroke={size < 40 ? 3 : 4} color="var(--loader-color)" />
      </span>
    </div>
  );
}

/**
 * The page loader's squircle, sized for the inside of a button. Takes the
 * button's text colour, so it reads on a filled and a ghost button alike.
 */
export function ButtonLoader({ label }: { readonly label: string }) {
  return (
    <span role="status" className="inline-flex items-center justify-center">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="mayarin-square-loader inline-flex">
        <Squircle size={20} stroke={2.5} color="currentColor" />
      </span>
    </span>
  );
}
