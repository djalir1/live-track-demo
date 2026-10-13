import type { Database } from "@/integrations/supabase/types";

export type TrackingStatus = Database["public"]["Enums"]["tracking_status"];
export type VehicleType = Database["public"]["Enums"]["vehicle_type"];

export interface LiveUser {
  user_id: string;
  display_name: string;
  vehicle_name: string | null;
  vehicle_type: VehicleType;
  plate_number: string | null;
  seats: number | null;
  status: TrackingStatus;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  heading: number | null;
  battery_level: number | null;
  is_tracking: boolean;
  last_seen: string;
  address?: string | null;
  /** Position comes from a hardware GPS tracker (buses.gps_imei), not a phone. */
  gps_tracker?: boolean;
}
