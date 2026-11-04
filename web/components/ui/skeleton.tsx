import { cn } from "@/lib/utils";

/** Bloco cinza animado que ocupa o lugar de um conteúdo que ainda carrega. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("pa-shimmer rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
