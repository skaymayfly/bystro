/** Roles a user can have inside an organization, from most to least privileged. */
export const ROLES = ["owner", "admin", "member"] as const;

export type Role = (typeof ROLES)[number];
