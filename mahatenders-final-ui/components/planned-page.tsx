import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

export function PlannedPage({ eyebrow, title, description, body }: { eyebrow: string; title: string; description: string; body: string }) {
  return <div><SectionHeader eyebrow={eyebrow} title={title} description={description} /><Card><CardContent><div className="flex items-start gap-4"><div className="h-2 w-2 rounded-full bg-saffron" /><div><span className="text-xs font-medium text-[#a76914]">Planned module</span><h2 className="mt-2 font-serif text-2xl">Backend persistence is not connected</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{body}</p></div></div></CardContent></Card></div>;
}
