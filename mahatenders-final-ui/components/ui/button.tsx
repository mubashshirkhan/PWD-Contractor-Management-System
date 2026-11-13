import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({ className, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-saffron text-white hover:bg-[#bd741c]",
        variant === "secondary" && "border border-line bg-paper text-ink hover:bg-field",
        variant === "quiet" && "text-muted hover:bg-field hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}
