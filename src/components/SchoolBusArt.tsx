// A detailed side-view school bus (yellow body, windows, door, wheels, stop
// arm). Used on the attendant screen, the parent app and the overview so the
// bus looks like a bus, not a generic icon.
export function SchoolBusArt({
  size = 64,
  className,
  moving = false,
}: {
  size?: number;
  className?: string;
  /** Adds motion lines behind the bus. */
  moving?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 120 64"
      width={size}
      height={(size * 64) / 120}
      className={className}
      role="img"
      aria-label="School bus"
    >
      <defs>
        <linearGradient id="sb-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD43B" />
          <stop offset="1" stopColor="#F59F00" />
        </linearGradient>
        <linearGradient id="sb-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A5D8FF" />
          <stop offset="1" stopColor="#4DABF7" />
        </linearGradient>
      </defs>
      {moving && (
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35">
          <path d="M2 24h8M0 32h12M4 40h7" />
        </g>
      )}
      {/* shadow */}
      <ellipse cx="62" cy="58" rx="50" ry="3" fill="black" opacity="0.18" />
      {/* body */}
      <path
        d="M14 14c0-3 2-5 5-5h74c3 0 5 1.5 6 4l7 15c.7 1.5 1 3 1 4.5V48c0 2-1.5 3.5-3.5 3.5H17.5C15.5 51.5 14 50 14 48V14z"
        fill="url(#sb-body)"
        stroke="#B26B00"
        strokeWidth="1.2"
      />
      {/* roof light strip */}
      <rect x="20" y="11" width="70" height="2" rx="1" fill="#FFF3BF" opacity="0.8" />
      {/* side windows */}
      {[20, 34, 48, 62].map((x) => (
        <rect
          key={x}
          x={x}
          y="17"
          width="11"
          height="12"
          rx="1.6"
          fill="url(#sb-glass)"
          stroke="#1C3D5A"
          strokeWidth="0.8"
        />
      ))}
      {/* door */}
      <rect
        x="77"
        y="17"
        width="10"
        height="27"
        rx="1.4"
        fill="url(#sb-glass)"
        stroke="#1C3D5A"
        strokeWidth="0.8"
      />
      <path d="M82 17v27" stroke="#1C3D5A" strokeWidth="0.8" />
      {/* windscreen */}
      <path
        d="M91 17h4.5c1 0 1.8.5 2.2 1.4l5.3 11.6H91z"
        fill="url(#sb-glass)"
        stroke="#1C3D5A"
        strokeWidth="0.8"
      />
      {/* black stripes */}
      <rect x="14" y="33" width="63" height="1.8" fill="#212529" opacity="0.85" />
      <rect x="14" y="38" width="63" height="1.8" fill="#212529" opacity="0.85" />
      {/* SCHOOL BUS lettering block */}
      <rect x="26" y="41.5" width="38" height="5" rx="1" fill="#212529" opacity="0.12" />
      {/* stop arm */}
      <rect x="10" y="22" width="5" height="8" rx="1" fill="#E03131" />
      <text x="12.5" y="27.6" fontSize="3.2" textAnchor="middle" fill="white" fontWeight="700">
        STOP
      </text>
      {/* lights */}
      <circle cx="103" cy="40" r="2" fill="#FFF9DB" stroke="#B26B00" strokeWidth="0.6" />
      <rect x="15.5" y="42" width="2.5" height="4" rx="0.8" fill="#E03131" />
      {/* bumper */}
      <rect x="99" y="47" width="9" height="3" rx="1.2" fill="#495057" />
      <rect x="12" y="47" width="6" height="3" rx="1.2" fill="#495057" />
      {/* wheels */}
      {[32, 88].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="51" r="7.5" fill="#212529" />
          <circle cx={cx} cy="51" r="3.6" fill="#ADB5BD" />
          <circle cx={cx} cy="51" r="1.4" fill="#495057" />
        </g>
      ))}
    </svg>
  );
}
