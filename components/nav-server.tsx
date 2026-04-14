import "server-only";

import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";

import { NavClient } from "./nav";

// Server Component that fetches the current user on every render and passes
// the sign-out server action down as a prop. Passing server actions to Client
// Components as props is supported in Next 16 — see:
//   node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md
// ("Passing actions as props").
export async function NavServer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <NavClient
      user={user?.email ? { email: user.email } : null}
      signOutAction={signOut}
    />
  );
}
