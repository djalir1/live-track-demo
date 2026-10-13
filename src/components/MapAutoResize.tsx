import { useEffect, useState } from "react";
import { useMap } from "react-leaflet";

/**
 * Leaflet measures its container once. On phones the map often starts inside
 * a hidden tab (0×0) or the container changes size on rotate / address-bar
 * collapse, which leaves grey tiles. Re-measure whenever the container resizes.
 * Returns a counter that bumps after each real resize (use it to re-fit).
 */
export function useMapAutoResize(): number {
  const map = useMap();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      if (el.clientWidth > 0 && el.clientHeight > 0) setTick((t) => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return tick;
}

export function MapAutoResize() {
  useMapAutoResize();
  return null;
}
