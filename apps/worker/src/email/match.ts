import { isDistinctiveToken } from "./signals";

/**
 * One row from `match_email_candidates`: the evidence for a single tracked
 * application, with no verdict attached.
 */
export interface EmailMatchCandidate {
  applicationId: string;
  company: string;
  companyConflict: boolean;
  companyExact: boolean;
  companySimilarity: number;
  daysApart: number;
  matchedJobId: boolean;
  matchedTenant: boolean;
  matchedThread: boolean;
  matchedTokens: string[];
  position: string;
}

export type MatchTier = "IDENTITY" | "ENTITY" | "REVIEW";

export interface EmailMatchDecision {
  automaticApplicationId: string | null;
  confidence: number;
  reason: string;
  suggestedApplicationIds: string[];
  tier: MatchTier;
}

// A confirmation can arrive minutes after applying and a rejection months
// later, but nothing credible arrives before the application existed by more
// than a clock skew, or a year after it.
const plausibleWindowDays = 400;

// Trigram similarity high enough to treat two spellings as the same employer
// without an exact fold, e.g. "Acme Health" against "Acme Health Systems".
const strongSimilarity = 0.6;

function distinctCompanies(candidates: EmailMatchCandidate[]) {
  return new Set(candidates.map((candidate) => candidate.company.toLowerCase().trim())).size;
}

function evidenceStrength(candidate: EmailMatchCandidate) {
  if (candidate.matchedThread) return 100;
  if (candidate.matchedJobId) return 95;
  if (candidate.matchedTenant) return 85;
  if (candidate.companyExact) return 70;
  if (candidate.companySimilarity >= strongSimilarity) return 55;
  const distinctive = candidate.matchedTokens.filter(isDistinctiveToken).length;
  if (distinctive > 0) return 40 + Math.min(10, distinctive * 5);
  if (candidate.matchedTokens.length > 0) return 25;
  return 10;
}

function describe(candidate: EmailMatchCandidate) {
  const reasons: string[] = [];
  if (candidate.matchedThread) reasons.push("same email thread");
  if (candidate.matchedJobId) reasons.push("exact job ID");
  if (candidate.matchedTenant) reasons.push("same ATS employer");
  if (candidate.companyExact) reasons.push("exact company");
  else if (candidate.companySimilarity >= strongSimilarity) {
    reasons.push(`similar company (${Math.round(candidate.companySimilarity * 100)}%)`);
  }
  if (!candidate.companyExact && candidate.matchedTokens.length > 0) {
    reasons.push(`mentions ${candidate.matchedTokens.slice(0, 3).join(", ")}`);
  }
  if (candidate.companyConflict) reasons.push("names a different company");
  return reasons;
}

function rank(candidates: EmailMatchCandidate[]) {
  return [...candidates].sort((left, right) => {
    const byEvidence = evidenceStrength(right) - evidenceStrength(left);
    if (byEvidence !== 0) return byEvidence;
    // Recency only ever breaks a tie; it must never create one, which is what
    // an additive proximity bonus used to do for every recent application.
    const byRecency = left.daysApart - right.daysApart;
    if (Math.abs(byRecency) > 0.5) return byRecency;
    return left.applicationId.localeCompare(right.applicationId);
  });
}

/**
 * Whether a job-ID match is backed by something that also ties this message to
 * this employer.
 *
 * Requisition numbers are only unique within an employer -- "REQ-48391" is a
 * format two companies will both use -- so a bare ID quoted in prose is not by
 * itself proof of identity. A link that carries the ATS tenant, an agreeing
 * company name, or a distinctive company token all supply the missing scope.
 *
 * This deliberately still matches a message that calls the employer by a
 * different name than the saved application, as long as some token agrees:
 * that is the parent-company case, where "Harbor Group" corroborates a role saved
 * as "Harbor Insurance Company".
 */
function jobIdIsCorroborated(candidate: EmailMatchCandidate) {
  return candidate.matchedTenant
    || candidate.companyExact
    || candidate.companySimilarity >= strongSimilarity
    || candidate.matchedTokens.some(isDistinctiveToken);
}

