export interface MatchableApplication {
  appliedAt: string | null;
  company: string;
  createdAt: string;
  id: string;
  jobId: string | null;
  originalDomain: string | null;
  position: string;
}

export interface EmailMatchSignals {
  extractedCompany: string | null;
  extractedJobId: string | null;
  extractedPosition: string | null;
  previousThreadApplicationId: string | null;
  receivedAt: string;
  senderDomain: string | null;
}

export interface ApplicationMatchCandidate {
  applicationId: string;
  reasons: string[];
  score: number;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizeCompany(value: string) {
  return normalize(value).replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|company|co)\b/g, "").replace(/\s+/g, " ").trim();
}

function trigrams(value: string) {
  const padded = `  ${normalize(value)} `;
  const result = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) result.add(padded.slice(index, index + 3));
  return result;
}

export function titleSimilarity(left: string, right: string) {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function domainsMatch(left: string, right: string) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function rankApplicationMatches(
  signals: EmailMatchSignals,
  applications: MatchableApplication[],
): ApplicationMatchCandidate[] {
  return applications.map((application) => {
    let score = 0;
    const reasons: string[] = [];

    if (signals.extractedJobId && application.jobId && normalize(signals.extractedJobId) === normalize(application.jobId)) {
      score += 80;
      reasons.push("Exact job ID");
    }
    if (signals.previousThreadApplicationId === application.id) {
      score += 80;
      reasons.push("Previously matched email thread");
    }
    if (signals.extractedCompany) {
      if (normalizeCompany(signals.extractedCompany) === normalizeCompany(application.company)) {
        score += 25;
        reasons.push("Exact company");
      } else {
        score -= 100;
        reasons.push("Conflicting company");
      }
    }
    if (signals.extractedPosition) {
      const similarity = titleSimilarity(signals.extractedPosition, application.position);
      if (normalize(signals.extractedPosition) === normalize(application.position)) {
        score += 35;
        reasons.push("Exact position");
      } else if (similarity >= 0.35) {
        const points = Math.round(similarity * 25);
        score += points;
        reasons.push(`Similar position (${Math.round(similarity * 100)}%)`);
      }
    }
    if (signals.senderDomain && application.originalDomain && domainsMatch(signals.senderDomain, application.originalDomain)) {
      score += 20;
      reasons.push("Matching company domain");
    }

    const applicationTime = new Date(application.appliedAt ?? application.createdAt).valueOf();
    const receivedTime = new Date(signals.receivedAt).valueOf();
    const daysApart = Math.abs(receivedTime - applicationTime) / 86_400_000;
    if (Number.isFinite(daysApart) && daysApart <= 30) {
      const points = Math.max(1, Math.round(10 * (1 - daysApart / 30)));
      score += points;
      reasons.push(`Applied ${Math.round(daysApart)} days earlier`);
    }

    return { applicationId: application.id, reasons, score };
  }).sort((left, right) => right.score - left.score || left.applicationId.localeCompare(right.applicationId));
}

export function decideApplicationMatch(candidates: ApplicationMatchCandidate[]) {
  const best = candidates[0];
  const runnerUp = candidates[1];
  const hasStrongEntityPair = best?.reasons.includes("Exact company")
    && best.reasons.includes("Exact position");
  const hasClearLead = best && (!runnerUp || best.score - runnerUp.score >= 20);
  const unambiguous = best && hasClearLead && (
    best.score >= 80 || (hasStrongEntityPair && best.score >= 60)
  );
  return {
    automaticApplicationId: unambiguous ? best.applicationId : null,
    confidence: best ? Math.max(0, Math.min(1, best.score / 100)) : 0,
    reason: best
      ? `${unambiguous ? "Automatic match" : "Review required"}: ${best.reasons.join(", ") || "no strong matching signals"}.`
      : "Review required: there are no tracked applications to compare.",
    suggestedApplicationIds: candidates.filter((candidate) => candidate.score > 0).slice(0, 3).map((candidate) => candidate.applicationId),
  };
}
