import type { ComponentType, SVGProps } from "react";
import type { Database } from "@/integrations/supabase/types";
import {
  CarIcon, SUVIcon, VanIcon, TruckIcon, PickupIcon, BusIcon,
  MotorcycleIcon, BicycleIcon, GenericVehicleIcon,
} from "./vehicle-icons";

export type VehicleType = Database["public"]["Enums"]["vehicle_type"];

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface VehicleMeta {
  key: VehicleType;
  label: string;
  Icon: IconComp;
  // Emoji fallback (only used if SVG rendering fails).
  emoji: string;
}

export const VEHICLES: readonly VehicleMeta[] = [
  { key: "car",        label: "Car",        Icon: CarIcon,             emoji: "🚗" },
  { key: "suv",        label: "SUV",        Icon: SUVIcon,             emoji: "🚙" },
  { key: "van",        label: "Van",        Icon: VanIcon,             emoji: "🚐" },
  { key: "truck",      label: "Truck",      Icon: TruckIcon,           emoji: "🚛" },
  { key: "pickup",     label: "Pickup",     Icon: PickupIcon,          emoji: "🛻" },
  { key: "bus",        label: "Bus",        Icon: BusIcon,             emoji: "🚌" },
  { key: "motorcycle", label: "Motorcycle", Icon: MotorcycleIcon,      emoji: "🏍" },
  { key: "bicycle",    label: "Bicycle",    Icon: BicycleIcon,         emoji: "🚲" },
  { key: "other",      label: "Other",      Icon: GenericVehicleIcon,  emoji: "📍" },
] as const;

export function getVehicle(type: VehicleType | null | undefined): VehicleMeta {
  return VEHICLES.find((v) => v.key === type) ?? VEHICLES[0];
}

/**
 * Renders a vehicle SVG as a static string for embedding into Leaflet's divIcon
 * (Leaflet needs plain HTML, not React). Kept small (24px) and colored via the
 * provided fill/stroke.
 */
export function vehicleSvgString(type: VehicleType | null | undefined, color: string): string {
  const v = getVehicle(type);
  const paths: Record<VehicleType, string> = {
    car: `<path d="M4 20h24"/><path d="M6 20l1.5-5 3-3h11l3 3 1.5 5" fill="${color}" fill-opacity="0.2"/><path d="M10.5 12l2-3h7l2 3"/><circle cx="10" cy="21.5" r="2.5" fill="${color}"/><circle cx="22" cy="21.5" r="2.5" fill="${color}"/>`,
    suv: `<path d="M4 20h24"/><path d="M5.5 20l1.5-7 3-4h12l3 4 1.5 7" fill="${color}" fill-opacity="0.2"/><path d="M10 13l1.5-3h9l1.5 3"/><circle cx="10" cy="21.5" r="2.5" fill="${color}"/><circle cx="22" cy="21.5" r="2.5" fill="${color}"/>`,
    van: `<path d="M3 20h26"/><path d="M3 20V10l3-2h6v-1h11a2 2 0 0 1 2 2v11" fill="${color}" fill-opacity="0.2"/><path d="M3 20V10l3-2h6v-1h11a2 2 0 0 1 2 2v11"/><path d="M12 8v6M6 14h6" opacity="0.5"/><circle cx="9" cy="21.5" r="2.5" fill="${color}"/><circle cx="24" cy="21.5" r="2.5" fill="${color}"/>`,
    truck: `<path d="M2 20h28"/><rect x="14" y="8" width="14" height="12" rx="1" fill="${color}" fill-opacity="0.2"/><path d="M14 8h14v12"/><path d="M2 20v-6h6l4-3h2v9" fill="${color}" fill-opacity="0.2"/><path d="M2 20v-6h6l4-3h2v9"/><circle cx="7" cy="21.5" r="2.5" fill="${color}"/><circle cx="18" cy="21.5" r="2.5" fill="${color}"/><circle cx="24" cy="21.5" r="2.5" fill="${color}"/>`,
    pickup: `<path d="M2 20h28"/><path d="M2 20v-4h11v-4l3-2h4v10" fill="${color}" fill-opacity="0.2"/><path d="M2 20v-4h11v-4l3-2h4v10"/><path d="M20 14h10v6"/><circle cx="8" cy="21.5" r="2.5" fill="${color}"/><circle cx="24" cy="21.5" r="2.5" fill="${color}"/>`,
    bus: `<path d="M3 20h26"/><rect x="3" y="6" width="26" height="14" rx="2" fill="${color}" fill-opacity="0.2"/><rect x="3" y="6" width="26" height="14" rx="2"/><path d="M3 12h26" opacity="0.5"/><path d="M8 8v4M14 8v4M20 8v4M26 8v4" opacity="0.5"/><circle cx="8" cy="21.5" r="2.5" fill="${color}"/><circle cx="24" cy="21.5" r="2.5" fill="${color}"/>`,
    motorcycle: `<circle cx="8" cy="21" r="4" fill="${color}" fill-opacity="0.2"/><circle cx="8" cy="21" r="4"/><circle cx="24" cy="21" r="4" fill="${color}" fill-opacity="0.2"/><circle cx="24" cy="21" r="4"/><path d="M8 21l5-8h4l3 3 4 5"/><path d="M13 13l2-3h4"/><path d="M19 10l3 1"/>`,
    bicycle: `<circle cx="7" cy="22" r="4" fill="${color}" fill-opacity="0.15"/><circle cx="7" cy="22" r="4"/><circle cx="25" cy="22" r="4" fill="${color}" fill-opacity="0.15"/><circle cx="25" cy="22" r="4"/><path d="M7 22l6-9h6l6 9"/><path d="M13 13l3 9"/><path d="M20 10h3M11 10h3"/>`,
    other: `<path d="M16 3l3 6 6 1-4.5 4 1.2 6-5.7-3-5.7 3 1.2-6-4.5-4 6-1z" fill="${color}" fill-opacity="0.2"/><path d="M16 3l3 6 6 1-4.5 4 1.2 6-5.7-3-5.7 3 1.2-6-4.5-4 6-1z"/>`,
  };
  const path = paths[v.key] ?? paths.car;
  return `<svg width="22" height="22" viewBox="0 0 32 32" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
