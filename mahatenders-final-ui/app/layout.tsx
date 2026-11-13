import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arch Design Studio | Project operations",
  description: "Location-based tender search and project operations for Arch Design Studio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body><AppShell>{children}</AppShell></body></html>;
}
