"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

function LogoMark() {
  return <span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>;
}

function BrowserBar({ tool, url }: { tool?: ReactNode; url: string }) {
  return (
    <div className="landing-browser-bar" aria-hidden="true">
      <span className="landing-browser-dots"><i /><i /><i /></span>
      <span className="landing-browser-url">{url}</span>
      {tool}
    </div>
  );
}

/* Hero headline word */

const headlineWords = ["spreadsheet.", "sticky notes.", "40 open tabs.", "guesswork."];

export function HeadlineWord() {
  const [active, setActive] = useState(0);
  const next = () => setActive((current) => (current + 1) % headlineWords.length);

  // Plays through once and rests back on the first word, so it never competes
  // with the sign-in form for long. Hovering the word shows the next one.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      setActive(ticks % headlineWords.length);
      if (ticks === headlineWords.length) window.clearInterval(timer);
    }, 1900);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="landing-word" onMouseEnter={next}>
      <span className="sr-only">{headlineWords[0]}</span>
      <span className="landing-word-stack" aria-hidden="true">
        {headlineWords.map((word, index) => (
          <span className={index === active ? "is-active" : undefined} key={word}>{word}</span>
        ))}
      </span>
    </span>
  );
}

/* Playable four-step demo */

type Stage = "install" | "installing" | "save" | "saving" | "saved" | "apply" | "mark" | "track";
type Move = "ASSESSMENT" | "INTERVIEW" | "OFFER" | "REJECTED";

const steps: { title: string; start: Stage; stages: Stage[]; body: ReactNode }[] = [
  {
    title: "Add the extension",
    start: "install",
    stages: ["install", "installing"],
    body: <>Create an account, install the <a href="#extension">Chrome extension</a>, and sign in with the same email and password.</>,
  },
  {
    title: "Save the job",
    start: "save",
    stages: ["save", "saving", "saved"],
    body: "Open a job posting and click Save job description. RoleSave keeps a PDF of the page, so the details stay with you if the listing comes down.",
  },
  {
    title: "Apply as usual",
    start: "apply",
    stages: ["apply", "mark"],
    body: "Submit on the employer’s site, then open the extension again and click Mark as applied. The time is recorded for you.",
  },
  {
    title: "Track what happens next",
    start: "track",
    stages: ["track"],
    body: "Update the status as replies come in, add next actions with reminders, and see the full history in your dashboard.",
  },
];

const hints: Record<Stage, string> = {
  install: "Your turn. Add the extension to this pretend browser.",
  installing: "Pinning it to the toolbar…",
  save: "A job worth keeping. Fix anything the extension got wrong, then save it.",
  saving: "Keeping a PDF of the page…",
  saved: "Saved. If this listing vanishes tomorrow, your copy stays.",
  apply: "Now apply, the way you normally would.",
  mark: "Back to RoleSave to record it.",
  track: "Replies coming in? Pick what happened. Offer is a good place to start.",
};

const moves: Record<Move, { label: string; tone: string; action: string; due: string; hint: string }> = {
  ASSESSMENT: { label: "Assessment", tone: "violet", action: "Finish the take-home", due: "Due in 3 days", hint: "Logged, with a reminder so it doesn’t slip." },
  INTERVIEW: { label: "Interview", tone: "green", action: "Prep your best stories", due: "Due Friday", hint: "Nice. Your saved job description is one click away for the prep." },
  OFFER: { label: "Offer", tone: "green", action: "Read the offer twice", due: "Due tomorrow", hint: "An offer! Go tell someone. We’ll keep the paperwork." },
  REJECTED: { label: "Rejected", tone: "rose", action: "Take a walk, then on to the next one", due: "Due today", hint: "Their loss. It’s on the record, and you can move on." },
};
const moveOrder: Move[] = ["ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"];

const confettiColors = ["#f1bd61", "#17243d", "#3f6fbd", "#2f7b60", "#aa4f5e"];

// Bars of different heights, like the ones in the logo.
function makeConfetti() {
  return Array.from({ length: 36 }, (_, index) => ({
    "--c": confettiColors[index % confettiColors.length],
    "--d": `${Math.round(Math.random() * 350)}ms`,
    "--drift": `${Math.round(Math.random() * 120 - 60)}px`,
    "--h": `${[6, 11, 16][index % 3]}px`,
    "--spin": `${Math.round(Math.random() * 720 - 360)}deg`,
    "--t": `${Math.round(1100 + Math.random() * 900)}ms`,
    "--x": `${Math.round(Math.random() * 100)}%`,
  }) as CSSProperties);
}

