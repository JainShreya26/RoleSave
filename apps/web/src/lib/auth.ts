import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireViewer() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    redirect("/auth");
  }

  return {
    supabase,
    viewer: {
      email: typeof claims.email === "string" ? claims.email : "Signed-in user",
      id: claims.sub,
    },
  };
}
