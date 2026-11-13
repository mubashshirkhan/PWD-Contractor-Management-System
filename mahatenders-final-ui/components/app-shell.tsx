"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  FolderKanban,
  ReceiptIndianRupee,
  Search,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const operations: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "Project tracking", href: "/projects", icon: FolderKanban },
  { label: "Tender Search", href: "/tender-search", icon: Search },
  { label: "Payments & expenses", href: "/payments", icon: ReceiptIndianRupee },
  { label: "Work orders", href: "/work-orders", icon: ClipboardList },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "User management", href: "/users", icon: Users },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/10 bg-navy text-white lg:flex">
        <div className="px-5 pb-5 pt-7">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/20 bg-copper text-xs font-semibold tracking-wide">AD</span>
            <span><strong className="block font-serif text-lg font-normal">Arch Design Studio</strong><small className="text-[11px] text-slate-300">Contract management</small></span>
          </Link>
        </div>
        <nav className="flex-1 px-3" aria-label="Workspace navigation">
          <p className="mb-2 px-3 text-[11px] font-medium text-slate-400">Operations</p>
          {operations.map((item) => <NavItem key={item.href} item={item} active={pathname === item.href} />)}
        </nav>
        <div className="border-t border-white/10 px-5 py-5 text-xs leading-5 text-slate-300">
          <div className="flex items-center gap-2 text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-300" /> API configured</div>
          <p className="mt-2">Live records remain separate from planned modules.</p>
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center border-b border-line bg-canvas/95 px-5 backdrop-blur lg:px-10">
          <Link href="/" className="flex items-center gap-2 lg:hidden"><span className="grid h-8 w-8 place-items-center rounded bg-copper text-[10px] font-semibold text-white">AD</span><span className="font-serif text-lg">Arch Design Studio</span></Link>
          <p className="hidden text-sm text-muted lg:block">Project operations workspace</p>
        </header>
        <main className="mx-auto max-w-[1480px] px-5 py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

function NavItem({ item, active }: { item: { label: string; href: string; icon: LucideIcon }; active: boolean }) {
  const Icon = item.icon;
  return <Link href={item.href} className={cn("mb-1 flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white", active ? "border-saffron bg-white/10 text-white" : "border-transparent")}><Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />{item.label}</Link>;
}
