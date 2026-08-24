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
  [/\bapplication\b|\bapplied\b/i, 20],
  [/\brecruit(?:er|ing|ment)\b|\bcandidate\b/i, 20],
];

const promotionalSubject = /\b(newsletter|job alert|jobs? for you|weekly digest|recommended jobs?|career tips)\b/i;

export function scoreEmailMetadata(metadata: Pick<ParsedEmail, "hasUnsubscribe" | "senderDomain" | "subject">) {
  let score = 0;
  if (metadata.senderDomain && knownAtsDomains.some((domain) =>
    metadata.senderDomain === domain || metadata.senderDomain?.endsWith(`.${domain}`)
  )) {
    score += 50;
  }
  for (const [pattern, points] of subjectSignals) {
    if (pattern.test(metadata.subject)) score += points;
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

export function classifyEmail(email: ParsedEmail): ClassifiedEmail {
  if (email.metadataScore < 20) {
    return {
      classification: "NOT_JOB_RELATED",
      confidence: 0.98,
      evidence: `Metadata score ${email.metadataScore} was below the processing threshold.`,
      extractedCompany: null,
      extractedJobId: null,
      extractedPosition: null,
      meetingUrl: null,
    };
  }

  const searchable = `${email.subject}\n${email.bodyText}`;
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(searchable);
      if (match) {
        return {
          classification: rule.classification,
          confidence: 0.92,
          evidence: match[0].slice(0, 240),
          extractedCompany: extractCompany(searchable, email.senderName),
          extractedJobId: jobIdPattern.exec(searchable)?.[1] ?? null,
          extractedPosition: extractPosition(searchable),
          meetingUrl: rule.classification === "INTERVIEW_REQUESTED" ? extractMeetingUrl(email.links) : null,
        };
      }
    }
  }

  return {
    classification: "UNKNOWN_EMAIL_EVENT",
    confidence: 0.4,
    evidence: `Metadata score ${email.metadataScore} indicated a possible recruiting message, but no event rule matched.`,
    extractedCompany: extractCompany(searchable, email.senderName),
    extractedJobId: jobIdPattern.exec(searchable)?.[1] ?? null,
    extractedPosition: extractPosition(searchable),
    meetingUrl: null,
  };
}
