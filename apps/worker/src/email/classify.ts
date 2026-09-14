import type { ClassifiedEmail, EmailClassification, ParsedEmail } from "./types";

const knownAtsDomains = [
  "ashbyhq.com",
  "codesignal.com",
  "greenhouse.io",
  "hackerrank.com",
  "icims.com",
  "jobvite.com",
  "lever.co",
  "myworkday.com",
  "smartrecruiters.com",
  "taleo.net",
];

const subjectSignals: Array<[RegExp, number]> = [
  [/\binterview\b/i, 30],
  [/\bassessment\b|\bcoding challenge\b|\bonline test\b/i, 30],
  [/\boffer\b/i, 30],
  [/\bapplication\b|\bappl(?:y|ied|ies|ying)\b/i, 20],
  [/\brecruit(?:er|ing|ment)\b|\bcandidate\b/i, 20],
];

const promotionalSubject = /\b(newsletter|job alert|jobs? for you|weekly digest|recommended jobs?|career tips)\b/i;

export function scoreEmailMetadata(metadata: Pick<ParsedEmail, "hasUnsubscribe" | "senderAddress" | "senderDomain" | "subject">) {
  let score = 0;
  if (metadata.senderDomain && knownAtsDomains.some((domain) =>
    metadata.senderDomain === domain || metadata.senderDomain?.endsWith(`.${domain}`)
  )) {
    score += 50;
  }
  for (const [pattern, points] of subjectSignals) {
    if (pattern.test(metadata.subject)) score += points;
  }
  const senderLocalPart = metadata.senderAddress?.split("@")[0] ?? "";
  if (/\b(?:career|hiring|jobs?|recruit(?:er|ing|ment)?|talent)\b/i.test(senderLocalPart.replace(/[^a-z]+/gi, " "))) {
    score += 15;
  }
  if (promotionalSubject.test(metadata.subject)) score -= 50;
  if (metadata.hasUnsubscribe) score -= 30;
  return score;
}

const rules: Array<{
  classification: Exclude<EmailClassification, "UNKNOWN_EMAIL_EVENT" | "NOT_JOB_RELATED">;
  patterns: RegExp[];
}> = [
  {
    classification: "OFFER_RECEIVED",
    patterns: [
      /\bwe (?:are|'re) pleased to offer\b/i,
      /\boffer of employment\b/i,
      /\byour offer letter\b/i,
      /\bcompensation package\b/i,
    ],
  },
  {
    classification: "REJECTION_RECEIVED",
    patterns: [
      /\bwe (?:will not|won't) be moving forward\b/i,
      /\bdecided to (?:move forward with|pursue) other candidates\b/i,
      /\byou were not selected\b/i,
      /\bposition has been filled\b/i,
      /\bunable to offer you (?:the|this) position\b/i,
    ],
  },
  {
    classification: "INTERVIEW_REQUESTED",
    patterns: [
      /\bwe would like to interview you\b/i,
      /\bschedule (?:an|your) interview\b/i,
      /\bselect your availability\b/i,
      /\bphone screen\b/i,
      /\bvideo interview\b/i,
      /\bon-?site interview\b/i,
      /\bmeet with (?:the|our) hiring manager\b/i,
      /\bnext round\b/i,
    ],
  },
  {
    classification: "ASSESSMENT_REQUESTED",
    patterns: [
      /\bcomplete (?:the|this|your|an) assessment\b/i,
      /\bcoding challenge\b/i,
      /\btechnical assessment\b/i,
      /\bonline test\b/i,
      /\btake-home assignment\b/i,
      /\bhackerrank\b/i,
      /\bcodesignal\b/i,
    ],
  },
  {
    classification: "APPLICATION_CONFIRMED",
    patterns: [
      /\bthank you for applying\b/i,
      /\bwe (?:have )?received your application\b/i,
      /\byour application has been submitted\b/i,
      /\bwe appreciate your interest\b/i,
    ],
  },
];

const jobIdPattern = /\b(?:job|requisition|req)(?:uisition)?(?:\s+(?:id|number|no\.?))?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{2,})\b/i;
const meetingHosts = new Set(["calendly.com", "meet.google.com", "teams.microsoft.com", "zoom.us"]);

function extractSenderCompany(senderName: string | null) {
  if (!senderName) return null;
  const company = senderName
    .replace(/\b(recruiting|recruitment|talent|people|careers?|hiring|notifications?|jobs?|updates?|team)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-–—|,:]+$/, "")
    .trim();
  return company.length >= 2 ? company.slice(0, 200) : null;
}

function cleanEntity(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/[-–—|,:]+$/, "").trim();
}

