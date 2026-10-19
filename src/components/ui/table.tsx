import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function TableWrap({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("scroll-thin overflow-x-auto", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-coffee-50/80 text-left", className)} {...props} />;
}

export function TH({ className, numeric, ...props }: ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        "border-b border-coffee-100 px-3 py-2.5 text-xs font-semibold tracking-wide text-coffee-600 uppercase whitespace-nowrap",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-coffee-50 last:border-0 hover:bg-coffee-50/50", className)} {...props} />;
}

export function TD({ className, numeric, ...props }: ComponentProps<"td"> & { numeric?: boolean }) {
  return <td className={cn("px-3 py-2 align-middle text-coffee-900", numeric && "text-right tabular whitespace-nowrap", className)} {...props} />;
}
