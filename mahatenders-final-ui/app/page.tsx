import Link from "next/link";
import { ArrowRight, CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="-mx-5 -mt-8 min-h-[calc(100vh-4rem)] bg-navy px-5 py-16 text-white lg:-mx-10 lg:-mt-10 lg:px-20 lg:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1.05fr_.95fr]">
        <div>
          <p className="mb-5 text-sm font-medium text-[#d99b72]">Arch Design Studio</p>
          <h1 className="max-w-3xl font-serif text-5xl font-normal leading-[1.02] tracking-tight sm:text-7xl">A considered view of every <em className="text-[#d99b72]">project record</em></h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-slate-300">Search tender records by location, review source evidence, and keep project operations grounded in the information available to your team.</p>
          <div className="mt-8"><Link href="/tender-search"><Button>Search tenders <ArrowRight className="h-4 w-4" /></Button></Link></div>
        </div>
        <div className="rounded-2xl border border-white/15 bg-white/5 p-6">
          <div className="flex items-center gap-2 text-sm text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-300" /> Production API configured</div>
          <div className="mt-12 border-l border-[#d99b72] pl-5"><p className="font-serif text-3xl">Evidence-led operations</p><p className="mt-2 text-sm text-[#d99b72]">Location before assumptions</p><p className="mt-8 text-sm leading-6 text-slate-300">Review the information captured for each tender and keep missing details clearly marked.</p></div>
          <div className="mt-10 grid gap-3 border-t border-white/10 pt-5 text-sm text-slate-300"><p className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-[#d99b72]" /> Tender record review</p><p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#d99b72]" /> Location-based search</p><p className="flex items-center gap-2"><ArrowRight className="h-4 w-4 text-[#d99b72]" /> Source links and dates</p></div>
        </div>
      </div>
    </div>
  );
}
