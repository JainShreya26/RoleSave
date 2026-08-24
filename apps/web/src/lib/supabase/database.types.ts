export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      application_events: {
        Row: {
          application_id: string;
          confidence: number | null;
          created_at: string;
          event_time: string;
          event_type: Database["public"]["Enums"]["application_event_type"];
          evidence: string | null;
          id: string;
          new_status: Database["public"]["Enums"]["application_status"] | null;
          previous_status: Database["public"]["Enums"]["application_status"] | null;
          provider_message_id: string | null;
          source: Database["public"]["Enums"]["event_source"];
          user_id: string;
        };
        Insert: {
          application_id: string;
          confidence?: number | null;
          created_at?: string;
          event_time: string;
          event_type: Database["public"]["Enums"]["application_event_type"];
          evidence?: string | null;
          id?: string;
          new_status?: Database["public"]["Enums"]["application_status"] | null;
          previous_status?: Database["public"]["Enums"]["application_status"] | null;
          provider_message_id?: string | null;
          source: Database["public"]["Enums"]["event_source"];
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["application_events"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          applied_at: string | null;
          company: string;
          company_normalized: string;
          created_at: string;
          id: string;
          job_id: string | null;
          original_domain: string | null;
          original_url: string | null;
          position: string;
          position_normalized: string;
          source: Database["public"]["Enums"]["application_source"];
          status: Database["public"]["Enums"]["application_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          applied_at?: string | null;
          company: string;
          company_normalized?: string;
          created_at?: string;
          id?: string;
          job_id?: string | null;
          original_domain?: string | null;
          original_url?: string | null;
          position: string;
          position_normalized?: string;
          source: Database["public"]["Enums"]["application_source"];
          status: Database["public"]["Enums"]["application_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["applications"]["Insert"]>;
        Relationships: [];
      };
      capture_jobs: {
        Row: {
          application_id: string;
          attempt_count: number;
          available_at: string | null;
          completed_at: string | null;
          created_at: string;
          document_id: string;
          id: string;
          idempotency_key: string;
          last_error: string | null;
          status: Database["public"]["Enums"]["capture_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          application_id: string;
          attempt_count?: number;
          available_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          document_id: string;
          id?: string;
          idempotency_key: string;
          last_error?: string | null;
          status?: Database["public"]["Enums"]["capture_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["capture_jobs"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "capture_jobs_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capture_jobs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          application_id: string;
          capture_status: Database["public"]["Enums"]["capture_status"];
          captured_at: string | null;
          checksum_sha256: string | null;
          created_at: string;
          document_type: string;
          file_size_bytes: number | null;
          id: string;
          mime_type: string;
          original_url: string | null;
          storage_path: string;
          temporary_storage_path: string | null;
          user_id: string;
        };
        Insert: {
          application_id: string;
          capture_status: Database["public"]["Enums"]["capture_status"];
          captured_at?: string | null;
          checksum_sha256?: string | null;
          created_at?: string;
          document_type?: string;
          file_size_bytes?: number | null;
          id?: string;
          mime_type?: string;
          original_url?: string | null;
          storage_path: string;
          temporary_storage_path?: string | null;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "documents_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      email_accounts: {
        Row: {
          created_at: string;
          email_address: string;
          id: string;
          provider: Database["public"]["Enums"]["email_provider"];
          provider_account_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email_address: string;
          id?: string;
          provider: Database["public"]["Enums"]["email_provider"];
          provider_account_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["email_accounts"]["Insert"]>;
        Relationships: [];
      };
      email_events: {
        Row: {
          application_id: string | null;
          classification: string;
          classification_confidence: number;
          created_at: string;
          email_account_id: string;
          email_job_id: string;
          evidence: string;
          extracted_company: string | null;
          extracted_job_id: string | null;
          extracted_position: string | null;
          id: string;
          meeting_url: string | null;
          match_confidence: number | null;
          message_id: string | null;
          metadata_score: number;
          provider_message_id: string;
          received_at: string;
          review_status: string;
          sender: string | null;
          sender_domain: string | null;
          sender_name: string | null;
          subject: string;
          thread_id: string | null;
          user_id: string;
        };
        Insert: {
          application_id?: string | null;
          classification: string;
          classification_confidence: number;
          created_at?: string;
          email_account_id: string;
          email_job_id: string;
          evidence: string;
          extracted_company?: string | null;
          extracted_job_id?: string | null;
          extracted_position?: string | null;
          id?: string;
          meeting_url?: string | null;
          match_confidence?: number | null;
          message_id?: string | null;
          metadata_score: number;
          provider_message_id: string;
          received_at: string;
          review_status?: string;
          sender?: string | null;
          sender_domain?: string | null;
          sender_name?: string | null;
          subject: string;
          thread_id?: string | null;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["email_events"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "email_events_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_events_email_account_id_fkey";
            columns: ["email_account_id"];
            isOneToOne: false;
            referencedRelation: "email_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_events_email_job_id_fkey";
            columns: ["email_job_id"];
            isOneToOne: true;
            referencedRelation: "inbound_email_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      inbound_email_jobs: {
        Row: {
          attempt_count: number;
          available_at: string | null;
          completed_at: string | null;
          created_at: string;
          email_account_id: string;
          file_size_bytes: number | null;
          id: string;
          last_error: string | null;
          provider_message_id: string;
          status: Database["public"]["Enums"]["email_job_status"];
          storage_path: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempt_count?: number;
          available_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          email_account_id: string;
          file_size_bytes?: number | null;
          id?: string;
          last_error?: string | null;
          provider_message_id: string;
          status?: Database["public"]["Enums"]["email_job_status"];
          storage_path: string;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["inbound_email_jobs"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "inbound_email_jobs_email_account_id_fkey";
            columns: ["email_account_id"];
            isOneToOne: false;
            referencedRelation: "email_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      review_tasks: {
        Row: {
          created_at: string;
          email_event_id: string;
          id: string;
          reason: string;
          resolved_at: string | null;
          status: string;
          suggested_application_ids: string[];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email_event_id: string;
          id?: string;
          reason: string;
          resolved_at?: string | null;
          status?: string;
          suggested_application_ids?: string[];
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["review_tasks"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "review_tasks_email_event_id_fkey";
            columns: ["email_event_id"];
            isOneToOne: true;
            referencedRelation: "email_events";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_capture_job: {
        Args: Record<PropertyKey, never>;
        Returns: {
          application_id: string;
          captured_at: string;
          company: string;
          document_id: string;
          job_id: string;
          original_url: string;
          output_storage_path: string;
          job_position: string;
          temporary_storage_path: string;
          user_id: string;
        }[];
      };
      complete_capture_job: {
        Args: { p_checksum_sha256: string; p_file_size_bytes: number; p_job_id: string };
        Returns: boolean;
      };
      claim_inbound_email_job: {
        Args: Record<PropertyKey, never>;
        Returns: {
          email_account_id: string;
          job_id: string;
          provider_message_id: string;
          storage_path: string;
          user_id: string;
        }[];
      };
      apply_automatic_email_match: {
        Args: { p_application_id: string; p_email_event_id: string; p_match_confidence: number };
        Returns: boolean;
      };
      complete_inbound_email_job: {
        Args: {
          p_classification: string;
          p_classification_confidence: number;
          p_evidence: string;
          p_extracted_job_id: string | null;
          p_job_id: string;
          p_meeting_url: string | null;
          p_message_id: string | null;
          p_metadata_score: number;
          p_received_at: string;
          p_sender: string | null;
          p_sender_domain: string | null;
          p_sender_name: string | null;
          p_subject: string;
          p_thread_id: string | null;
        };
        Returns: boolean;
      };
      create_capture_session: {
        Args: {
          p_captured_at: string;
          p_company: string;
          p_idempotency_key: string;
          p_original_url: string;
          p_position: string;
        };
        Returns: {
          application_id: string;
          capture_status: Database["public"]["Enums"]["capture_status"];
          document_id: string;
          job_id: string;
          output_storage_path: string;
          temporary_storage_path: string;
        }[];
      };
      fail_capture_job: {
        Args: { p_error: string; p_job_id: string };
        Returns: boolean;
      };
      fail_capture_upload: {
        Args: { p_error: string; p_job_id: string };
        Returns: boolean;
      };
      finalize_capture_upload: {
        Args: { p_job_id: string };
        Returns: boolean;
      };
      fail_inbound_email_upload: {
        Args: { p_error: string; p_job_id: string };
        Returns: boolean;
      };
      fail_inbound_email_job: {
        Args: { p_error: string; p_job_id: string };
        Returns: boolean;
      };
      finalize_inbound_email_upload: {
        Args: { p_file_size_bytes: number; p_job_id: string };
        Returns: boolean;
      };
      mark_application_applied: {
        Args: { p_application_id: string };
        Returns: boolean;
      };
      issue_forwarding_address: {
        Args: { p_domain: string };
        Returns: {
          created_at: string;
          email_address: string;
          id: string;
          provider: Database["public"]["Enums"]["email_provider"];
        }[];
      };
      prepare_inbound_email_job: {
        Args: { p_forwarding_token: string; p_provider_message_id: string };
        Returns: {
          already_queued: boolean;
          job_id: string;
          storage_path: string;
        }[];
      };
      dismiss_email_review_task: {
        Args: { p_review_task_id: string };
        Returns: boolean;
      };
      resolve_email_review_task: {
        Args: { p_application_id: string; p_review_task_id: string };
        Returns: boolean;
      };
      set_email_review_suggestions: {
        Args: {
          p_email_event_id: string;
          p_match_confidence: number;
          p_reason: string;
          p_suggested_application_ids: string[];
        };
        Returns: boolean;
      };
      retry_capture_upload: {
        Args: { p_job_id: string };
        Returns: boolean;
      };
      retry_failed_capture: {
        Args: { p_document_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      application_event_type:
        | "JD_SAVED"
        | "MARKED_AS_APPLIED"
        | "APPLICATION_CONFIRMED"
        | "ASSESSMENT_REQUESTED"
        | "INTERVIEW_REQUESTED"
        | "INTERVIEW_SCHEDULED"
        | "INTERVIEW_RESCHEDULED"
        | "OFFER_RECEIVED"
        | "REJECTION_RECEIVED"
        | "APPLICATION_WITHDRAWN"
        | "GENERAL_UPDATE"
        | "MANUAL_CORRECTION"
        | "UNKNOWN_EMAIL_EVENT";
      application_source: "EXTENSION" | "EMAIL" | "MANUAL";
      application_status:
        | "SAVED"
        | "APPLIED"
        | "ASSESSMENT"
        | "INTERVIEW"
        | "OFFER"
        | "REJECTED"
        | "WITHDRAWN"
        | "NEEDS_REVIEW";
      capture_status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
      email_job_status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
      email_provider: "FORWARDING" | "GMAIL" | "OUTLOOK";
      event_source: "EXTENSION" | "EMAIL" | "MANUAL" | "SYSTEM";
    };
    CompositeTypes: Record<string, never>;
  };
}

export type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
export type ApplicationEventRow = Database["public"]["Tables"]["application_events"]["Row"];
export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
