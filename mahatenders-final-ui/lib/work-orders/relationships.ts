import { WorkOrderValidationError, type WorkOrderInput } from "./model";

type ProjectReference = { projectId: string; projectName: string; isArchived?: boolean };
type BoqReference = { boqId: string; boqNumber: string; projectId: string };

export function resolveWorkOrderReferences(input: WorkOrderInput, projects: ProjectReference[], boqs: BoqReference[]) {
  const project = projects.find((candidate) => candidate.projectId === input.projectId && !candidate.isArchived);
  if (!project) throw new WorkOrderValidationError("Select an existing, active project.");
  if (!input.boqId) return { projectName: project.projectName, boqNumber: null };
  const boq = boqs.find((candidate) => candidate.boqId === input.boqId && candidate.projectId === project.projectId);
  if (!boq) throw new WorkOrderValidationError("Select a saved BOQ for the selected project.");
  return { projectName: project.projectName, boqNumber: boq.boqNumber };
}
