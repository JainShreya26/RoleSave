import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { detectJobPage, type DetectedPage } from "./detect.ts";

function detect(html: string, url = "https://careers.acme.com/jobs/1"): DetectedPage {
  const { window } = new JSDOM(html, { url });
  Object.assign(globalThis, { document: window.document, location: window.location, DOMParser: window.DOMParser });
  // chrome.scripting serializes the function, so run it the same way. This
  // fails if it starts using anything declared outside its own body.
  return new Function(`return (${detectJobPage.toString()})();`)() as DetectedPage;
}

const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const posting = { "@type": "JobPosting", title: "Data Engineer", hiringOrganization: { "@type": "Organization", name: "Acme" } };

test("reads a plain job posting with full confidence", () => {
  const page = detect(`<title>Data Engineer</title>${jsonLd(posting)}`);
  assert.equal(page.company, "Acme");
  assert.equal(page.position, "Data Engineer");
  assert.equal(page.uncertain, false);
});

test("finds postings nested in other page data", () => {
  for (const data of [
    { "@type": "WebPage", mainEntity: posting },
    { "@graph": [{ "@type": "Organization" }, posting] },
    { "@type": "ItemList", itemListElement: [{ item: posting }] },
    { ...posting, "@type": "https://schema.org/JobPosting" },
    { ...posting, "@type": ["Thing", "schema:JobPosting"] },
  ]) {
    const page = detect(`<title>Careers</title>${jsonLd(data)}<h1>Careers</h1>`);
    assert.equal(page.position, "Data Engineer");
    assert.equal(page.company, "Acme");
    assert.equal(page.uncertain, false);
  }
});

test("reads the company however the posting writes it", () => {
  for (const hiringOrganization of ["Acme", [{ name: "Acme" }], { legalName: "Acme" }]) {
    const page = detect(`<title>x</title>${jsonLd({ ...posting, hiringOrganization })}`);
    assert.equal(page.company, "Acme");
  }
});

test("cleans escaped text and whitespace", () => {
  const page = detect(
    `<title>x</title>${jsonLd({ ...posting, title: "  R&amp;amp;D\n   Engineer  ", hiringOrganization: { name: "Smith &amp; Co" } })}`,
  );
  assert.equal(page.position, "R&D Engineer");
  assert.equal(page.company, "Smith & Co");
});

test("tolerates raw line breaks in job data and ignores invalid job data", () => {
  const raw = `<title>x</title><script type="application/ld+json">{"@type":"JobPosting","title":"Data\nEngineer"}</script>`;
  assert.equal(detect(raw).position, "Data Engineer");

  const invalid = detect(`<title>Data Engineer | Acme</title><script type="application/ld+json">{bad</script><h1>Data Engineer</h1>`);
  assert.equal(invalid.position, "Data Engineer");
  assert.equal(invalid.company, "Acme");
  assert.equal(invalid.uncertain, true);
});

test("reads job IDs but never a label or the company name", () => {
  const id = (identifier: unknown) => detect(`<title>x</title>${jsonLd({ ...posting, identifier })}`).jobId;
  assert.equal(id("REQ-9"), "REQ-9");
  assert.equal(id(12345), "12345");
  assert.equal(id({ "@type": "PropertyValue", name: "Acme", value: "REQ-9" }), "REQ-9");
  assert.equal(id([{ name: "Acme" }, { value: "REQ-9" }]), "REQ-9");
  assert.equal(id({ "@type": "PropertyValue", name: "Acme" }), null);
  assert.equal(id("Acme"), null);
  assert.equal(id("x".repeat(101)), null);
});

test("on a page with several postings, uses only the one being viewed", () => {
  const first = { ...posting, title: "First Result", url: "https://careers.acme.com/jobs/9" };
  const viewed = { ...posting, title: "The Job I Clicked", url: "https://careers.acme.com/jobs/1" };

  const byUrl = detect(`<title>x</title>${jsonLd([first, viewed])}`);
  assert.equal(byUrl.position, "The Job I Clicked");

  const byHeading = detect(`<title>x</title>${jsonLd([{ ...first, url: undefined }, { ...viewed, url: undefined }])}<h1>The Job I Clicked</h1>`);
  assert.equal(byHeading.position, "The Job I Clicked");

  const list = detect(`<title>Jobs in Seattle</title>${jsonLd([{ ...first, url: undefined }, { ...viewed, url: undefined }])}<h1>Jobs in Seattle</h1>`);
  assert.equal(list.position, "Jobs in Seattle");
  assert.equal(list.uncertain, true);
});

