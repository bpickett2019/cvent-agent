export const DOCUMENT_TEAM_ROLES = [
  "coordinator",
  "event-details",
  "registration-settings",
  "registration-types",
  "registration-paths",
  "admission-items",
  "optional-items",
  "pricing-fees",
  "discounts-vouchers",
  "registration-questions",
  "site-designer",
  "verification",
] as const;

export type DocumentAgentRole = (typeof DOCUMENT_TEAM_ROLES)[number];
export type TaskAccess = "mutation" | "readOnly";

export interface PlanTask {
  id: string;
  section: string;
  eventId: string;
  access: TaskAccess;
  dependsOn?: readonly string[];
}

export interface AssignedPlanTask extends PlanTask {
  role: DocumentAgentRole;
  dependsOn: readonly string[];
}

export interface DocumentTeam {
  id: string;
  documentId: string;
  generation: number;
  slots: 12;
}

export interface TaskClaim {
  teamId: string;
  teamGeneration: number;
  taskId: string;
  eventId: string;
  access: TaskAccess;
  role: DocumentAgentRole;
  generation: number;
}

const SECTION_ROLES: Readonly<Record<string, DocumentAgentRole>> = {
  coordinator: "coordinator",
  event: "event-details",
  eventdetails: "event-details",
  registrationsettings: "registration-settings",
  registrationtypes: "registration-types",
  registrationpaths: "registration-paths",
  admissionitems: "admission-items",
  optionalitems: "optional-items",
  pricing: "pricing-fees",
  pricingfees: "pricing-fees",
  discounts: "discounts-vouchers",
  vouchers: "discounts-vouchers",
  discountsvouchers: "discounts-vouchers",
  questions: "registration-questions",
  registrationquestions: "registration-questions",
  website: "site-designer",
  sitedesigner: "site-designer",
  verification: "verification",
  verify: "verification",
};

function normalizedSection(section: string): string {
  return section.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function roleForSection(section: string): DocumentAgentRole {
  const normalized = normalizedSection(section);
  const known = SECTION_ROLES[normalized];
  if (known) return known;
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return DOCUMENT_TEAM_ROLES[(hash >>> 0) % DOCUMENT_TEAM_ROLES.length];
}

export function assignPlanTasks(tasks: readonly PlanTask[]): AssignedPlanTask[] {
  const ids = new Set<string>();
  return tasks.map((task) => {
    const id = task.id.trim();
    if (!id || !task.section.trim() || !task.eventId.trim()) throw new Error("task id, section, and eventId are required");
    if (ids.has(id)) throw new Error(`duplicate plan task id ${id}`);
    ids.add(id);
    return {
      ...task,
      id,
      section: task.section.trim(),
      eventId: task.eventId.trim(),
      dependsOn: [...(task.dependsOn ?? [])],
      role: roleForSection(task.section),
    };
  });
}

interface TeamState {
  team: DocumentTeam;
  tasks: AssignedPlanTask[];
  completed: Set<string>;
  claims: Map<string, TaskClaim>;
}

export class DocumentTeamScheduler {
  static readonly MAX_ACTIVE_TEAMS = 3;
  static readonly SLOTS_PER_TEAM = 12;
  static readonly MAX_ACTIVE_SLOTS = 36;

  private readonly teams = new Map<string, TeamState>();
  private readonly documentGenerations = new Map<string, number>();
  private readonly claimGenerations = new Map<string, number>();

  get activeTeamCount(): number { return this.teams.size; }
  get activeSlotCount(): number { return this.teams.size * DocumentTeamScheduler.SLOTS_PER_TEAM; }

  activateTeam(documentId: string, tasks: readonly PlanTask[]): DocumentTeam {
    const document = documentId.trim();
    if (!document) throw new Error("documentId is required");
    if (this.teams.has(document)) throw new Error(`document team already active: ${document}`);
    if (this.teams.size >= DocumentTeamScheduler.MAX_ACTIVE_TEAMS) throw new Error("active document team limit of 3 reached");
    const assigned = assignPlanTasks(tasks);
    const taskIds = new Set(assigned.map((task) => task.id));
    for (const task of assigned) {
      for (const dependency of task.dependsOn) {
        if (!taskIds.has(dependency)) throw new Error(`unknown dependency ${dependency} for task ${task.id}`);
        if (dependency === task.id) throw new Error(`task ${task.id} cannot depend on itself`);
      }
    }
    const generation = (this.documentGenerations.get(document) ?? 0) + 1;
    this.documentGenerations.set(document, generation);
    const team: DocumentTeam = { id: document, documentId: document, generation, slots: 12 };
    this.teams.set(team.id, { team, tasks: assigned, completed: new Set(), claims: new Map() });
    return team;
  }

  readyTasks(teamId: string): AssignedPlanTask[] {
    const state = this.requireTeam(teamId);
    return state.tasks.filter((task) =>
      !state.completed.has(task.id)
      && !state.claims.has(task.id)
      && task.dependsOn.every((dependency) => state.completed.has(dependency))
      && (task.access === "readOnly" || !this.hasMutationClaim(task.eventId)),
    );
  }

  claimReady(teamId: string, role: DocumentAgentRole): TaskClaim | undefined {
    const state = this.requireTeam(teamId);
    if (!DOCUMENT_TEAM_ROLES.includes(role)) throw new Error(`unknown document agent role ${role}`);
    const task = this.readyTasks(teamId).find((candidate) => candidate.role === role);
    if (!task) return undefined;
    const key = `${teamId}\u0000${task.id}`;
    const generation = (this.claimGenerations.get(key) ?? 0) + 1;
    this.claimGenerations.set(key, generation);
    const claim: TaskClaim = {
      teamId,
      teamGeneration: state.team.generation,
      taskId: task.id,
      eventId: task.eventId,
      access: task.access,
      role: task.role,
      generation,
    };
    state.claims.set(task.id, claim);
    return { ...claim };
  }

  releaseClaim(claim: TaskClaim): boolean {
    const state = this.teams.get(claim.teamId);
    if (!state || state.team.generation !== claim.teamGeneration) return false;
    const current = state.claims.get(claim.taskId);
    if (!current || current.generation !== claim.generation) return false;
    state.claims.delete(claim.taskId);
    return true;
  }

  complete(claim: TaskClaim): boolean {
    const state = this.teams.get(claim.teamId);
    if (!state || state.team.generation !== claim.teamGeneration) return false;
    const current = state.claims.get(claim.taskId);
    if (!current || current.generation !== claim.generation) return false;
    state.claims.delete(claim.taskId);
    state.completed.add(claim.taskId);
    return true;
  }

  releaseTeam(teamId: string, generation: number): boolean {
    const state = this.teams.get(teamId);
    if (!state || state.team.generation !== generation) return false;
    this.teams.delete(teamId);
    return true;
  }

  private hasMutationClaim(eventId: string): boolean {
    for (const state of this.teams.values()) {
      for (const claim of state.claims.values()) {
        if (claim.access === "mutation" && claim.eventId === eventId) return true;
      }
    }
    return false;
  }

  private requireTeam(teamId: string): TeamState {
    const state = this.teams.get(teamId);
    if (!state) throw new Error(`unknown document team ${teamId}`);
    return state;
  }
}
