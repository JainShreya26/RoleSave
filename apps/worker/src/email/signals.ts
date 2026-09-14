import type { ParsedEmail } from "./types";

/**
 * The arrays `match_email_candidates` narrows on. Company folding and URL
 * parsing happen in the database so there is exactly one implementation of
 * each; this module only decides what text to hand over.
 */
export interface EmailMatchSignals {
  companyMentions: string[];
  jobIdMentions: string[];
  linkUrls: string[];
  tokens: string[];
}

// Words frequent enough in ordinary mail that matching one says nothing about
// which application a message concerns. Kept deliberately small: this exists
// to stop obvious noise, not to second-guess real company names.
const commonWords = new Set([
  "about", "above", "after", "again", "all", "also", "and", "any", "are", "available",
  "back", "because", "been", "before", "being", "below", "best", "between", "both", "but",
  "can", "come", "could", "did", "does", "doing", "done", "down", "during", "each",
  "email", "few", "for", "from", "further", "get", "great", "had", "has", "have",
  "having", "hello", "her", "here", "hers", "him", "his", "how", "into",
  "just", "know", "let", "like", "look", "made", "make", "many", "may", "message",
  "more", "most", "much", "must", "need", "new", "next", "not", "now", "off",
  "once", "one", "only", "onto", "opportunity", "other", "our", "ours", "out", "over",
  "own", "part", "please", "position", "regards", "reply", "role", "same", "see", "send",
  "sent", "she", "should", "since", "some", "soon", "still", "such", "sure", "take",
  "team", "thank", "thanks", "that", "the", "their", "theirs", "them", "then", "there",
  "these", "they", "this", "those", "through", "time", "too", "under", "until", "some",
  "very", "want", "was", "way", "well", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "will", "with", "within", "would", "you", "your",
  "yours", "apply", "applied", "applying", "application", "applications", "job", "jobs",
  "career", "careers", "hiring", "recruiter", "recruiting", "recruitment", "candidate",
  "interview", "update", "updates", "received", "review", "submit", "submitted", "com",
  "www", "http", "https", "html", "unsubscribe", "notification", "notifications", "noreply",
]);

function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !commonWords.has(token));
}

/**
 * A single token is only worth acting on when it is distinctive enough that
 * finding it in a message is meaningful. Short and common tokens can retrieve
 * a candidate but must not be enough to attach one on their own.
 */
export function isDistinctiveToken(token: string) {
  return token.length >= 5 && !commonWords.has(token);
}

// Requisition numbers as they appear in prose. Deliberately narrower than a
// bare alphanumeric run, which would match tracking codes and message IDs.
const jobIdPatterns = [
  /\b(?:job|requisition|req|position|vacancy)\s*(?:id|number|no\.?|#)?\s*[:#-]?\s*([a-z]{0,4}-?\d[a-z0-9-]{2,})\b/gi,
  /\b(R-\d{2,}-\d{3,})\b/gi,
  /\b(REQ-?\d{3,})\b/gi,
];

function collectJobIds(text: string) {
  const found = new Set<string>();
  for (const pattern of jobIdPatterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const value = match[1]?.trim();
      if (value && value.length <= 100) found.add(value);
      match = pattern.exec(text);
    }
  }
  return [...found];
}

function cleanMention(value: string) {
  const collapsed = value.replace(/\s+/g, " ").trim().replace(/[-–—|,:;]+$/, "").trim();
  // A trailing period usually ends a sentence, but not when it terminates an
  // abbreviation. Stripping it unconditionally turned "Northwind, N.A." into
  // "Northwind, N.A" and, before that, into "Northwind, N".
  return /\b[A-Za-z]\.(?:[A-Za-z]\.)*$/.test(collapsed)
    ? collapsed
    : collapsed.replace(/\.+$/, "").trim();
}

/**
 * Cuts a captured span at the first period that ends a sentence, leaving
 * abbreviations intact. Body patterns have to admit periods so "Northwind,
 * N.A." survives, which without this lets a capture run into the next
 * sentence.
 */
