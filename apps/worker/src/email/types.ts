export type EmailClassification =
  | "APPLICATION_CONFIRMED"
  | "ASSESSMENT_REQUESTED"
  | "INTERVIEW_REQUESTED"
  | "OFFER_RECEIVED"
  | "REJECTION_RECEIVED"
  | "UNKNOWN_EMAIL_EVENT"
  | "NOT_JOB_RELATED";

export interface ParsedEmail {
  bodyText: string;
  hasUnsubscribe: boolean;
  links: string[];
  messageId: string | null;
  metadataScore: number;
  receivedAt: string;
  senderAddress: string | null;
  senderDomain: string | null;
  senderName: string | null;
  subject: string;
  threadId: string | null;
}

export interface ClassifiedEmail {
  classification: EmailClassification;
  confidence: number;
  evidence: string;
  extractedCompany: string | null;
  extractedJobId: string | null;
  extractedPosition: string | null;
  meetingUrl: string | null;
}
