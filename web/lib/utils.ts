import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes CSS (Tailwind), resolvendo conflitos entre elas. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