export function StepsDemo() {
  const [stage, setStage] = useState<Stage>("install");
  const [company, setCompany] = useState("Acme");
  const [position, setPosition] = useState("Product Designer");
  const [history, setHistory] = useState<Move[]>([]);
  const [confetti, setConfetti] = useState<CSSProperties[]>([]);
  const frame = useRef<HTMLDivElement>(null);
  const followFocus = useRef(false);

  const currentStep = steps.findIndex((step) => step.stages.includes(stage));
  const installed = stage !== "install" && stage !== "installing";
  const companyName = company.trim() || "Acme";
  const positionName = position.trim() || "Product Designer";
  const latest = history.at(-1);
  const finished = latest === "OFFER" || latest === "REJECTED";

  // The "working" stages move on by themselves.
  useEffect(() => {
    const following = stage === "installing" ? "save" : stage === "saving" ? "saved" : null;
    if (!following) return;
    const timer = window.setTimeout(() => setStage(following), 1100);
    return () => window.clearTimeout(timer);
  }, [stage]);

  // Clicked buttons disappear as the demo moves on. Keep keyboard users in place
  // by handing focus to the next action, unless they have already moved away.
  useEffect(() => {
    if (!followFocus.current || !frame.current) return;
    const focused = document.activeElement;
    if (focused !== document.body && !frame.current.contains(focused)) return;
    frame.current.querySelector<HTMLElement>("[data-next]")?.focus({ preventScroll: true });
  }, [stage, history.length]);

  function advance(to: Stage) {
    followFocus.current = true;
    setStage(to);
  }

  function jump(to: Stage) {
    followFocus.current = false;
    setConfetti([]);
    setStage(to);
  }

  function pick(move: Move) {
    followFocus.current = true;
    setHistory((current) => [...current, move]);
    if (move === "OFFER") setConfetti(makeConfetti());
  }

  function startOver() {
    setCompany("Acme");
    setPosition("Product Designer");
    setHistory([]);
    setConfetti([]);
    advance("install");
  }

  const timeline = [
    { title: "Job description saved", note: "Kept as a PDF", day: 1 },
    { title: "Marked as applied", note: "Recorded by the extension", day: 1 },
    ...history.map((move, index) => ({ title: `Moved to ${moves[move].label}`, note: "Updated by you", day: 1 + (index + 1) * 6 })),
  ];
  const nextAction = latest ? moves[latest] : { action: "Follow up if it goes quiet", due: "Due in 7 days" };
  const hint = stage === "track" && latest ? moves[latest].hint : hints[stage];
  const firstOpenMove = moveOrder.find((move) => !history.includes(move));

  return (
    <div className="landing-demo">
      <ol className="landing-demo-steps">
        {steps.map((step, index) => (
          <li className={index === currentStep ? "is-active" : index < currentStep ? "is-done" : undefined} key={step.title}>
            <span className="landing-demo-number" aria-hidden="true">{index < currentStep ? "✓" : index + 1}</span>
            <div>
              <h3>
                <button aria-current={index === currentStep ? "step" : undefined} onClick={() => jump(step.start)} type="button">{step.title}</button>
              </h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="landing-demo-stage">
        <div className="landing-demo-current">
          <strong>{steps[currentStep].title}</strong>
          <p>{steps[currentStep].body}</p>
        </div>

        <div className="landing-browser" ref={frame} role="group" aria-label="RoleSave demo, nothing here is saved">
          <BrowserBar
            url={stage === "track" ? "RoleSave dashboard" : installed ? "jobs.example.com/careers/1042" : "extensions.example.com/rolesave"}
            tool={(
              <>
                <span className="landing-browser-tag">Demo</span>
                <span className="landing-browser-slot">{installed ? <LogoMark /> : null}</span>
              </>
            )}
          />

          <div className="landing-browser-page">
            {!installed && (
              <div className="landing-store">
                <LogoMark />
                <strong>RoleSave</strong>
                <small>Application Tracker</small>
                {stage === "install" ? (
                  <button className="primary-button landing-demo-cta" data-next onClick={() => advance("installing")} type="button">Add extension</button>
                ) : (
                  <button className="primary-button" disabled type="button">Adding…</button>
                )}
              </div>
            )}

            {installed && stage !== "track" && (
              <article className="landing-posting">
                <small>Acme</small>
                <h4>Product Designer</h4>
                <p className="landing-posting-tags"><span>Remote</span><span>Full time</span></p>
                <div aria-hidden="true" className="landing-posting-lines"><i /><i /><i /><i /></div>
                {stage === "apply" ? (
                  <button className="primary-button landing-demo-cta" data-next onClick={() => advance("mark")} type="button">Submit application</button>
                ) : stage === "mark" ? (
                  <p className="landing-posting-sent">Application sent. Good luck!</p>
                ) : (
                  <span className="landing-posting-apply">Submit application</span>
                )}
              </article>
            )}

            {(stage === "save" || stage === "saving" || stage === "saved" || stage === "mark") && (
              <div className={stage === "saving" ? "landing-popup is-saving" : "landing-popup"}>
                <div className="landing-popup-brand"><LogoMark /><strong>RoleSave</strong></div>
                {stage === "saved" ? (
                  <>
                    <div className="landing-popup-card is-success">
                      <small>Job description saved</small>
                      <strong>{positionName} at {companyName}</strong>
                      <span>Continue on the employer site. Open RoleSave again after you submit.</span>
                    </div>
                    <button className="primary-button landing-demo-cta" data-next onClick={() => advance("apply")} type="button">Continue to application</button>
                  </>
                ) : stage === "mark" ? (
                  <>
                    <div className="landing-popup-card">
                      <small>Application in progress</small>
                      <strong>{positionName} at {companyName}</strong>
                      <span>After you submit on the employer site, return here to record it.</span>
                    </div>
                    <button className="primary-button landing-demo-cta" data-next onClick={() => advance("track")} type="button">Mark as applied</button>
                  </>
                ) : (
                  <>
                    <div className="landing-popup-card">
                      <small>Current page</small>
                      <strong>Product Designer at Acme</strong>
                      <span>jobs.example.com/careers/1042</span>
                    </div>
                    <label>Company<input autoComplete="off" disabled={stage === "saving"} maxLength={40} onChange={(event) => setCompany(event.target.value)} value={company} /></label>
                    <label>Position<input autoComplete="off" disabled={stage === "saving"} maxLength={40} onChange={(event) => setPosition(event.target.value)} value={position} /></label>
                    {stage === "saving" ? (
                      <button className="primary-button" disabled type="button">Saving…</button>
                    ) : (
                      <button className="primary-button landing-demo-cta" data-next disabled={!company.trim() || !position.trim()} onClick={() => advance("saving")} type="button">Save job description</button>
                    )}
                  </>
                )}
              </div>
            )}

            {stage === "track" && (
              <div className="landing-dash">
                <div className="landing-dash-role">
                  <span className="company-mark" aria-hidden="true">{companyName[0].toUpperCase()}</span>
                  <span><strong>{positionName}</strong><small>{companyName}</small></span>
                  <span className={`status ${latest ? moves[latest].tone : "blue"}`} key={latest ?? "APPLIED"}><i />{latest ? moves[latest].label : "Applied"}</span>
                </div>

                <div className="landing-dash-body">
                  <div>
                    <p className="landing-dash-label">What happened?</p>
                    <div className="landing-dash-moves">
                      {moveOrder.map((move) => (
                        <button
                          className="secondary-button"
                          data-next={!finished && move === firstOpenMove ? true : undefined}
                          disabled={finished || history.includes(move)}
                          key={move}
                          onClick={() => pick(move)}
                          type="button"
                        >
                          {moves[move].label}
                        </button>
                      ))}
                    </div>
                    <p className="landing-dash-label">Next action</p>
                    <div className="landing-dash-action" key={nextAction.action}>
                      <strong>{nextAction.action}</strong>
                      <span className="action-tag reminder">{nextAction.due}</span>
                    </div>
                    {finished && <button className="text-button landing-dash-again" data-next onClick={startOver} type="button">Play again</button>}
                  </div>

                  <div>
                    <p className="landing-dash-label">Timeline</p>
                    <ol className="landing-dash-timeline">
                      {timeline.map((event) => (
                        <li key={event.title}>
                          <i aria-hidden="true" />
                          <span><strong>{event.title}</strong><small>{event.note}</small></span>
                          <small>Day {event.day}</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </div>

          {stage === "track" && confetti.length > 0 && (
            <div aria-hidden="true" className="landing-confetti">
              {confetti.map((piece, index) => <i key={index} style={piece} />)}
            </div>
          )}
        </div>

        <p aria-live="polite" className="landing-demo-hint">{hint}</p>
      </div>
    </div>
  );
}

/* Listing takedown toy */

export function ListingToy() {
  const [gone, setGone] = useState(false);

  return (
    <div className={gone ? "landing-toy is-gone" : "landing-toy"}>
      <div className="landing-browser">
        <BrowserBar url="jobs.example.com/careers/1042" />
        <div className="landing-browser-page">
          {gone ? (
            <div className="landing-toy-missing">
              <strong>404</strong>
              <span>This job is no longer available.</span>
            </div>
          ) : (
            <article className="landing-posting">
              <small>Acme</small>
              <h4>Product Designer</h4>
              <div aria-hidden="true" className="landing-posting-lines"><i /><i /><i /></div>
            </article>
          )}
        </div>
      </div>

      <div className="landing-toy-saved" key={gone ? "gone" : "live"}>
        <span aria-hidden="true">PDF</span>
        <span>
          <strong>Product Designer at Acme</strong>
          <small>{gone ? "Still here, safe in RoleSave" : "Saved to RoleSave"}</small>
        </span>
      </div>

      <button aria-pressed={gone} className="landing-toy-button" onClick={() => setGone(!gone)} type="button">
        {gone ? "Bring the listing back" : "Take the listing down"}
      </button>
    </div>
  );
}
