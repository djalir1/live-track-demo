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
  // We're only "initialised" once Supabase has told us whether there IS a
  // session. Before that, loading must be true.
  const [initialised, setInitialised] = useState(false);

  // Loading is DERIVED. Every consumer that checks `loading` also gets a
  // correct answer while role is being fetched, which is what eliminates the
  // admin-briefly-sees-/track flash: an admin's role isn't "user" and isn't
  // known yet, so loading stays true until fetchRole() resolves.
  const loading = !initialised || (user != null && role == null);

  // Prevents duplicate role fetches for the same uid across StrictMode double-invokes.
  const roleFetchFor = useRef<string | null>(null);
  // Tracks the last uid we've seen so we can wipe role on identity changes.
  const lastUidRef = useRef<string | null>(null);

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
        if (cancelled || roleFetchFor.current !== uid) return;
        if (error) {
          console.error("[auth] fetchRole error", error);
          setRole("user");
          return;
        }
        setRole(pickRole((data ?? []).map((r) => r.role as string)));
      } catch (e) {
        console.error("[auth] fetchRole exception", e);
        if (!cancelled && roleFetchFor.current === uid) setRole("user");
      }
    };

    // onAuthStateChange fires INITIAL_SESSION synchronously on subscribe.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      const uid = s?.user?.id ?? null;
      const prevUid = lastUidRef.current;
      lastUidRef.current = uid;

      setSession(s);
      setUser(s?.user ?? null);

      if (uid) {
        // Wipe stale role only when the identity actually changes. Token
        // refreshes for the same user must not reset role — that would flash
        // an unknown-role loader mid-session.
        if (uid !== prevUid) {
          roleFetchFor.current = null;
          setRole(null);
          fetchRole(uid);
        }
      } else {
        roleFetchFor.current = null;
        setRole(null);
      }
      if (event === "INITIAL_SESSION") setInitialised(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    // Flip the device to offline BEFORE the session is torn down — otherwise
    // the JWT is already gone and RLS blocks the update, and the driver
    // continues to look "online" to admins until natural staleness kicks in.
    // UPDATE (not upsert) so admin accounts without a device_status row stay
    // clean; the tracker's own stop() also does this on the Stop button.
    const uid = lastUidRef.current;
    if (uid) {
      try {
        await supabase
          .from("device_status")
          .update({ status: "offline", is_tracking: false, last_seen: new Date().toISOString() })
          .eq("user_id", uid);
      } catch (e) {
        console.error("[auth] mark offline on signOut failed", e);
      }
    }
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("[auth] signOut exception", e);
    }
    roleFetchFor.current = null;
    lastUidRef.current = null;
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
