import type { ReactNode } from "react";

export function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-xs font-medium text-blue-700">{eyebrow}</p>
        <h1 className="font-serif text-3xl tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
