import type { SVGProps } from "react";

// Custom vehicle silhouettes. Each icon renders as a filled + stroked SVG
// so it looks like an actual vehicle side profile, not a generic box.
// All icons share a 32x32 viewBox and use currentColor for stroke/fill,
// so they inherit color from CSS.

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
}

export function CarIcon(p: IconProps) {
  // Sedan silhouette
  return (
    <svg {...base(p)}>
      <path d="M4 20h24" />
      <path d="M6 20l1.5-5 3-3h11l3 3 1.5 5" fill="currentColor" fillOpacity="0.15" />
      <path d="M10.5 12l2-3h7l2 3" />
      <circle cx="10" cy="21.5" r="2.5" fill="currentColor" />
      <circle cx="22" cy="21.5" r="2.5" fill="currentColor" />
      <path d="M8 18h16" opacity="0.4" />
    </svg>
  );
}

export function SUVIcon(p: IconProps) {
  // Taller SUV/crossover
  return (
    <svg {...base(p)}>
      <path d="M4 20h24" />
      <path d="M5.5 20l1.5-7 3-4h12l3 4 1.5 7" fill="currentColor" fillOpacity="0.15" />
      <path d="M10 13l1.5-3h9l1.5 3" />
      <path d="M10 13h12" opacity="0.5" />
      <circle cx="10" cy="21.5" r="2.5" fill="currentColor" />
      <circle cx="22" cy="21.5" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function VanIcon(p: IconProps) {
  // Boxy cargo van with sloped windshield
  return (
    <svg {...base(p)}>
      <path d="M3 20h26" />
      <path d="M3 20V10l3-2h6v-1h11a2 2 0 0 1 2 2v11" fill="currentColor" fillOpacity="0.15" />
      <path d="M3 20V10l3-2h6v-1h11a2 2 0 0 1 2 2v11" />
      <path d="M12 8v6M6 14h6" opacity="0.5" />
      <path d="M14 14h11" opacity="0.4" />
      <circle cx="9" cy="21.5" r="2.5" fill="currentColor" />
      <circle cx="24" cy="21.5" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function TruckIcon(p: IconProps) {
  // Big rig / semi truck: cab + trailer
  return (
    <svg {...base(p)}>
      <path d="M2 20h28" />
      <rect x="14" y="8" width="14" height="12" rx="1" fill="currentColor" fillOpacity="0.15" />
      <path d="M14 8h14v12" />
      <path d="M2 20v-6h6l4-3h2v9" fill="currentColor" fillOpacity="0.15" />
      <path d="M2 20v-6h6l4-3h2v9" />
      <path d="M5 14h6v-2" opacity="0.5" />
      <circle cx="7" cy="21.5" r="2.5" fill="currentColor" />
      <circle cx="18" cy="21.5" r="2.5" fill="currentColor" />
      <circle cx="24" cy="21.5" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function PickupIcon(p: IconProps) {
  // Pickup truck: cab + open bed
  return (
    <svg {...base(p)}>
      <path d="M2 20h28" />
      <path d="M2 20v-4h11v-4l3-2h4v10" fill="currentColor" fillOpacity="0.15" />
      <path d="M2 20v-4h11v-4l3-2h4v10" />
      <rect x="20" y="14" width="10" height="6" fill="currentColor" fillOpacity="0.08" />
      <path d="M20 14h10v6" />
      <path d="M13 12h3l3-2" opacity="0.6" />
      <circle cx="8" cy="21.5" r="2.5" fill="currentColor" />
      <circle cx="24" cy="21.5" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function BusIcon(p: IconProps) {
  // Long bus with multiple windows
  return (
    <svg {...base(p)}>
      <path d="M3 20h26" />
      <rect x="3" y="6" width="26" height="14" rx="2" fill="currentColor" fillOpacity="0.15" />
      <rect x="3" y="6" width="26" height="14" rx="2" />
      <path d="M3 12h26" opacity="0.5" />
      <path d="M8 8v4M14 8v4M20 8v4M26 8v4" opacity="0.5" />
      <circle cx="8" cy="21.5" r="2.5" fill="currentColor" />
      <circle cx="24" cy="21.5" r="2.5" fill="currentColor" />
      <path d="M27 15v3" opacity="0.4" />
    </svg>
  );
}

export function MotorcycleIcon(p: IconProps) {
  // Motorbike with front fork + handlebar
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="21" r="4" fill="currentColor" fillOpacity="0.15" />
      <circle cx="8" cy="21" r="4" />
      <circle cx="24" cy="21" r="4" fill="currentColor" fillOpacity="0.15" />
      <circle cx="24" cy="21" r="4" />
      <path d="M8 21l5-8h4l3 3 4 5" />
      <path d="M13 13l2-3h4" />
      <path d="M19 10l3 1" />
      <path d="M17 16h4l-2 2z" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

export function BicycleIcon(p: IconProps) {
  // Bicycle: 2 wheels + frame + handlebar
  return (
    <svg {...base(p)}>
      <circle cx="7" cy="22" r="4" fill="currentColor" fillOpacity="0.1" />
      <circle cx="7" cy="22" r="4" />
      <circle cx="25" cy="22" r="4" fill="currentColor" fillOpacity="0.1" />
      <circle cx="25" cy="22" r="4" />
      <path d="M7 22l6-9h6l6 9" />
      <path d="M13 13l3 9" />
      <path d="M19 13l-3 3-3-3" opacity="0.6" />
      <path d="M20 10h3M11 10h3" />
    </svg>
  );
}

export function GenericVehicleIcon(p: IconProps) {
  // Placeholder / other — abstract vehicle marker
  return (
    <svg {...base(p)}>
      <path d="M16 3l3 6 6 1-4.5 4 1.2 6-5.7-3-5.7 3 1.2-6-4.5-4 6-1z" fill="currentColor" fillOpacity="0.15" />
      <path d="M16 3l3 6 6 1-4.5 4 1.2 6-5.7-3-5.7 3 1.2-6-4.5-4 6-1z" />
    </svg>
  );
}
