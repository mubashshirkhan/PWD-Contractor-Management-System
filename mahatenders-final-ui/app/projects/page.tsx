import { SectionHeader } from "@/components/section-header";
import { ProjectTracking } from "@/components/project-tracking";

export default function Page() {
  return <div><SectionHeader eyebrow="Project tracking" title="Progress from site to completion" description="Keep project details, milestones, schedules, and progress together." /><ProjectTracking /></div>;
}
