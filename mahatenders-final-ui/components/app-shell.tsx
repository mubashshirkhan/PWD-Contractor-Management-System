"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Calculator,
  ClipboardList,
  FolderKanban,
  House,
  Menu,
  ReceiptIndianRupee,
  Search,
  X,
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  return (
    <div className="min-h-screen min-w-0 bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/10 bg-navy text-white min-[1025px]:flex print:hidden">
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
      <div className="min-w-0 min-[1025px]:pl-64 print:pl-0">
        <header className="sticky top-0 z-10 flex h-16 min-w-0 items-center justify-between border-b border-line bg-canvas/95 px-4 backdrop-blur sm:px-5 lg:px-10 print:hidden">
          <Link href="/" className="flex min-w-0 items-center gap-2 min-[1025px]:hidden"><span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded border border-line bg-[#f4efe6] p-0.5"><Image src="/arch-design-studio-mark.png" alt="Arch Design Studio logo" width={32} height={32} className="h-full w-full object-contain" priority /></span><span className="truncate font-serif text-lg">Arch Design Studio</span></Link>
          <p className="hidden text-sm text-muted min-[1025px]:block">Project operations workspace</p>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-white text-ink shadow-sm min-[1025px]:hidden"
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-workspace-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>
        <main className="mx-auto min-w-0 max-w-[1480px] px-5 py-6 sm:py-8 lg:px-10 lg:py-10 print:max-w-none print:p-0">{children}</main>
      </div>

      {mobileNavOpen && <>
        <button className="fixed inset-0 z-30 bg-black/40 min-[1025px]:hidden" aria-label="Close navigation menu" onClick={() => setMobileNavOpen(false)} />
        <aside id="mobile-workspace-navigation" className="fixed inset-y-0 left-0 z-40 flex w-72 max-w-[calc(100vw-2rem)] flex-col border-r border-white/10 bg-navy text-white shadow-2xl min-[1025px]:hidden print:hidden">
          <div className="flex items-center justify-between gap-3 px-5 pb-5 pt-6">
            <Link href="/" onClick={() => setMobileNavOpen(false)} className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/20 bg-[#f4efe6] p-1"><Image src="/arch-design-studio-mark.png" alt="Arch Design Studio logo" width={40} height={40} className="h-full w-full object-contain" priority /></span>
              <span className="min-w-0"><strong className="block truncate font-serif text-base font-normal">Arch Design Studio</strong><small className="text-[11px] text-slate-300">Contract management</small></span>
            </Link>
            <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white hover:bg-white/10" aria-label="Close navigation menu" onClick={() => setMobileNavOpen(false)}><X className="h-5 w-5" /></button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3" aria-label="Workspace navigation">
            <p className="mb-2 px-3 text-[11px] font-medium text-slate-400">Operations</p>
            {operations.map((item) => <NavItem key={item.href} item={item} active={pathname === item.href} onNavigate={() => setMobileNavOpen(false)} />)}
          </nav>
          <div className="border-t border-white/10 px-5 py-5 text-xs leading-5 text-slate-300"><OneDriveConnectionStatus /></div>
        </aside>
      </>}
    </div>
  );
}

function NavItem({ item, active, onNavigate }: { item: { label: string; href: string; icon: LucideIcon }; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return <Link href={item.href} onClick={onNavigate} className={cn("mb-1 flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white", active ? "border-saffron bg-white/10 text-white" : "border-transparent")}><Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />{item.label}</Link>;
}
