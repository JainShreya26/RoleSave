import { selectableApplicationStatuses, type ApplicationStatus } from "@rolesave/types";

/** What the roles table needs for each role. */
export interface RoleListItem {
  applied_at: string | null;
  company: string;
  document_id: string | null;
  document_status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED" | null;
  id: string;
  original_url: string | null;
  position: string;
  status: ApplicationStatus;
  updated_at: string;
}

/** The colour a status is shown in, wherever it appears. */
export function statusTone(status: ApplicationStatus) {
  return {
    APPLIED: "blue",
    ASSESSMENT: "violet",
    INTERVIEW: "green",
    NEEDS_REVIEW: "amber",
    OFFER: "green",
    REJECTED: "rose",
    SAVED: "neutral",
    WITHDRAWN: "neutral",
  }[status];
}

/** Applied and still in progress: no outcome yet. */
const activeStatuses = new Set<ApplicationStatus>(["APPLIED", "ASSESSMENT", "INTERVIEW"]);

export function countActiveRoles(roles: Pick<RoleListItem, "status">[]) {
  return roles.filter((role) => activeStatuses.has(role.status)).length;
}

export type RoleSortKey = "applied" | "company" | "status" | "updated";
export type SortDirection = "asc" | "desc";
export interface RoleSort {
  direction: SortDirection;
  key: RoleSortKey;
}

export const defaultRoleSort: RoleSort = { direction: "desc", key: "updated" };

// The direction a column starts in: dates newest first, everything else in reading order.
const firstDirection: Record<RoleSortKey, SortDirection> = {
  applied: "desc",
  company: "asc",
  status: "asc",
  updated: "desc",
};

export function parseStatusFilter(value: string | null): ApplicationStatus | null {
  return selectableApplicationStatuses.find((status) => status === value) ?? null;
}

/** Reads a sort from the page address, such as `company-asc`. Anything else is the default. */
export function parseRoleSort(value: string | null): RoleSort {
  const [key, direction] = (value ?? "").split("-");
  if (key && Object.hasOwn(firstDirection, key) && (direction === "asc" || direction === "desc")) {
    return { direction, key: key as RoleSortKey };
  }
  return defaultRoleSort;
}

/** The sort as it goes in the page address, or null for the default, which keeps addresses short. */
export function formatRoleSort(sort: RoleSort) {
  return sort.key === defaultRoleSort.key && sort.direction === defaultRoleSort.direction
    ? null
    : `${sort.key}-${sort.direction}`;
}

/** Choosing the current column reverses it. Choosing another starts that one in its usual direction. */
export function nextRoleSort(current: RoleSort, key: RoleSortKey): RoleSort {
  if (current.key !== key) return { direction: firstDirection[key], key };
  return { direction: current.direction === "asc" ? "desc" : "asc", key };
}

function searchable(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Every word has to appear somewhere in the company or position, in any order. */
export function searchRoles<Role extends Pick<RoleListItem, "company" | "position">>(roles: Role[], query: string) {
  const terms = searchable(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return roles;
  return roles.filter((role) => {
    const text = searchable(`${role.company} ${role.position}`);
    return terms.every((term) => text.includes(term));
  });
}

export function countByStatus(roles: Pick<RoleListItem, "status">[]) {
  const counts = new Map<ApplicationStatus, number>();
  for (const role of roles) counts.set(role.status, (counts.get(role.status) ?? 0) + 1);
  return counts;
}

const pipelinePosition = (status: ApplicationStatus) => {
  const position = selectableApplicationStatuses.findIndex((item) => item === status);
  return position === -1 ? selectableApplicationStatuses.length : position;
};

export function sortRoles<Role extends Pick<RoleListItem, "applied_at" | "company" | "id" | "position" | "status" | "updated_at">>(roles: Role[], sort: RoleSort) {
  const direction = sort.direction === "asc" ? 1 : -1;
  const newestUpdateFirst = (left: Role, right: Role) =>
    Date.parse(right.updated_at) - Date.parse(left.updated_at) || left.id.localeCompare(right.id);

  return [...roles].sort((left, right) => {
    if (sort.key === "applied") {
      // A role with no date stays at the bottom in both directions, so reversing shows real dates first.
      if (!left.applied_at || !right.applied_at) {
        return Number(!left.applied_at) - Number(!right.applied_at) || newestUpdateFirst(left, right);
      }
      return direction * (Date.parse(left.applied_at) - Date.parse(right.applied_at)) || newestUpdateFirst(left, right);
    }
    if (sort.key === "company") {
      const order = left.company.localeCompare(right.company, undefined, { sensitivity: "base" })
        || left.position.localeCompare(right.position, undefined, { sensitivity: "base" });
      return direction * order || newestUpdateFirst(left, right);
    }
    if (sort.key === "status") {
      return direction * (pipelinePosition(left.status) - pipelinePosition(right.status)) || newestUpdateFirst(left, right);
    }
    return direction * (Date.parse(left.updated_at) - Date.parse(right.updated_at)) || left.id.localeCompare(right.id);
  });
}
