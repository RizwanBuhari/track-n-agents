// Team Demo Rule: one operations login plays the case owner and a second
// plays the operations manager. Fictional people.
export const DEMO_USERS = {
  owner: { id: "owner", name: "Maya Haddad", role: "case_owner", title: "Operations" },
  manager: { id: "manager", name: "Daniel Okafor", role: "operations_manager", title: "Operations manager" },
} as const;

export type DemoUser = (typeof DEMO_USERS)[keyof typeof DEMO_USERS];

export function userById(id: string | undefined): DemoUser {
  return id === "manager" ? DEMO_USERS.manager : DEMO_USERS.owner;
}
