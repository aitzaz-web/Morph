// Ledgerly's app shell. The dashboard is a Morph surface: Ledgerly hands over its components, the
// signed-in user's data and its actions, and Morph renders that user's own version of the page.
// This file only imports Morph's public package, the way any company would.

import { MorphProvider, MorphSurface, type Actions } from "@morph/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "../server/users.ts";
import { COMPONENTS } from "./LedgerComponents.tsx";
import { api, DataProvider, useData } from "./data.tsx";

type DemoUser = Pick<User, "id" | "name" | "role">;

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [config, setConfig] = useState<{ morphUrl: string } | null>(null);

  useEffect(() => {
    api<{ morphUrl: string }>("/api/config").then(setConfig);
    api<{ user: User }>("/api/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  const signIn = async (userId: string) => setUser((await api<{ user: User }>("/api/login", { userId })).user);
  const signOut = async () => {
    await api("/api/logout", {});
    setUser(null);
  };

  if (user === undefined || !config) return null;
  if (!user) return <Login onSignIn={signIn} />;

  return (
    <div className="app">
      <DemoBar user={user} onSwitch={signIn} onSignOut={signOut} />
      {/* Keyed by user so switching accounts drops the old user's Morph token and page. */}
      <DataProvider key={user.id}>
        <MorphProvider key={user.id} serviceUrl={config.morphUrl} getToken={getMorphToken}>
          <Dashboard />
        </MorphProvider>
      </DataProvider>
    </div>
  );
}

/** Ledgerly's server trades its Morph secret key for a token for this user. */
async function getMorphToken(): Promise<string> {
  return (await api<{ token: string }>("/api/morph-token", {})).token;
}

function Dashboard() {
  const { data, refresh } = useData();

  const runAction = useCallback(
    async (action: string, key: string) => {
      const r = await api<{ message: string }>("/api/action", { source: "invoices", action, key });
      refresh();
      return r.message;
    },
    [refresh],
  );
  const actions: Actions = useMemo(
    () => ({ invoices: { send_reminder: (key) => runAction("send_reminder", key), mark_paid: (key) => runAction("mark_paid", key) } }),
    [runAction],
  );

  return (
    <MorphSurface
      id="dashboard"
      components={COMPONENTS}
      data={data}
      actions={actions}
      ignoreSelector=".demo-bar"
      fallback={<div className="loading muted">Loading your dashboard…</div>}
      onError={(e) => console.warn("[morph]", e)}
    />
  );
}

function Login({ onSignIn }: { onSignIn: (id: string) => void }) {
  const [users, setUsers] = useState<DemoUser[]>([]);
  useEffect(() => {
    api<DemoUser[]>("/api/demo-users").then(setUsers);
  }, []);
  return (
    <div className="app login">
      <div className="panel login-card">
        <div className="panel-body">
          <h1 className="logo">Ledgerly</h1>
          <p className="muted">Demo: pick an account to sign in.</p>
          {users.map((u) => (
            <button key={u.id} className="btn full" onClick={() => onSignIn(u.id)}>
              {u.name} <span className="muted">· {u.role}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoBar({ user, onSwitch, onSignOut }: { user: User; onSwitch: (id: string) => void; onSignOut: () => void }) {
  const [users, setUsers] = useState<DemoUser[]>([]);
  useEffect(() => {
    api<DemoUser[]>("/api/demo-users").then(setUsers);
  }, []);
  return (
    <div className="demo-bar">
      <span>Demo · signed in as</span>
      <select value={user.id} onChange={(e) => onSwitch(e.target.value)}>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.role})
          </option>
        ))}
      </select>
      <span className="grow" />
      <button className="btn tiny ghost demo-signout" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
