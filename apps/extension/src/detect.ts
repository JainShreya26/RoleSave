export interface DetectedPage {
  company: string;
  position: string;
  title: string;
  jobId: string | null;
  /** True when the details were guessed rather than read from job data. */
  uncertain: boolean;
}

/**
 * Reads job details from the current page.
 *
 * chrome.scripting.executeScript serializes this function and runs it inside
 * the page, so it must not use anything declared outside its own body.
 */
export function detectJobPage(): DetectedPage {
  type JsonRecord = Record<string, unknown>;

  const collapse = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  const key = (value: string) => value.toLowerCase();

  // Job data is often HTML-escaped, sometimes twice.
  const plainText = (value: unknown) => {
    let text = collapse(value);
    for (let pass = 0; pass < 2 && /[&<]/.test(text); pass += 1) {
      text = collapse(new DOMParser().parseFromString(text, "text/html").documentElement.textContent);
    }
    return text;
  };

  // Job data

  const postings: JsonRecord[] = [];
  const isPosting = (record: JsonRecord) => {
    const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    return types.some((type) => typeof type === "string" && /(^|[/#:])JobPosting$/i.test(type));
  };
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = node as JsonRecord;
    if (isPosting(record)) {
      postings.push(record);
      return;
    }
    Object.values(record).forEach((value) => visit(value, depth + 1));
  };
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      // Raw line breaks inside strings are invalid JSON but common in job data.
      visit(JSON.parse((script.textContent || "null").replace(/[\r\n\t]+/g, " ")), 0);
    } catch {
      // Invalid job data should not prevent reading the rest of the page.
    }
  }

  const heading = plainText(document.querySelector("h1")?.textContent);
  const postingTitle = (posting: JsonRecord | undefined) => plainText(posting?.title) || plainText(posting?.name);
  const samePage = (posting: JsonRecord) => {
    try {
      return typeof posting.url === "string" && new URL(posting.url, location.href).pathname === location.pathname;
    } catch {
      return false;
    }
  };
  const only = (matches: JsonRecord[]) => (matches.length === 1 ? matches[0] : undefined);
  // A page with several postings is usually a list, or shows similar jobs. Use
  // one only if it clearly is the job being viewed.
  const job =
    postings.length <= 1
      ? postings[0]
      : only(postings.filter(samePage)) ??
        only(postings.filter((posting) => heading !== "" && key(postingTitle(posting)) === key(heading)));

  // Page signals

  const parseGreenhouseTitle = (value: string) => {
    const full = collapse(value);
    const normalized = full.replace(/^Job Application for\s+/i, "");
    if (normalized === full) return null;
    const separator = normalized.lastIndexOf(" at ");
    if (separator < 1) return null;
    const position = collapse(normalized.slice(0, separator));
    const company = collapse(normalized.slice(separator + 4)).replace(/\s+[|\u2013\u2014-]\s+Greenhouse.*$/i, "");
    return position && company ? { company, position } : null;
  };
  const socialTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
  const greenhouseTitle = parseGreenhouseTitle(document.title) || parseGreenhouseTitle(socialTitle || "");

  const hostname = location.hostname.toLowerCase();
  // Job boards list every employer, so nothing about the site names this one.
  const onJobBoard = /(^|\.)(linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|ziprecruiter\.com|monster\.com|dice\.com|wellfound\.com)$/.test(hostname);
  const onHiringPlatform =
    /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com|teamtailor\.com|breezy\.hr|bamboohr\.com|recruitee\.com|rippling\.com|gem\.com|dover\.com|ultipro\.com|ukg\.com|paylocity\.com|successfactors\.(com|eu)|taleo\.net|adp\.com|oraclecloud\.com|paycomonline\.net|avature\.net)$/.test(
      hostname,
    );
  const platformName =
    /^(greenhouse|lever|ashby|workday|smartrecruiters|icims|jobvite|workable|teamtailor|breezy|bamboohr|recruitee|rippling|gem|dover|ultipro|ukg|paylocity|successfactors|taleo|linkedin|indeed|glassdoor|ziprecruiter|monster|dice|wellfound)( jobs?| careers?)?$/i;
  // What a careers site calls itself, as opposed to who runs it.
  const careerPage =
    "opportunities|find opportunities|(careers?|jobs?|employment) (opportunit(y|ies)|site|portal|cent(er|re)|page|board|search|openings|listings)";
  const genericCompany = new RegExp(
    `^(company|our company|the company|about|about us|careers?|jobs?|employment|openings?|open (positions?|roles?)|current openings|search( results)?|home|logo|menu|hiring|job details?|overview|apply|apply now|${careerPage})$`,
    "i",
  );
  const plausibleCompany = (value: string) =>
    value.length >= 2 && value.length <= 80 && !genericCompany.test(value) && !platformName.test(value);
  const genericPosition = new RegExp(
    `^(careers?|jobs?|employment|job (details?|description)|open (positions?|roles?)|current openings|join (our|the) team|work with us|search( results)?|home|apply|apply now|(page )?not found|${careerPage})$`,
    "i",
  );
  const plausiblePosition = (value: string) =>
    value.length >= 2 && value.length <= 200 && !genericPosition.test(value);
  const withoutCareerWords = (value: string) =>
    collapse(value)
      .replace(/^(careers?|jobs?|opportunities)\s+(at|@)\s+/i, "")
      .replace(/\s+(careers?( (opportunities|site|portal|center|centre))?|jobs?( (opportunities|board))?|employment( opportunities)?|opportunities|hiring|recruiting)$/i, "");

  const titleParts = plainText(document.title)
    .split(/\s+[|\u2013\u2014\u00b7-]\s+/)
    .map(collapse)
    .filter(Boolean);
  const hostLabels = hostname.split(".");
  const namesThisSite = (segment: string) => hostLabels.includes(key(segment).replace(/[^a-z0-9]/g, ""));

  // Position

  const positionFromJob = postingTitle(job);
  const positionFromHeading = plausiblePosition(heading) ? heading : "";
  const position =
    positionFromJob ||
    greenhouseTitle?.position ||
    positionFromHeading ||
    titleParts.find((part) => {
      const name = withoutCareerWords(part);
      return plausiblePosition(part) && !namesThisSite(name) && !platformName.test(name);
    }) ||
    "";

  // Company

  const organizationName = (value: unknown): string => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = organizationName(entry);
        if (found) return found;
      }
      return "";
    }
    if (typeof value === "string") return /^https?:/i.test(value) ? "" : plainText(value);
    if (value && typeof value === "object") {
      const record = value as JsonRecord;
      return plainText(record.name) || plainText(record.legalName);
    }
    return "";
  };

  // Workday sites often list a legal entity with a cost-center code, such as
  // "2100 NVIDIA USA". The subdomain usually names the employer.
  const withoutLegalEntity = (value: string) => {
    if (!hostname.endsWith(".myworkdayjobs.com")) return value;
    const employerWord = value.split(" ").find((word) => key(word) === hostLabels[0]);
    return employerWord ?? value.replace(/^\d+\s+/, "");
  };

  const companyFromSelector = (() => {
    const elements = document.querySelectorAll<HTMLElement>(
      '[data-testid="company-name"], [data-testid*="companyName" i], .company-name, .job__company, .job-company, [class*="company-name"], [data-company-name], [data-company]',
    );
    for (const element of elements) {
      const text = element.innerText ?? element.textContent ?? "";
      // A company name is one line. More than that is a menu or a whole section.
      if (text.split("\n").filter((line) => line.trim()).length > 1) continue;
      const name = collapse(text).replace(/^at\s+/i, "");
      if (plausibleCompany(name)) return name;
    }
    return "";
  })();
  // Careers sites usually show the employer's logo, named in its alt text.
  const companyFromLogo = (() => {
    if (onJobBoard) return "";
    const images = document.querySelectorAll<HTMLImageElement>(
      'header img[alt], nav img[alt], [class*="navbar-brand" i] img[alt], img[class*="logo" i][alt], [class*="logo" i] > img[alt], [id*="logo" i] img[alt]',
    );
    for (const image of images) {
      if (image.closest("footer")) continue;
      const name = collapse(image.getAttribute("alt"))
        .replace(/^logo( of| for)?\s+/i, "")
        .replace(/(\s+-)?\s+(company\s+)?logo$/i, "")
        .replace(/(\s+-)?\s+home( ?page)?$/i, "");
      const elsewhere = /^(firefox|(google )?chrome|safari|internet explorer|(microsoft )?edge|opera|facebook|twitter|x|instagram|youtube|tiktok)$/i;
      if (plausibleCompany(name) && !elsewhere.test(name)) return name;
    }
    return "";
  })();
  const siteName = withoutCareerWords(
    plainText(document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content),
  );
  // Titles usually read "Position - Location | Company", so the last other part
  // is the most likely company.
  const repeatsPosition = (segment: string) =>
    position !== "" && (key(segment).includes(key(position)) || key(position).includes(key(segment)));
  const companyFromTitle = onJobBoard
    ? ""
    : titleParts.map(withoutCareerWords).filter((part) => plausibleCompany(part) && !repeatsPosition(part)).at(-1);
  const company =
    withoutLegalEntity(organizationName(job?.hiringOrganization)) ||
    greenhouseTitle?.company ||
    companyFromSelector ||
    (plausibleCompany(siteName) ? siteName : "") ||
    companyFromLogo ||
    companyFromTitle ||
    (onJobBoard || onHiringPlatform ? "" : hostname.replace(/^www\./, ""));

  // Job ID

  // schema.org allows identifier to be a bare string, a PropertyValue, or an
  // array of either. A PropertyValue's name labels who issued the ID, so only
  // its value can hold the ID itself.
  const readIdentifier = (value: unknown): string | null => {
    if (typeof value === "string" || typeof value === "number") return collapse(String(value)) || null;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = readIdentifier(entry);
        if (found) return found;
      }
      return null;
    }
    if (value && typeof value === "object") {
      const record = value as JsonRecord;
      return readIdentifier(record.value) ?? readIdentifier(record.identifier);
    }
    return null;
  };
  const identifier = readIdentifier(job?.identifier);
  const jobId = identifier && identifier.length <= 100 && key(identifier) !== key(company) ? identifier : null;

  // Confidence

  // These frames are from other sites, so the page cannot read the job inside.
  const embeddedBoard = document.querySelector(
    ["greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com", "smartrecruiters.com", "icims.com", "jobvite.com", "workable.com"]
      .map((host) => `iframe[src*="${host}"]`)
      .join(", "),
  );
  const fromJobData = Boolean(job) || Boolean(greenhouseTitle);
  const fromPageMarkup = Boolean(companyFromSelector && positionFromHeading && !embeddedBoard);

  return {
    company: company.slice(0, 200),
    position: position.slice(0, 300),
    title: plainText(document.title) || position,
    jobId,
    uncertain: !company || !position || !(fromJobData || fromPageMarkup),
  };
}
