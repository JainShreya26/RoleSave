// Creates a demo account with a realistic spread of roles, timeline entries,
// and actions, so a fresh local stack has something to look at.
//
//   pnpm seed:demo
//
// It goes through Supabase Auth and the same row-level security the app uses,
// rather than writing rows directly. Running it again replaces the demo
// account. It refuses any Supabase that is not on this computer.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = process.env.DEMO_EMAIL ?? "demo@rolesave.test";
// Only ever used against local Supabase, which the check below enforces.
const password = process.env.DEMO_PASSWORD ?? "rolesave-demo";

if (!url || !publicKey || !secretKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY in apps/web/.env.local first.");
}
const hostname = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname)) {
  throw new Error(`Refusing to seed ${new URL(url).origin}. The demo account is for local Supabase only.`);
}

const options = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, secretKey, options);

type Status = "SAVED" | "APPLIED" | "ASSESSMENT" | "INTERVIEW" | "OFFER" | "REJECTED" | "WITHDRAWN";
type EventType = "GENERAL_UPDATE" | "MARKED_AS_APPLIED" | "MANUAL_CORRECTION" | "APPLICATION_WITHDRAWN";

interface DemoRole {
  company: string;
  position: string;
  url: string;
  status: Status;
  daysAgo: number;
  // Status changes after the role was added, oldest first, in days ago.
  history?: { status: Status; daysAgo: number }[];
  actions?: { title: string; dueInDays: number; completed?: boolean }[];
}

const roles: DemoRole[] = [
  {
    company: "Northwind Analytics", position: "Senior Data Engineer", status: "INTERVIEW", daysAgo: 21,
    url: "https://boards.greenhouse.io/northwind/jobs/4101001",
    history: [{ status: "APPLIED", daysAgo: 20 }, { status: "ASSESSMENT", daysAgo: 14 }, { status: "INTERVIEW", daysAgo: 6 }],
    actions: [
      { title: "Prepare system design examples", dueInDays: 1 },
      { title: "Send thank-you note to the hiring manager", dueInDays: -1 },
      { title: "Finish take-home assessment", dueInDays: -9, completed: true },
    ],
  },
  {
    company: "Blue Harbor Health", position: "Platform Engineer", status: "APPLIED", daysAgo: 9,
    url: "https://jobs.lever.co/blueharbor/7c1d2e3f-0000-4000-8000-000000000001",
    history: [{ status: "APPLIED", daysAgo: 8 }],
    actions: [{ title: "Follow up with the recruiter", dueInDays: 0 }],
  },
  {
    company: "Copperline Robotics", position: "Backend Engineer, Fleet", status: "ASSESSMENT", daysAgo: 12,
    url: "https://jobs.ashbyhq.com/copperline/2f9a8b7c-0000-4000-8000-000000000002",
    history: [{ status: "APPLIED", daysAgo: 11 }, { status: "ASSESSMENT", daysAgo: 3 }],
    actions: [{ title: "Submit the coding exercise", dueInDays: 4 }],
  },
  {
    company: "Fernway Logistics", position: "Staff Software Engineer", status: "SAVED", daysAgo: 2,
    url: "https://fernway.wd1.myworkdayjobs.com/en-US/careers/job/Remote/Staff-Software-Engineer_R-2207",
    actions: [{ title: "Ask a former colleague for a referral", dueInDays: 3 }],
  },
  {
    company: "Lumen Street Media", position: "Full Stack Engineer", status: "OFFER", daysAgo: 35,
    url: "https://boards.greenhouse.io/lumenstreet/jobs/5550002",
    history: [{ status: "APPLIED", daysAgo: 34 }, { status: "INTERVIEW", daysAgo: 20 }, { status: "OFFER", daysAgo: 2 }],
    actions: [{ title: "Reply to the offer", dueInDays: 5 }],
  },
  {
    company: "Quarry & Pine", position: "Software Engineer II", status: "REJECTED", daysAgo: 40,
    url: "https://jobs.lever.co/quarrypine/91b2c3d4-0000-4000-8000-000000000003",
    history: [{ status: "APPLIED", daysAgo: 39 }, { status: "REJECTED", daysAgo: 25 }],
  },
  {
    company: "Saltmarsh Energy", position: "DevOps Engineer", status: "WITHDRAWN", daysAgo: 28,
    url: "https://jobs.ashbyhq.com/saltmarsh/5d6e7f80-0000-4000-8000-000000000004",
    history: [{ status: "APPLIED", daysAgo: 27 }, { status: "WITHDRAWN", daysAgo: 15 }],
  },
  {
    company: "Tidewater Labs", position: "Machine Learning Engineer", status: "SAVED", daysAgo: 1,
    url: "https://boards.greenhouse.io/tidewater/jobs/6660003",
  },
];

const dayMs = 86_400_000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * dayMs).toISOString();
const due = (inDays: number) => {
  const value = new Date(Date.now() + inDays * dayMs);
  value.setHours(10, 0, 0, 0);
  return value.toISOString();
};

async function removeExistingDemoUser() {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const existing = data.users.find((user) => user.email === email);
    if (existing) {
      // Deleting the user removes its roles, timeline, and actions with it.
      const removed = await admin.auth.admin.deleteUser(existing.id);
      if (removed.error) throw removed.error;
      return;
    }
    if (data.users.length < 200) return;
  }
}

async function main() {
  await removeExistingDemoUser();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
  if (created.error || !created.data.user) throw created.error ?? new Error("Could not create the demo user.");
  const userId = created.data.user.id;

  const client = createClient(url!, publicKey!, options);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  for (const role of roles) {
    const appliedChange = role.history?.find((change) => change.status === "APPLIED");
    const { data: application, error } = await client.from("applications").insert({
      applied_at: role.status === "SAVED" ? null : at(appliedChange?.daysAgo ?? role.daysAgo),
      company: role.company,
      original_url: role.url,
      position: role.position,
      source: "MANUAL",
      status: role.status,
      user_id: userId,
    }).select("id").single();
    if (error || !application) throw error ?? new Error(`Could not add ${role.company}.`);

    const events: { event_type: EventType; event_time: string; evidence: string; previous_status: Status | null; new_status: Status }[] = [{
      event_type: "GENERAL_UPDATE", event_time: at(role.daysAgo), evidence: "Application created manually",
      previous_status: null, new_status: "SAVED",
    }];
    let previous: Status = "SAVED";
    for (const change of role.history ?? []) {
      events.push({
        event_type: change.status === "APPLIED" ? "MARKED_AS_APPLIED"
          : change.status === "WITHDRAWN" ? "APPLICATION_WITHDRAWN" : "MANUAL_CORRECTION",
        event_time: at(change.daysAgo),
        evidence: change.status === "APPLIED" ? "Marked as applied" : `Status changed manually from ${titleCase(previous)} to ${titleCase(change.status)}`,
        previous_status: previous,
        new_status: change.status,
      });
      previous = change.status;
    }
    const timeline = await client.from("application_events").insert(events.map((event) => ({
      ...event, application_id: application.id, source: "MANUAL" as const, user_id: userId,
    })));
    if (timeline.error) throw timeline.error;

    if (role.actions?.length) {
      const actions = await client.from("application_actions").insert(role.actions.map((action) => ({
        application_id: application.id,
        completed_at: action.completed ? at(-action.dueInDays) : null,
        due_at: due(action.dueInDays),
        title: action.title,
        user_id: userId,
      })));
      if (actions.error) throw actions.error;
    }
  }

  console.log(`Seeded ${roles.length} demo roles.`);
  console.log(`Sign in at the dashboard with ${email} / ${password}`);
}

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
