import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, FileCheck2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

const highlights = [
  { icon: MapPin, title: "Search by location", text: "Filter records by district and taluka." },
  { icon: FileCheck2, title: "Review tender details", text: "See captured fields, covers, and documents." },
  { icon: CalendarDays, title: "Check important dates", text: "Keep submission and opening dates in view." },
];

export default function HomePage() {
  return (
    <div className="-mx-5 -mt-8 bg-[#f4f1eb] px-5 pb-8 pt-5 lg:-mx-10 lg:-mt-10 lg:px-10 lg:pb-10 lg:pt-8">
      <section className="mx-auto grid max-w-7xl overflow-hidden rounded-2xl bg-[#242321] text-white shadow-lg md:grid-cols-[1.1fr_.9fr]">
        <div className="flex flex-col justify-center px-7 py-10 sm:px-12 sm:py-14 lg:px-16 lg:py-16">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#d5ac72]">Project operations</p>
          <h1 className="max-w-xl font-serif text-4xl font-normal leading-[1.08] tracking-tight sm:text-5xl">A clearer view of every <em className="text-[#d5ac72]">project record</em></h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">Find tenders by location and review the information available for each opportunity.</p>
          <div className="mt-7"><Link href="/tender-search"><Button className="h-11 px-5">Search tenders <ArrowRight className="h-4 w-4" /></Button></Link></div>
        </div>
        <div className="flex min-h-64 items-center justify-center bg-[#eeece6] p-6 sm:p-10 md:p-8 lg:p-12">
          <div className="w-full max-w-[340px] rounded-xl bg-white p-2 shadow-sm">
            <Image src="/architectural-arch-studio-logo.png" alt="Arch Design Studio" width={1536} height={1024} priority className="h-auto w-full object-contain" />
          </div>
        </div>
      </section>

      <section aria-label="Workspace features" className="mx-auto grid max-w-7xl gap-5 border-t border-[#ded9cf] py-7 sm:grid-cols-3 sm:gap-8 lg:py-9">
        {highlights.map(({ icon: Icon, title, text }) => <div key={title} className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-[#9b713f] shadow-sm"><Icon className="h-4 w-4" /></span>
          <div><h2 className="text-sm font-semibold text-[#302e2a]">{title}</h2><p className="mt-1 text-xs leading-5 text-[#77736c]">{text}</p></div>
        </div>)}
      </section>
    </div>
  );
}
