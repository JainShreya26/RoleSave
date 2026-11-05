import "server-only";

import { cache } from "react";
import { requireViewer } from "@/lib/auth";

const missingSchemaCodes = new Set(["PGRST205", "42P01", "42703"]);

export const jobSearchFeaturesAvailable = cache(async (): Promise<boolean> => {
  const { supabase } = await requireViewer();
  const [actions, attachments, triage] = await Promise.all([
    supabase.from("application_actions").select("id").limit(0),
    supabase.from("application_attachments").select("id").limit(0),
    supabase.from("applications").select("triage_decision").limit(0),
  ]);

  const errors = [actions.error, attachments.error, triage.error].filter((error) => error !== null);
  const unexpected = errors.find((error) => !missingSchemaCodes.has(error.code));
  if (unexpected) throw new Error(`Unable to check job search features: ${unexpected.message}`);
  return errors.length === 0;
});
