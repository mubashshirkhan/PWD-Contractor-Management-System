"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Calculator,
  ClipboardList,
  FolderKanban,
  House,
  ReceiptIndianRupee,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { OneDriveConnectionStatus } from "@/components/onedrive-connection-status";

const operations: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "Dashboard", href: "/", icon: House },
  { label: "Project Tracking", href: "/projects", icon: FolderKanban },
  { label: "Tender Search", href: "/tender-search", icon: Search },
  { label: "BOQ Calculator", href: "/boq-calculator", icon: Calculator },
  { label: "Work Orders", href: "/work-orders", icon: ClipboardList },
  { label: "Payments & Expenses", href: "/payments", icon: ReceiptIndianRupee },
  { label: "Reports", href: "/reports", icon: BarChart3 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/10 bg-navy text-white lg:flex">
        <div className="px-5 pb-5 pt-7">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/20 bg-[#f4efe6] p-1"><Image src="/arch-design-studio-mark.png" alt="Arch Design Studio logo" width={40} height={40} className="h-full w-full object-contain" priority /></span>
            <span><strong className="block font-serif text-lg font-normal">Arch Design Studio</strong><small className="text-[11px] text-slate-300">Contract management</small></span>
          </Link>
        </div>
        <nav className="flex-1 px-3" aria-label="Workspace navigation">
          <p className="mb-2 px-3 text-[11px] font-medium text-slate-400">Operations</p>
          {operations.map((item) => <NavItem key={item.href} item={item} active={pathname === item.href} />)}
        </nav>
        <div className="border-t border-white/10 px-5 py-5 text-xs leading-5 text-slate-300">
          <OneDriveConnectionStatus />
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center border-b border-line bg-canvas/95 px-5 backdrop-blur lg:px-10">
          <Link href="/" className="flex items-center gap-2 lg:hidden"><span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded border border-line bg-[#f4efe6] p-0.5"><Image src="/arch-design-studio-mark.png" alt="Arch Design Studio logo" width={32} height={32} className="h-full w-full object-contain" priority /></span><span className="font-serif text-lg">Arch Design Studio</span></Link>
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
