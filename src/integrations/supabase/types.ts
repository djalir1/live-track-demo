export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      device_status: {
        Row: {
          accuracy: number | null;
          battery_level: number | null;
          heading: number | null;
          is_tracking: boolean;
          last_seen: string;
          latitude: number | null;
          longitude: number | null;
          speed_kmh: number | null;
          status: Database["public"]["Enums"]["tracking_status"];
          total_distance_m: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          accuracy?: number | null;
          battery_level?: number | null;
          heading?: number | null;
          is_tracking?: boolean;
          last_seen?: string;
          latitude?: number | null;
          longitude?: number | null;
          speed_kmh?: number | null;
          status?: Database["public"]["Enums"]["tracking_status"];
          total_distance_m?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          accuracy?: number | null;
          battery_level?: number | null;
          heading?: number | null;
          is_tracking?: boolean;
          last_seen?: string;
          latitude?: number | null;
          longitude?: number | null;
          speed_kmh?: number | null;
          status?: Database["public"]["Enums"]["tracking_status"];
          total_distance_m?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      location_history: {
        Row: {
          battery_level: number | null;
          id: number;
          latitude: number;
          longitude: number;
          recorded_at: string;
          speed_kmh: number | null;
          user_id: string;
        };
        Insert: {
          battery_level?: number | null;
          id?: number;
          latitude: number;
          longitude: number;
          recorded_at?: string;
          speed_kmh?: number | null;
          user_id: string;
        };
        Update: {
          battery_level?: number | null;
          id?: number;
          latitude?: number;
          longitude?: number;
          recorded_at?: string;
          speed_kmh?: number | null;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          phone: string | null;
          updated_at: string;
          vehicle_name: string | null;
          vehicle_type: Database["public"]["Enums"]["vehicle_type"];
          vehicle_color: string | null;
          plate_number: string | null;
          seats: number | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string;
          id: string;
          phone?: string | null;
          updated_at?: string;
          vehicle_name?: string | null;
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"];
          vehicle_color?: string | null;
          plate_number?: string | null;
          seats?: number | null;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          phone?: string | null;
          updated_at?: string;
          vehicle_name?: string | null;
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"];
          vehicle_color?: string | null;
          plate_number?: string | null;
          seats?: number | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "user";
      tracking_status: "moving" | "stopped" | "idle" | "offline";
      vehicle_type:
        "car" | "suv" | "van" | "truck" | "pickup" | "bus" | "motorcycle" | "bicycle" | "other";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      tracking_status: ["moving", "stopped", "idle", "offline"],
      vehicle_type: [
        "car",
        "suv",
        "van",
        "truck",
        "pickup",
        "bus",
        "motorcycle",
        "bicycle",
        "other",
      ],
    },
  },
} as const;
