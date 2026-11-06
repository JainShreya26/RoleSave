export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      application_attachments: {
        Row: {
          id: string;
          application_id: string;
          user_id: string;
          file_name: string;
          mime_type: string;
          file_size_bytes: number;
          storage_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          user_id: string;
          file_name: string;
          mime_type: string;
          file_size_bytes: number;
          storage_path: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["application_attachments"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "application_attachments_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      application_actions: {
        Row: {
          application_id: string;
          completed_at: string | null;
          created_at: string;
          due_at: string;
          id: string;
          remind_at: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          application_id: string;
          completed_at?: string | null;
          created_at?: string;
          due_at: string;
          id?: string;
          remind_at?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["application_actions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "application_actions_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
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
          ats_job_id: string | null;
          ats_provider: string | null;
          ats_tenant: string | null;
          company: string;
          company_normalized: string;
          company_tokens: string[];
          created_at: string;
          id: string;
          identity_key: string | null;
          job_id: string | null;
          original_domain: string | null;
          original_url: string | null;
          position: string;
          position_normalized: string;
          source: Database["public"]["Enums"]["application_source"];
          status: Database["public"]["Enums"]["application_status"];
          triage_decision: "PURSUE" | "MAYBE" | "PASS" | null;
          triage_reason: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          applied_at?: string | null;
          ats_job_id?: string | null;
          ats_provider?: string | null;
          ats_tenant?: string | null;
          company: string;
          company_normalized?: string;
          company_tokens?: string[];
          created_at?: string;
          id?: string;
          identity_key?: string | null;
          job_id?: string | null;
          original_domain?: string | null;
          original_url?: string | null;
          position: string;
          position_normalized?: string;
          source: Database["public"]["Enums"]["application_source"];
          status: Database["public"]["Enums"]["application_status"];
          triage_decision?: "PURSUE" | "MAYBE" | "PASS" | null;
          triage_reason?: string | null;
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
          failed_at: string | null;
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
          failed_at?: string | null;
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
      create_capture_session: {
        Args: {
          p_captured_at: string;
          p_company: string;
          p_idempotency_key: string;
          p_job_id?: string | null;
          p_original_url: string;
          p_position: string;
        };
        Returns: {
          application_company: string;
          application_id: string;
          application_position: string;
          application_reused: boolean;
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
      find_existing_application: {
        Args: {
          p_company: string;
          p_job_id?: string | null;
          p_original_url: string | null;
        };
        Returns: string | null;
      };
      mark_application_applied: {
        Args: { p_application_id: string };
        Returns: boolean;
      };
      merge_duplicate_applications: {
        Args: {
          p_keep_application_id: string;
          p_merge_application_id: string;
        };
        Returns: string;
      };
      retry_capture_upload: {
        Args: { p_job_id: string };
        Returns: boolean;
      };
      retry_failed_capture: {
        Args: { p_document_id: string };
        Returns: boolean;
      };
      purge_expired_operational_data: {
        Args: { p_failed_metadata_retention_days?: number };
        Returns: { capture_jobs_deleted: number }[];
      };
    };
    Enums: {
      application_event_type:
        | "JD_SAVED"
        | "MARKED_AS_APPLIED"
        | "APPLICATION_WITHDRAWN"
        | "GENERAL_UPDATE"
        | "MANUAL_CORRECTION";
      application_source: "EXTENSION" | "MANUAL";
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
      event_source: "EXTENSION" | "MANUAL" | "SYSTEM";
    };
    CompositeTypes: Record<string, never>;
  };
}

export type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
export type ApplicationEventRow = Database["public"]["Tables"]["application_events"]["Row"];
export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