function truncateAtSentence(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ".") continue;
    const previous = value[index - 1] ?? "";
    const beforePrevious = value[index - 2] ?? "";
    // A lone letter before the period marks an abbreviation such as "N.A.".
    const isAbbreviation = /[A-Za-z]/.test(previous) && !/[A-Za-z]/.test(beforePrevious);
    if (!isAbbreviation) return value.slice(0, index);
  }
  return value;
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

/**
 * True when the display name is just the mailbox owner's own name, as in
 * "Hiring Manager <hiring.manager@northwind.example>". Offering a person as an employer is
 * worse than offering nothing: it contradicts every real candidate and
 * excludes the correct one.
 */
function displayNameIsSender(senderAddress: string | null, displayName: string) {
  const localPart = squash(senderAddress?.split("@")[0] ?? "");
  return localPart.length > 0 && localPart === squash(displayName);
}

/**
 * Every place a company name plausibly appears, gathered rather than chosen.
 * The database decides which of these, if any, corresponds to a tracked
 * application, so a wrong guess here costs a candidate rather than a match.
 */
export function collectCompanyMentions(email: ParsedEmail) {
  const mentions = new Set<string>();
  const searchable = `${email.subject}\n${email.bodyText}`;

  // The sender display name is the most reliable source on ATS mail, where
  // the address identifies the relay rather than the employer. It is only
  // trusted when it is not the sender's own name and the message repeats it:
  // an employer is named in the body, a person signs off with a first name.
  if (email.senderName && !displayNameIsSender(email.senderAddress, email.senderName)) {
    const cleaned = cleanMention(
      email.senderName.replace(
        /\b(recruiting|recruitment|talent|people|careers?|hiring|notifications?|jobs?|updates?|team|no[-\s]?reply)\b/gi,
        " ",
      ),
    );
    if (cleaned.length >= 2 && searchable.toLowerCase().includes(cleaned.toLowerCase())) {
      mentions.add(cleaned.slice(0, 200));
    }
  }

  // Subject and body phrasings, allowing internal periods so dotted
  // abbreviations such as "Northwind, N.A." survive intact.
  const patterns = [
    /\b(?:applying|applied)\s+to\s+([^\n!?]{2,120}?)(?=\s*[!?\n]|\s*$)/i,
    /\b(?:interest|application)\s+(?:in|with|at)\s+([^\n!?]{2,120}?)(?=\s*[!?\n]|\s*$)/i,
    /\b(?:position|role|opportunity)\s+(?:at|with)\s+([^\n!?]{2,120}?)(?=\s*[!?\n]|\s*$)/i,
    // "joining our team" names no employer, so the anchor is required.
    /\b(?:join|joining)\s+(?:the\s+team\s+at|us\s+at)\s+([^\n!?]{2,120}?)(?=\s*[!?\n]|\s*$)/i,
    /\bfrom\s+the\s+team\s+at\s+([^\n!?]{2,120}?)(?=\s*[!?\n]|\s*$)/i,
  ];
  for (const pattern of patterns) {
    const candidate = cleanMention(truncateAtSentence(pattern.exec(searchable)?.[1] ?? ""));
    // Company names carry a capital letter; a span of ordinary lowercase prose
    // such as "our team" is a failed capture, not an employer.
    if (candidate.length >= 2 && /[A-Z]/.test(candidate)) mentions.add(candidate.slice(0, 200));
  }

  return [...mentions];
}

export function buildEmailSignals(email: ParsedEmail): EmailMatchSignals {
  // The sender domain is searched as text rather than compared as a key: an
  // ATS relay says nothing about the employer, but a message from
  // "hiring.manager@northwind.example" carries the company name in the only place it
  // appears anywhere in the message.
  const linkHosts = email.links
    .map((link) => {
      try {
        return new URL(link).hostname;
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const surfaces = [
    email.subject,
    email.bodyText,
    email.senderName ?? "",
    email.senderDomain ?? "",
    linkHosts.join(" "),
  ];

  return {
    companyMentions: collectCompanyMentions(email),
    jobIdMentions: collectJobIds(`${email.subject}\n${email.bodyText}`),
    linkUrls: email.links.slice(0, 50),
    tokens: [...new Set(surfaces.flatMap(tokenize))],
  };
}
