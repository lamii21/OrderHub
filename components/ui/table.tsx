import * as React from "react";

import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b border-neutral-200 bg-neutral-50", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-neutral-200", className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500",
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("p-3 align-middle whitespace-nowrap", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