/**
 * Whether any candidate carries evidence strong enough to say this message
 * genuinely concerns a tracked application. Used to rescue mail the metadata
 * pre-filter would otherwise discard, so it is deliberately stricter than
 * mere retrieval: sharing one generic word is not evidence.
 */
export function hasTrackedApplicationEvidence(candidates: EmailMatchCandidate[]) {
  return candidates.some((candidate) => (
    candidate.matchedThread
    || candidate.matchedJobId
    || candidate.matchedTenant
    || candidate.companyExact
    || candidate.companySimilarity >= strongSimilarity
    || candidate.matchedTokens.some(isDistinctiveToken)
  ));
}

function decision(
  candidate: EmailMatchCandidate | null,
  tier: MatchTier,
  confidence: number,
  summary: string,
  ranked: EmailMatchCandidate[],
): EmailMatchDecision {
  return {
    automaticApplicationId: candidate?.applicationId ?? null,
    confidence,
    reason: summary,
    suggestedApplicationIds: ranked.slice(0, 3).map((entry) => entry.applicationId),
    tier,
  };
}

/**
 * Decides what to do with the candidates a message retrieved.
 *
 * The tiers are asked in order and the first that answers wins, so an exact
 * identifier never has to out-score weaker evidence. In particular a message
 * quoting a requisition ID while naming a parent company is matched on the
 * identifier: the differing name is recorded, not held against it.
 */
export function decideEmailMatch(candidates: EmailMatchCandidate[]): EmailMatchDecision {
  if (candidates.length === 0) {
    return decision(null, "REVIEW", 0, "No tracked application matches this message.", []);
  }

  // Ranking spans every candidate. An age filter must never remove one before
  // the identity tiers run: an exact identifier stays conclusive at any age,
  // and filtering first let a recent weak token match win over an older exact
  // job ID and attach to the wrong application.
  const ranked = rank(candidates);

  // Tier 1 — identity. An exact identifier is conclusive when it points at
  // one application, whatever the prose around it says.
  const strongIdentity = ranked.filter((candidate) => (
    candidate.matchedThread || (candidate.matchedJobId && jobIdIsCorroborated(candidate))
  ));
  if (strongIdentity.length === 1) {
    const [best] = strongIdentity;
    return decision(best, "IDENTITY", 0.98, `Matched on ${describe(best).join(", ")}.`, ranked);
  }
  if (strongIdentity.length === 0) {
    const tenantMatches = ranked.filter((candidate) => candidate.matchedTenant);
    if (tenantMatches.length === 1) {
      const [best] = tenantMatches;
      return decision(best, "IDENTITY", 0.9, `Matched on ${describe(best).join(", ")}.`, ranked);
    }
  }

  // Tier 2 onwards reasons from the company name, where age genuinely is
  // evidence: the same employer writing three years after you applied is not
  // the same conversation.
  const plausible = ranked.filter((candidate) => candidate.daysApart <= plausibleWindowDays);

  // Tier 2 — entity. Contradiction excludes a candidate here, where the only
  // evidence is the name itself.
  const consistent = plausible.filter((candidate) => !candidate.companyConflict);
  const entityMatches = consistent.filter((candidate) => (
    candidate.companyExact
    || candidate.companySimilarity >= strongSimilarity
    || candidate.matchedTokens.some(isDistinctiveToken)
  ));

  if (entityMatches.length > 0 && distinctCompanies(entityMatches) === 1) {
    const [best] = entityMatches;
    // One employer, but several open roles with it: the company cannot say
    // which, so this needs a person unless something else separated them.
    if (entityMatches.length === 1) {
      const confidence = best.companyExact ? 0.85 : 0.7;
      return decision(best, "ENTITY", confidence, `Matched on ${describe(best).join(", ")}.`, ranked);
    }
    return decision(
      null,
      "REVIEW",
      0.5,
      `${entityMatches.length} tracked roles at ${best.company} match this message.`,
      entityMatches,
    );
  }

  const [best] = ranked;
  const summary = describe(best);
  return decision(
    null,
    "REVIEW",
    Math.min(0.45, evidenceStrength(best) / 100),
    summary.length > 0
      ? `Review required: ${summary.join(", ")}.`
      : "Review required: no distinguishing evidence in this message.",
    ranked,
  );
}
