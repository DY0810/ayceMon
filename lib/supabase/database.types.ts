export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      restaurants: {
        Row: {
          created_at: string
          formatted_address: string
          google_place_id: string
          id: string
          lat: number
          lng: number
          name: string
        }
        Insert: {
          created_at?: string
          formatted_address: string
          google_place_id: string
          id?: string
          lat: number
          lng: number
          name: string
        }
        Update: {
          created_at?: string
          formatted_address?: string
          google_place_id?: string
          id?: string
          lat?: number
          lng?: number
          name?: string
        }
        Relationships: []
      }
      session_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          session_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          session_id: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          session_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_invites_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "shared_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_records: {
        Row: {
          appetite_budget: number
          appetite_budget_grams: number | null
          buffet_price: number
          client_session_id: string
          contributors: Json
          created_at: string
          eaten: Json
          finished_at: string
          id: string
          library: Json
          margin: number
          restaurant_id: string | null
          restaurant_name: string | null
          started_at: string
          total_eaten_value: number
          user_id: string
          won: boolean
        }
        Insert: {
          appetite_budget: number
          appetite_budget_grams?: number | null
          buffet_price: number
          client_session_id: string
          contributors?: Json
          created_at?: string
          eaten: Json
          finished_at: string
          id?: string
          library: Json
          margin: number
          restaurant_id?: string | null
          restaurant_name?: string | null
          started_at: string
          total_eaten_value: number
          user_id: string
          won: boolean
        }
        Update: {
          appetite_budget?: number
          appetite_budget_grams?: number | null
          buffet_price?: number
          client_session_id?: string
          contributors?: Json
          created_at?: string
          eaten?: Json
          finished_at?: string
          id?: string
          library?: Json
          margin?: number
          restaurant_id?: string | null
          restaurant_name?: string | null
          started_at?: string
          total_eaten_value?: number
          user_id?: string
          won?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "session_records_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_session_collaborators: {
        Row: {
          joined_at: string
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          role?: string
          session_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_session_collaborators_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "shared_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_session_entries: {
        Row: {
          grams: number | null
          id: string
          item_id: string
          logged_at: string
          session_id: string
          units: number
          user_id: string
        }
        Insert: {
          grams?: number | null
          id?: string
          item_id: string
          logged_at?: string
          session_id: string
          units: number
          user_id: string
        }
        Update: {
          grams?: number | null
          id?: string
          item_id?: string
          logged_at?: string
          session_id?: string
          units?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_session_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "shared_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_session_entries_session_id_item_id_fkey"
            columns: ["session_id", "item_id"]
            isOneToOne: false
            referencedRelation: "shared_session_items"
            referencedColumns: ["session_id", "id"]
          },
          {
            foreignKeyName: "shared_session_entries_session_id_user_id_fkey"
            columns: ["session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "shared_session_collaborators"
            referencedColumns: ["session_id", "user_id"]
          },
        ]
      }
      shared_session_items: {
        Row: {
          ala_carte_value: number
          category: string | null
          created_at: string
          fill_factor: number
          grams_per_unit: number | null
          id: string
          name: string
          session_id: string
          source_kind: string | null
          source_ref: string | null
        }
        Insert: {
          ala_carte_value: number
          category?: string | null
          created_at?: string
          fill_factor: number
          grams_per_unit?: number | null
          id: string
          name: string
          session_id: string
          source_kind?: string | null
          source_ref?: string | null
        }
        Update: {
          ala_carte_value?: number
          category?: string | null
          created_at?: string
          fill_factor?: number
          grams_per_unit?: number | null
          id?: string
          name?: string
          session_id?: string
          source_kind?: string | null
          source_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "shared_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_sessions: {
        Row: {
          appetite_budget: number | null
          appetite_budget_grams: number | null
          buffet_price: number
          city_tier: string | null
          created_at: string
          finished_at: string | null
          id: string
          owner_user_id: string
          resolved_place: Json | null
          restaurant_id: string | null
          restaurant_name: string | null
          started_at: string
        }
        Insert: {
          appetite_budget?: number | null
          appetite_budget_grams?: number | null
          buffet_price: number
          city_tier?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          owner_user_id: string
          resolved_place?: Json | null
          restaurant_id?: string | null
          restaurant_name?: string | null
          started_at: string
        }
        Update: {
          appetite_budget?: number | null
          appetite_budget_grams?: number | null
          buffet_price?: number
          city_tier?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          owner_user_id?: string
          resolved_place?: Json | null
          restaurant_id?: string | null
          restaurant_name?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      restaurant_stats: {
        Row: {
          last_visited_at: string | null
          losses: number | null
          restaurant_id: string | null
          restaurant_name: string | null
          sessions: number | null
          total_margin: number | null
          user_id: string | null
          wins: number | null
        }
        Relationships: [
          {
            foreignKeyName: "session_records_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_stats: {
        Row: {
          best_margin: number | null
          total_losses: number | null
          total_margin: number | null
          total_sessions: number | null
          total_wins: number | null
          user_id: string | null
          worst_margin: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_shared_session_collaborator_names: {
        Args: { p_session_id: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      is_shared_session_collaborator: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: boolean
      }
      is_shared_session_owner: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: boolean
      }
      redeem_session_invite: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