function extractCompany(value: string, senderName: string | null) {
  const bodyPatterns = [
    /\b(?:applying|applied)\s+to\s+([^\n.!?]{2,200})/i,
    /\b(?:interest|application)\s+(?:in|with)\s+([^\n.!?]{2,200})/i,
    /\b(?:position|role)\s+(?:at|with)\s+([^\n.!?]{2,200})/i,
    /\b(?:join|joining)\s+(?:the team at\s+)?([^\n.!?]{2,200})/i,
  ];
  for (const pattern of bodyPatterns) {
    const candidate = cleanEntity(pattern.exec(value)?.[1] ?? "");
    if (candidate.length >= 2) return candidate.slice(0, 200);
  }
  return extractSenderCompany(senderName);
}

function extractPosition(value: string) {
  const patterns = [
    /\binterview you for (?:the )?([\s\S]{2,100}?)\s+position(?:\s+(?:at|with)\b|[.!?\n])/i,
    /\bapplication (?:for|to) (?:the )?([^\n,.!?]{2,100}?)(?=\s+(?:position|role)\b|,|[.!?\n])/i,
    /\bapplication (?:for|to) (?:the )?([^\n.!?]{2,100}?)(?: position| role)?[.!?\n]/i,
    /\boffer you (?:the )?([^\n.!?]{2,100}?) position\b/i,
    /\bthe ([^\n.!?]{2,100}?) position\b/i,
    /\binterview availability for ([^\n.!?]{2,100})/i,
  ];
  for (const pattern of patterns) {
    const candidate = cleanEntity(pattern.exec(value)?.[1] ?? "");
    if (candidate && !/^(your|the) application$/i.test(candidate)) return candidate;
  }
  return null;
}

function extractMeetingUrl(links: string[]) {
  return links.find((link) => {
    try {
      const host = new URL(link).hostname.toLowerCase();
      return [...meetingHosts].some((knownHost) => host === knownHost || host.endsWith(`.${knownHost}`));
    } catch {
      return false;
    }
  }) ?? null;
}

/**
 * Whether this is bulk mail rather than a message about one application.
 *
 * Phrase rules run before any metadata check, so a job-alert digest saying
 * "next round" or "phone screen" in marketing copy used to classify as an
 * interview request at full confidence and drive an automatic status change,
 * even at a metadata score of -80. Real ATS mail that carries an unsubscribe
 * header still scores well on its sending domain and subject, so requiring a
 * negative score alongside it keeps genuine notifications out of this.
 */
function isBulkMail(email: ParsedEmail) {
  return promotionalSubject.test(email.subject)
    || (email.hasUnsubscribe && email.metadataScore < 0);
}

export function classifyEmail(email: ParsedEmail): ClassifiedEmail {
  const searchable = `${email.subject}\n${email.bodyText}`;
  // Mail is hard-wrapped around 72 characters, so a phrase like "decided to
  // move forward with other candidates" is routinely split across a line
  // break and never matches a rule written as one line. Classification runs
  // against a flattened copy; entity extraction keeps the original, where
  // newlines still bound a captured span.
  const flattened = searchable.replace(/\s+/g, " ");
  const bulk = isBulkMail(email);
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(flattened);
      if (match) {
        // A recruiting phrase inside bulk mail is copy, not an event. Recording
        // it as one would attach the message to an application and move that
        // application's status. The message stays recoverable from review.
        if (bulk) {
          return {
            classification: "NOT_JOB_RELATED",
            confidence: 0.8,
            evidence: `Bulk mail matched "${match[0].slice(0, 120)}" but scored ${email.metadataScore} on sender and subject.`,
            extractedCompany: extractCompany(searchable, email.senderName),
            extractedJobId: jobIdPattern.exec(flattened)?.[1] ?? null,
            extractedPosition: extractPosition(searchable),
            meetingUrl: null,
          };
        }
        return {
          classification: rule.classification,
          confidence: 0.92,
          evidence: match[0].slice(0, 240),
          extractedCompany: extractCompany(searchable, email.senderName),
          extractedJobId: jobIdPattern.exec(flattened)?.[1] ?? null,
          extractedPosition: extractPosition(searchable),
          meetingUrl: rule.classification === "INTERVIEW_REQUESTED" ? extractMeetingUrl(email.links) : null,
        };
      }
    }
  }

  if (email.metadataScore < 20) {
    return {
      classification: "NOT_JOB_RELATED",
      confidence: 0.85,
      evidence: `No recruiting event was detected; metadata score was ${email.metadataScore}.`,
      extractedCompany: extractCompany(searchable, email.senderName),
      extractedJobId: jobIdPattern.exec(flattened)?.[1] ?? null,
      extractedPosition: extractPosition(searchable),
      meetingUrl: null,
    };
  }

  return {
    classification: "UNKNOWN_EMAIL_EVENT",
    confidence: 0.4,
    evidence: `Metadata score ${email.metadataScore} indicated a possible recruiting message, but no event rule matched.`,
    extractedCompany: extractCompany(searchable, email.senderName),
    extractedJobId: jobIdPattern.exec(flattened)?.[1] ?? null,
    extractedPosition: extractPosition(searchable),
    meetingUrl: null,
  };
}
