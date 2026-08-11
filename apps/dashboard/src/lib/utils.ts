import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn's class merger: `clsx` resolves conditionals, `tailwind-merge` then
 * drops the losing half of any conflicting Tailwind pair — so a `className`
 * passed by a caller overrides a component's own default instead of racing it
 * on source order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