test("keeps the employer from a Workday legal entity", () => {
  const organization = (name: string) => jsonLd({ ...posting, hiringOrganization: { name } });
  const nvidia = "https://nvidia.wd5.myworkdayjobs.com/External/job/Engineer_JR1";
  assert.equal(detect(`<title></title>${organization("2100 NVIDIA USA")}`, nvidia).company, "NVIDIA");
  assert.equal(detect(`<title></title>${organization("2100 Other Group")}`, nvidia).company, "Other Group");
  assert.equal(detect(`<title>x</title>${organization("2100 Acme")}`).company, "2100 Acme");
});

test("falls back to the heading when the page title is empty", () => {
  const page = detect(`<title></title>${jsonLd(posting)}`);
  assert.equal(page.title, "Data Engineer");
});

test("reads the Greenhouse page title", () => {
  const page = detect("<title>Job Application for Data Engineer at Acme</title>", "https://job-boards.greenhouse.io/acme/jobs/1");
  assert.equal(page.company, "Acme");
  assert.equal(page.position, "Data Engineer");
  assert.equal(page.uncertain, false);
});

test("does not treat menus or labels as the company", () => {
  const menu = "About Careers Press Blog Investors Legal Contact ".repeat(6);
  const longClass = detect(`<title>Data Engineer - Acme</title><div class="company-name">${menu}</div><h1>Data Engineer</h1>`);
  assert.equal(longClass.company, "Acme");

  const twoLines = detect(`<title>Data Engineer - Acme</title><div class="company-name">About\nPress</div><h1>Data Engineer</h1>`);
  assert.equal(twoLines.company, "Acme");

  const label = detect(`<title>Data Engineer - Acme</title><div class="company-name">Our Company</div><h1>Data Engineer</h1>`);
  assert.equal(label.company, "Acme");

  const unrelatedClass = detect(`<title>Data Engineer - Acme</title><nav class="company-links">About</nav><h1>Data Engineer</h1>`);
  assert.equal(unrelatedClass.company, "Acme");
});

test("trusts a company element next to a job heading", () => {
  const page = detect(`<title>x</title><div class="company-name">at Acme</div><h1>Data Engineer</h1>`);
  assert.equal(page.company, "Acme");
  assert.equal(page.uncertain, false);
});

test("never uses a job board as the company", () => {
  const board = detect(
    `<title>Data Engineer</title><meta property="og:site_name" content="LinkedIn"><h1>Data Engineer</h1>`,
    "https://www.linkedin.com/jobs/view/1",
  );
  assert.equal(board.company, "");
  assert.equal(board.uncertain, true);
});

test("does not read a company out of a page title on a job board", () => {
  const page = detect(`<title>Feed | LinkedIn</title><h1>Your feed</h1>`, "https://www.linkedin.com/feed/");
  assert.equal(page.company, "");
  assert.equal(page.uncertain, true);
});

test("does not repeat the position as the company", () => {
  const page = detect("<title>Thanks for applying</title><h1>Thanks for applying!</h1>");
  assert.equal(page.company, "careers.acme.com");
  assert.equal(page.position, "Thanks for applying!");
  assert.equal(page.uncertain, true);
});

// Modeled on a real UKG job page: no job data, and a title naming only the careers site.
const ukgPage = (logo = '<a class="navbar-brand"><img class="small-logo logo" alt="Aquestive Therapeutics"></a>') =>
  `<title>AI Data Analyst | Career Opportunities</title><header>${logo}</header><h1>AI Data Analyst</h1>`;
const ukgUrl = "https://recruiting.ultipro.com/AQU1000AQUE/JobBoard/8a380b89/OpportunityDetail?opportunityId=aa154c5d";

test("reads the employer from the logo on a careers site", () => {
  const page = detect(ukgPage(), ukgUrl);
  assert.equal(page.company, "Aquestive Therapeutics");
  assert.equal(page.position, "AI Data Analyst");
  assert.equal(page.uncertain, true);
});

test("never uses the name of a careers site as the company", () => {
  assert.equal(detect(ukgPage(""), ukgUrl).company, "");
  for (const name of ["Career Opportunities", "Job Opportunities", "Careers Site", "Employment Opportunities", "Opportunities", "Job Board"]) {
    assert.equal(detect(`<title>Data Engineer | ${name}</title><h1>Data Engineer</h1>`, "https://jobs.example.com/1").company, "jobs.example.com", name);
  }
});

test("keeps the employer when career words follow it", () => {
  for (const title of ["Data Engineer | Acme Career Opportunities", "Data Engineer | Acme Careers", "Data Engineer | Careers at Acme", "Data Engineer | Acme Employment Opportunities"]) {
    assert.equal(detect(`<title>${title}</title><h1>Data Engineer</h1>`, "https://jobs.example.com/1").company, "Acme", title);
  }
});

