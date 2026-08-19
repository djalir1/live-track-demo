import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Extended for the school-transport layer (parent-phase1 branch).
// Existing pages that check `role === "admin"` still work: super admin is the
// highest-priority role, so a super-admin resolves to "admin" as before.
export type Role = "admin" | "school_admin" | "user" | "parent";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: Role | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

// Highest privilege wins if a user somehow ends up with more than one role
// (should be rare — spec says one role per user, but data drift happens).
const ROLE_PRIORITY: Role[] = ["admin", "school_admin", "parent", "user"];
function pickRole(raw: string[]): Role {
  for (const r of ROLE_PRIORITY) {
    if (raw.includes(r)) return r;
  }
  return "user";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  // Prevent concurrent role fetches for the same user (which cause Supabase
  // AuthRefreshDiscardedError on rapid re-mounts / navigation).
  const roleFetchFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchRole = async (uid: string) => {
      if (roleFetchFor.current === uid) return;
      roleFetchFor.current = uid;
      try {
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid);
        if (cancelled) return;
        if (error) {
          console.error("[auth] fetchRole error", error);
          setRole("user");
          return;
        }
        setRole(pickRole((data ?? []).map((r) => r.role as string)));
      } catch (e) {
        console.error("[auth] fetchRole exception", e);
        if (!cancelled) setRole("user");
      }
    };

    // onAuthStateChange fires INITIAL_SESSION synchronously on subscribe, so we
    // do not also need to call getSession() (which races the same auth locks
    // and can trigger AuthRefreshDiscardedError → false sign-outs).
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchRole(s.user.id);
      } else {
        roleFetchFor.current = null;
        setRole(null);
      }
      if (event === "INITIAL_SESSION") setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("[auth] signOut exception", e);
    }
    roleFetchFor.current = null;
    setRole(null);
    setUser(null);
    setSession(null);
  };

  return <Ctx.Provider value={{ user, session, role, loading, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}

/** True for accounts that may reach the /admin/* setup screens. */
export function canManageSchoolSetup(role: Role | null): boolean {
  return role === "admin" || role === "school_admin";
}
