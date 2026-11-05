import { AuthForm } from "./auth/auth-form";
import { HeadlineWord, ListingToy, StepsDemo } from "./landing-interactive";

// Set this to the Chrome Web Store listing once the extension is published.
const chromeExtensionUrl: string | null = null;

function Brand() {
  return (
    <span className="landing-brand">
      <span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>
      RoleSave
    </span>
  );
}

export function LandingPage() {
  return (
    <div className="landing">
      <div className="landing-top">
        <header className="landing-nav">
          <Brand />
          <nav aria-label="Page sections">
            <a href="#how-it-works">How it works</a>
            <a href="#extension">Extension</a>
          </nav>
        </header>
        <div className="landing-hero">
          <section className="auth-intro">
            <p className="eyebrow">Your private job-search record</p>
            <h1>Keep the details.<br />Lose the <HeadlineWord /></h1>
            <p>RoleSave saves job descriptions before listings disappear, and keeps every application, status, and next step in one place.</p>
          </section>
          <AuthForm />
        </div>
      </div>

      <main>
        <section aria-labelledby="how-it-works-title" className="landing-section" id="how-it-works">
          <p className="eyebrow">How it works</p>
          <h2 id="how-it-works-title">From job posting to outcome, in four steps.</h2>
          <p className="landing-section-intro">Don’t take our word for it. Click through it yourself. It’s only a demo, so nothing gets saved.</p>
          <StepsDemo />
        </section>

        <section aria-labelledby="extension-title" className="landing-extension" id="extension">
          <div>
            <p className="eyebrow">Chrome extension</p>
            <h2 id="extension-title">Save a role from the page you’re on.</h2>
            <p>The extension reads the company and position from the job posting, lets you fix anything it got wrong, and saves the page to your account. Saving carries on in the background, even if you close the popup.</p>
            {chromeExtensionUrl ? (
              <a className="landing-extension-link" href={chromeExtensionUrl} rel="noreferrer" target="_blank">Add to Chrome</a>
            ) : (
              <span className="landing-extension-soon">Coming soon to the Chrome Web Store</span>
            )}
            <small>You can also add roles by hand from the dashboard.</small>
          </div>

          <ListingToy />
        </section>
      </main>

      <footer className="landing-footer">
        <Brand />
        <p>RoleSave is a tracker. It doesn’t apply for you, score your resume, or recommend jobs.</p>
      </footer>
    </div>
  );
}