test("cleans up logo text", () => {
  const logo = (alt: string) => detect(ukgPage(`<img class="logo" alt="${alt}">`), ukgUrl).company;
  assert.equal(logo("Acme logo"), "Acme");
  assert.equal(logo("Logo of Acme"), "Acme");
  assert.equal(logo("Acme - Home"), "Acme");
  assert.equal(logo("Acme Company Logo"), "Acme");
});

test("ignores logos that do not name the employer", () => {
  const logo = (html: string) => detect(ukgPage(html), ukgUrl).company;
  for (const alt of ["Logo", "Home", "Company logo", "Careers", "Career Opportunities", "UKG", "Firefox logo", "Facebook", ""]) {
    assert.equal(logo(`<img class="logo" alt="${alt}">`), "", alt);
  }
  // Only a logo in the page's own branding counts.
  assert.equal(detect(`<title>x</title><img alt="Acme"><h1>Data Engineer</h1>`, ukgUrl).company, "");
  assert.equal(detect(`<title>x</title><footer><img class="logo" alt="Acme"></footer><h1>Data Engineer</h1>`, ukgUrl).company, "");
});

test("a job board's logo is not the employer", () => {
  const page = detect(`<title>x</title><header><img class="logo" alt="Some Board"></header><h1>Data Engineer</h1>`, "https://www.linkedin.com/jobs/view/1");
  assert.equal(page.company, "");
});

test("better signals still outrank the logo", () => {
  const logo = '<header><img class="logo" alt="Parent Group"></header>';
  assert.equal(detect(`<title>x</title>${logo}${jsonLd(posting)}`).company, "Acme");
  assert.equal(detect(`<title>x</title>${logo}<div class="company-name">Acme</div><h1>Data Engineer</h1>`).company, "Acme");
  assert.equal(detect(`<title>x</title>${logo}<meta property="og:site_name" content="Acme"><h1>Data Engineer</h1>`).company, "Acme");
});

test("career words stay in a job title", () => {
  for (const position of ["Head of Recruiting", "Manager, Strategic Opportunities", "Director of Careers"]) {
    assert.equal(detect(`<title>${position} - Acme</title>`).position, position);
  }
});

test("a careers-site heading or title is not a position", () => {
  assert.equal(detect("<title>Career Opportunities</title><h1>Career Opportunities</h1>", ukgUrl).position, "");
  assert.equal(detect("<title>Find Opportunities</title><h1>Job Search</h1>", ukgUrl).position, "");
});

test("uses the site name without career words", () => {
  const page = detect(`<title>x</title><meta property="og:site_name" content="Acme Careers"><h1>Data Engineer</h1>`, "https://jobs.example.com/1");
  assert.equal(page.company, "Acme");
  assert.equal(page.uncertain, true);
});

test("works out the position when the title puts the company first", () => {
  const page = detect("<title>Acme - Senior Engineer</title>");
  assert.equal(page.position, "Senior Engineer");
  assert.equal(page.company, "Acme");
  assert.equal(page.uncertain, true);
});

test("leaves the position empty on a careers landing page", () => {
  const page = detect(`<title>Careers at Acme</title><h1>Join our team</h1><iframe src="https://boards.greenhouse.io/embed/job_app?for=acme"></iframe>`);
  assert.equal(page.position, "");
  assert.equal(page.company, "Acme");
  assert.equal(page.uncertain, true);
});

test("warns when the job sits in a frame from another site", () => {
  const page = detect(
    `<title>x</title><div class="company-name">Acme</div><h1>Data Engineer</h1><iframe src="https://boards.greenhouse.io/embed/job_app?for=acme"></iframe>`,
  );
  assert.equal(page.uncertain, true);
});

test("falls back to the hostname only on an employer's own site", () => {
  assert.equal(detect("<title>Openings</title><h1>Data Engineer</h1>", "https://www.jobs.example.com/1").company, "jobs.example.com");
  assert.equal(detect("<title>Data Engineer</title><h1>Data Engineer</h1>", "https://www.jobs.example.com/1").company, "jobs.example.com");
  assert.equal(detect("<title>Data Engineer</title><h1>Data Engineer</h1>", "https://jobs.lever.co/acme/1").company, "");
});

test("limits long values to what the database accepts", () => {
  const page = detect(`<title>x</title>${jsonLd({ ...posting, title: "p".repeat(400), hiringOrganization: { name: "c".repeat(400) } })}`);
  assert.equal(page.company.length, 200);
  assert.equal(page.position.length, 300);
});
