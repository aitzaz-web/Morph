// Ledgerly's demo accounts. A real company has its own user system; Morph only ever gets the id
// and a few descriptive attributes from it.

export interface User {
  id: string;
  name: string;
  role: string;
  /** Reps only see their own customers; managers see everything. */
  repName: string | null;
}

export const USERS: Record<string, User> = {
  maria: { id: "maria", name: "Maria Rossi", role: "Office manager", repName: null },
  dev: { id: "dev", name: "Dev Patel", role: "Field sales rep", repName: "Dev" },
};
