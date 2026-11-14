import { SectionHeader } from "@/components/section-header";
import { BoqManager } from "@/components/boq-manager";

export default function BoqCalculatorPage() {
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="BOQ Calculator" title="Build and manage bills of quantities" description="Prepare itemized estimates, keep them with their project, and reopen saved BOQs from OneDrive." />
      <BoqManager />
    </div>
  );
}
