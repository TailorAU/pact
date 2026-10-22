"use client";

import { useState, useEffect, useCallback, useMemo, useRef, memo, createContext, useContext, Component, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { setOptions as setMapsOptions, importLibrary } from "@googlemaps/js-api-loader";
import {
  Fuel,
  ChevronDown,
  Clock,
  Globe,
  Navigation,
  Copy,
  Check,
  X,
  LocateFixed,
  Route,
  Car,
  Zap,
  ArrowRight,
  Trophy,
  Timer,
  MapPin,
  AlertTriangle,
  WifiOff,
} from "lucide-react";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const AU_CENTER = { lat: -30.0, lng: 147.0 };

const DEFAULT_TANK_LITRES = 50;
const DEFAULT_CONSUMPTION_L_PER_100KM = 8;

const DM_COOLDOWN_MS = 5_000;
const DIRECTIONS_COOLDOWN_MS = 3_000;

type AppMode = "now" | "ontheway";
type GeoStatus = "idle" | "requesting" | "granted" | "denied" | "unavailable";
type GeoAccuracy = "exact" | "approximate" | "unknown";

interface VehicleProfile {
  make: string | null;
  model: string | null;
  year: number | null;
  variant: string | null;
  fuel_type: string;
  consumption_l_per_100km: number;
  tank_litres: number;
  confidence: string;
  display_name: string;
}

const VEHICLE_STORAGE_KEY = "source_vehicle";

function loadVehicle(): VehicleProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VEHICLE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveVehicle(v: VehicleProfile) {
  try { localStorage.setItem(VEHICLE_STORAGE_KEY, JSON.stringify(v)); } catch {}
}

const FUEL_TYPES = [
  { value: "U91",    label: "U91",    color: "#22c55e" },
  { value: "E10",    label: "E10",    color: "#3b82f6" },
  { value: "U95",    label: "U95",    color: "#a855f7" },
  { value: "U98",    label: "U98",    color: "#ec4899" },
  { value: "Diesel", label: "Diesel", color: "#f59e0b" },
  { value: "PremDSL", label: "Prem Diesel", color: "#d97706" },
  { value: "LPG",    label: "LPG",    color: "#6b7280" },
] as const;

const FUEL_COLOR: Record<string, string> = Object.fromEntries(
  FUEL_TYPES.map((f) => [f.value, f.color])
);

const BRAND_STYLES: Record<string, { bg: string; fg: string; abbr: string }> = {
  "7-Eleven":       { bg: "#00703c", fg: "#fff", abbr: "7" },
  "BP":             { bg: "#009b3a", fg: "#fff", abbr: "BP" },
  "Ampol":          { bg: "#0033a0", fg: "#fff", abbr: "A" },
  "Shell":          { bg: "#fbce07", fg: "#000", abbr: "S" },
  "Caltex":         { bg: "#ed1c24", fg: "#fff", abbr: "CX" },
  "United":         { bg: "#0072ce", fg: "#fff", abbr: "U" },
  "Metro Petroleum":{ bg: "#ff6600", fg: "#fff", abbr: "M" },
  "OTR":            { bg: "#e4002b", fg: "#fff", abbr: "OT" },
  "Liberty":        { bg: "#003087", fg: "#fff", abbr: "L" },
  "EG Ampol":       { bg: "#0033a0", fg: "#fff", abbr: "EG" },
  "Costco":         { bg: "#e31837", fg: "#fff", abbr: "CO" },
  "Speedway":       { bg: "#d62027", fg: "#fff", abbr: "SP" },
  "Reddy Express":  { bg: "#cc0000", fg: "#fff", abbr: "R" },
  "Budget":         { bg: "#f7941d", fg: "#000", abbr: "B" },
  "UGo":            { bg: "#00a651", fg: "#fff", abbr: "UG" },
  "Independent":    { bg: "#666",    fg: "#fff", abbr: "i" },
};

function getBrand(brand: string | null) {
  if (!brand) return { bg: "#555", fg: "#fff", abbr: "?" };
  return BRAND_STYLES[brand] ?? { bg: "#555", fg: "#fff", abbr: brand.charAt(0).toUpperCase() };
}

interface FuelPrice { type: string; price: number; observedAt: string }

interface Station {
  id: string; name: string; brand: string | null;
  address: string | null; suburb: string | null; state: string;
  lat: number; lng: number; prices: FuelPrice[];
}

interface DriveInfo { durationSec: number; distanceM: number }

interface RankedStation extends Station {
  distKm: number;
  driveMin: number;
  effectivePrice: number;
  driveCostPerTank: number;
  rank: number;
  detourMin?: number;
}

interface FuelData {
  types: string[];
  state: string;
  stations: Station[];
  stats: { min: number; max: number; avg: number; count: number };
  freshness?: { newestAt: string | null; oldestAt: string | null; fetchedAt: string };
}

interface Bounds { north: number; south: number; east: number; west: number }
interface LatLng { lat: number; lng: number }

class MapErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
          <div className="text-center px-6 max-w-md">
            <AlertTriangle size={48} className="text-amber-500 mx-auto mb-4" />
            <p className="text-white font-bold text-lg mb-2">Map failed to load</p>
            <p className="text-zinc-400 text-sm mb-4">{this.state.error.message}</p>
            <button onClick={() => this.setState({ error: null })} className="px-4 py-2 rounded-lg bg-green-500 text-black font-bold text-sm hover:bg-green-400 transition-colors">
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function effectiveWithDrive(priceCpl: number, driveDistKm: number, roundTrip: boolean, lPer100km = DEFAULT_CONSUMPTION_L_PER_100KM, tankL = DEFAULT_TANK_LITRES): number {
  const km = roundTrip ? driveDistKm * 2 : driveDistKm;
  const fuelUsedL = km * (lPer100km / 100);
  const driveCostCents = fuelUsedL * priceCpl;
  return priceCpl + driveCostCents / tankL;
}

function cheapest(prices: FuelPrice[]): FuelPrice | undefined {
  return prices.reduce<FuelPrice | undefined>(
    (best, p) => (!best || p.price < best.price ? p : best), undefined
  );
}

function priceColor(price: number, min: number, max: number): string {
  if (max === min) return "#22c55e";
  const t = (price - min) / (max - min);
  if (t < 0.33) return "#22c55e";
  if (t < 0.66) return "#eab308";
  return "#ef4444";
}

function fullAddress(s: Station): string {
  return [s.address, s.suburb, s.state].filter(Boolean).join(", ");
}

function formatDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

function directionsUrl(lat: number, lng: number, from?: LatLng): string {
  const isIos = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isIos) {
    const base = `maps://maps.apple.com/?daddr=${lat},${lng}`;
    return from ? base + `&saddr=${from.lat},${from.lng}` : base;
  }
  const base = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return from ? base + `&origin=${from.lat},${from.lng}` : base;
}

function priceBadgeSvg(
  prices: { type: string; price: number }[],
  bgColor: string,
  brandBg: string, brandFg: string, brandAbbr: string,
): string {
  const entries = prices.map(p => {
    const text = p.price.toFixed(1);
    return { color: FUEL_COLOR[p.type] ?? "#888", text, w: text.length * 5.5 };
  });
  const contentW = entries.reduce((sum, e) => sum + 7 + e.w, 0);
  const w = 16 + contentW + 2;
  const h = 16;
  let x = 16;
  const parts = entries.map(e => {
    const cx = x + 3.5;
    const tx = cx + 5;
    const out = `<circle cx="${cx}" cy="8" r="2.5" fill="${e.color}"/><text x="${tx}" y="11.5" font-family="Arial,sans-serif" font-size="9" font-weight="800" fill="#fff">${e.text}</text>`;
    x = tx + e.w;
    return out;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" rx="3" fill="${bgColor}" opacity="0.92"/>
    <rect x="1" y="1" width="14" height="14" rx="2" fill="${brandBg}"/>
    <text x="8" y="11" text-anchor="middle" font-family="Arial,sans-serif" font-size="${brandAbbr.length > 1 ? 6.5 : 9}" font-weight="700" fill="${brandFg}">${brandAbbr}</text>
    ${parts}
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function bestBadgeSvg(
  prices: { type: string; price: number }[],
  brandBg: string, brandFg: string, brandAbbr: string,
): string {
  const entries = prices.map(p => {
    const text = p.price.toFixed(1);
    return { color: FUEL_COLOR[p.type] ?? "#888", text, w: text.length * 6.5 };
  });
  const contentW = entries.reduce((sum, e) => sum + 9 + e.w, 0);
  const w = 22 + contentW + 32;
  const h = 22;
  let x = 22;
  const parts = entries.map(e => {
    const cx = x + 4;
    const tx = cx + 6;
    const out = `<circle cx="${cx}" cy="11" r="3" fill="${e.color}"/><text x="${tx}" y="15" font-family="Arial,sans-serif" font-size="11" font-weight="900" fill="#fff">${e.text}</text>`;
    x = tx + e.w;
    return out;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" rx="4" fill="#16a34a" opacity="0.95"/>
    <rect x="2" y="2" width="18" height="18" rx="3" fill="${brandBg}"/>
    <text x="11" y="15" text-anchor="middle" font-family="Arial,sans-serif" font-size="${brandAbbr.length > 1 ? 8 : 11}" font-weight="700" fill="${brandFg}">${brandAbbr}</text>
    ${parts}
    <text x="${w - 16}" y="15" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#bbf7d0">BEST</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function dotSvg(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const MapContext = createContext<google.maps.Map | null>(null);
function useMap() { return useContext(MapContext); }

let _loaderP: Promise<void> | null = null;
function loadMapsApi() {
  if (!_loaderP && MAPS_KEY) {
    setMapsOptions({ key: MAPS_KEY, v: "weekly" });
    _loaderP = Promise.all([
      importLibrary("maps"),
      importLibrary("routes"),
      importLibrary("places"),
    ]).then(() => {});
  }
  return _loaderP ?? Promise.resolve();
}

function GoogleMapsProvider({ children }: { children: ReactNode }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  useEffect(() => {
    loadMapsApi().then(() => {
      if (!divRef.current || mapRef.current) return;
      const m = new google.maps.Map(divRef.current, {
        center: AU_CENTER,
        zoom: 5,
        gestureHandling: "greedy",
        disableDefaultUI: true,
        zoomControl: true,
      });
      mapRef.current = m;
      setMap(m);
    });
  }, []);

  return (
    <MapContext.Provider value={map}>
      <div ref={divRef} className="absolute inset-0 z-0" />
      {map && children}
    </MapContext.Provider>
  );
}

function NativeInfoWindow({ position, onClose, children }: { position: LatLng; onClose: () => void; children: ReactNode }) {
  const map = useMap();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const closeCb = useRef(onClose);
  closeCb.current = onClose;

  useEffect(() => {
    if (!map) return;
    const div = document.createElement("div");
    const iw = new google.maps.InfoWindow({ content: div, position, headerDisabled: true } as google.maps.InfoWindowOptions);
    iw.addListener("closeclick", () => closeCb.current());
    iw.open({ map });
    setContainer(div);
    return () => { iw.close(); setContainer(null); };
  }, [map, position.lat, position.lng]);

  return container ? createPortal(children, container) : null;
}

function useThrottle<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastRef = useRef(Date.now());
  useEffect(() => {
    const now = Date.now();
    if (now - lastRef.current >= ms) {
      lastRef.current = now;
      setThrottled(value);
    } else {
      const id = setTimeout(() => {
        lastRef.current = Date.now();
        setThrottled(value);
      }, ms - (now - lastRef.current));
      return () => clearTimeout(id);
    }
  }, [value, ms]);
  return throttled;
}

function ViewportTracker({ onBoundsChange }: { onBoundsChange: (b: Bounds) => void }) {
  const map = useMap();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const b = map.getBounds();
      if (!b) return;
      onBoundsChange({ north: b.getNorthEast().lat(), south: b.getSouthWest().lat(), east: b.getNorthEast().lng(), west: b.getSouthWest().lng() });
    };
    const handler = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(update, 150); };
    const l = map.addListener("idle", handler);
    update();
    return () => { google.maps.event.removeListener(l); };
  }, [map, onBoundsChange]);
  return null;
}

function AutoLocate({ onLocated, onStatus, onAccuracy }: { onLocated: (loc: LatLng) => void; onStatus: (s: GeoStatus) => void; onAccuracy: (a: GeoAccuracy, meters: number) => void }) {
  const map = useMap();
  const attempted = useRef(false);
  useEffect(() => {
    if (!map || attempted.current) return;
    attempted.current = true;
    if (!navigator.geolocation) { onStatus("unavailable"); return; }
    onStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const acc = pos.coords.accuracy;
        map.panTo(loc); map.setZoom(13); onLocated(loc); onStatus("granted");
        onAccuracy(acc <= 100 ? "exact" : "approximate", Math.round(acc));
      },
      (err) => { onStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }, [map, onLocated, onStatus, onAccuracy]);
  return null;
}

function LocateButton({ geoStatus, geoAccuracy, accuracyMeters, onLocated, onStatus, onAccuracy }: {
  geoStatus: GeoStatus; geoAccuracy: GeoAccuracy; accuracyMeters: number;
  onLocated: (loc: LatLng) => void; onStatus: (s: GeoStatus) => void; onAccuracy: (a: GeoAccuracy, meters: number) => void;
}) {
  const map = useMap();
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const deniedCountRef = useRef(0);

  const locate = useCallback(() => {
    if (!map || !navigator.geolocation) return;
    setBusy(true);
    onStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const acc = pos.coords.accuracy;
        map.panTo(loc); map.setZoom(13); onLocated(loc); onStatus("granted"); setBusy(false);
        onAccuracy(acc <= 100 ? "exact" : "approximate", Math.round(acc));
        deniedCountRef.current = 0;
        setShowHelp(false);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          onStatus("denied");
          deniedCountRef.current += 1;
          if (deniedCountRef.current >= 1) setShowHelp(true);
        } else {
          onStatus("unavailable");
        }
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [map, onLocated, onStatus, onAccuracy]);

  const isRequesting = busy || geoStatus === "requesting";
  const isDenied = geoStatus === "denied";
  const isUnavailable = geoStatus === "unavailable";
  const isExact = geoStatus === "granted" && geoAccuracy === "exact";
  const isApprox = geoStatus === "granted" && geoAccuracy === "approximate";

  const ringColor = isExact ? "border-green-500" : isApprox ? "border-amber-500" : isDenied ? "border-red-500" : isRequesting ? "border-blue-400" : "border-zinc-600";
  const iconColor = isExact ? "text-green-400" : isApprox ? "text-amber-400" : isDenied ? "text-red-400" : isUnavailable ? "text-zinc-500" : isRequesting ? "text-blue-400" : "text-zinc-400";
  const bgColor = isExact ? "bg-green-950/60" : isApprox ? "bg-amber-950/60" : isDenied ? "bg-red-950/60" : "bg-black/75";

  const label = isExact ? `\u00b1${accuracyMeters}m` : isApprox ? `~${accuracyMeters >= 1000 ? `${(accuracyMeters / 1000).toFixed(1)}km` : `${accuracyMeters}m`}` : isDenied ? "Blocked" : isUnavailable ? "N/A" : isRequesting ? "..." : "";

  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isChrome = typeof navigator !== "undefined" && /Chrome/.test(navigator.userAgent) && !/Edge/.test(navigator.userAgent);
  const isSafari = typeof navigator !== "undefined" && /Safari/.test(navigator.userAgent) && !isChrome;

  return (
    <>
      <button onClick={locate} className={`absolute bottom-16 right-3 z-20 ${bgColor} backdrop-fix border-2 ${ringColor} rounded-2xl flex items-center gap-1.5 px-2.5 h-11 hover:brightness-125 active:scale-95 transition-all shadow-lg`} title={isDenied ? "Location blocked \u2014 tap for help" : "Find my location"} aria-label="Find my location">
        <LocateFixed size={18} className={`${iconColor} ${isRequesting ? "animate-spin" : ""} shrink-0`} />
        {label && <span className={`text-[11px] font-bold ${iconColor} whitespace-nowrap`}>{label}</span>}
      </button>

      {showHelp && isDenied && (
        <div className="absolute bottom-28 right-3 z-30 w-72 bg-zinc-900/95 backdrop-blur-md border border-red-500/40 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-2">
          <button onClick={() => setShowHelp(false)} className="absolute top-2 right-2 text-zinc-500 hover:text-white p-1" aria-label="Close">
            <X size={14} />
          </button>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
              <LocateFixed size={16} className="text-red-400" />
            </div>
            <span className="text-[13px] font-bold text-white">Location Blocked</span>
          </div>
          <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed">
            PACT needs your location to find nearby fuel stations and calculate drive times.
          </p>
          <div className="text-[11px] text-zinc-300 space-y-2">
            {isIOS && isSafari ? (
              <>
                <p className="font-semibold text-amber-400">iPhone Safari:</p>
                <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                  <li>Open <span className="text-white font-medium">Settings</span> app</li>
                  <li>Scroll to <span className="text-white font-medium">Safari</span></li>
                  <li>Tap <span className="text-white font-medium">Location</span></li>
                  <li>Set to <span className="text-green-400 font-medium">Allow</span> or <span className="text-green-400 font-medium">Ask</span></li>
                  <li>Come back and refresh this page</li>
                </ol>
              </>
            ) : isIOS && isChrome ? (
              <>
                <p className="font-semibold text-amber-400">iPhone Chrome:</p>
                <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                  <li>Open <span className="text-white font-medium">Settings</span> app</li>
                  <li>Scroll to <span className="text-white font-medium">Chrome</span></li>
                  <li>Tap <span className="text-white font-medium">Location</span></li>
                  <li>Set to <span className="text-green-400 font-medium">While Using</span></li>
                  <li>Come back and refresh this page</li>
                </ol>
              </>
            ) : isChrome ? (
              <>
                <p className="font-semibold text-amber-400">Chrome:</p>
                <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                  <li>Tap the <span className="text-white font-medium">lock icon</span> in the address bar</li>
                  <li>Tap <span className="text-white font-medium">Site settings</span></li>
                  <li>Set <span className="text-white font-medium">Location</span> to <span className="text-green-400 font-medium">Allow</span></li>
                  <li>Refresh this page</li>
                </ol>
              </>
            ) : (
              <>
                <p className="font-semibold text-amber-400">How to enable:</p>
                <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                  <li>Tap the <span className="text-white font-medium">lock/info icon</span> in the address bar</li>
                  <li>Find <span className="text-white font-medium">Location</span> permission</li>
                  <li>Set to <span className="text-green-400 font-medium">Allow</span></li>
                  <li>Refresh this page</li>
                </ol>
              </>
            )}
          </div>
          <button onClick={() => { setShowHelp(false); locate(); }} className="mt-3 w-full py-2 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white text-[12px] font-bold rounded-xl transition-colors">
            Try Again
          </button>
        </div>
      )}
    </>
  );
}

function UserLocationMarker({ loc }: { loc: LatLng }) {
  const map = useMap();
  const markerRef = useRef<google.maps.Marker | null>(null);
  useEffect(() => {
    if (!map) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#3b82f6" opacity="0.2"/><circle cx="12" cy="12" r="6" fill="#3b82f6" stroke="#fff" stroke-width="2.5"/></svg>`;
    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({
        map,
        position: loc,
        zIndex: 9999,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
          scaledSize: new google.maps.Size(24, 24),
          anchor: new google.maps.Point(12, 12),
        },
      });
    } else {
      markerRef.current.setPosition(loc);
    }
    return () => { if (markerRef.current) { markerRef.current.setMap(null); markerRef.current = null; } };
  }, [map, loc]);
  return null;
}

function StationMarkers({
  stations, vpMin, vpMax, zoomedIn, activeFuelTypes, bestId, onSelect, bounds,
}: {
  stations: Station[]; vpMin: number; vpMax: number; zoomedIn: boolean;
  activeFuelTypes: Set<string>; bestId: string | null; onSelect: (s: Station) => void;
  bounds: Bounds | null;
}) {
  const map = useMap();
  const markersRef = useRef<Map<string, { marker: google.maps.Marker; url: string }>>(new Map());
  const fuelTypeOrder = useMemo(() => new Map<string, number>(FUEL_TYPES.map((f, i) => [f.value, i])), []);

  const visible = useMemo(() => {
    if (!bounds) return stations.slice(0, 300);
    const padLat = (bounds.north - bounds.south) * 0.15;
    const padLng = (bounds.east - bounds.west) * 0.15;
    return stations
      .filter(s => s.lat >= bounds.south - padLat && s.lat <= bounds.north + padLat && s.lng >= bounds.west - padLng && s.lng <= bounds.east + padLng)
      .slice(0, 500);
  }, [stations, bounds]);

  const markerData = useMemo(() => visible.map((s) => {
    const relevant = s.prices
      .filter((p) => activeFuelTypes.has(p.type))
      .sort((a, b) => (fuelTypeOrder.get(a.type) ?? 99) - (fuelTypeOrder.get(b.type) ?? 99));
    const best = cheapest(relevant);
    const price = best?.price ?? 0;
    const color = priceColor(price, vpMin, vpMax);
    const isBest = s.id === bestId;
    const bs = getBrand(s.brand);

    if (isBest && zoomedIn) {
      const url = bestBadgeSvg(relevant, bs.bg, bs.fg, bs.abbr);
      const w = 22 + relevant.reduce((sum, p) => sum + 9 + p.price.toFixed(1).length * 6.5, 0) + 32;
      return { id: s.id, lat: s.lat, lng: s.lng, url, w, h: 22, zIndex: 10000, station: s };
    }
    if (!zoomedIn) {
      return { id: s.id, lat: s.lat, lng: s.lng, url: dotSvg(color), w: 10, h: 10, zIndex: 1, station: s };
    }
    const url = priceBadgeSvg(relevant, "rgba(24,24,27,0.92)", bs.bg, bs.fg, bs.abbr);
    const w = 16 + relevant.reduce((sum, p) => sum + 7 + p.price.toFixed(1).length * 5.5, 0) + 2;
    return { id: s.id, lat: s.lat, lng: s.lng, url, w, h: 16, zIndex: 1, station: s };
  }), [visible, activeFuelTypes, vpMin, vpMax, zoomedIn, bestId, fuelTypeOrder]);

  useEffect(() => {
    if (!map) return;
    const prev = markersRef.current;
    const nextIds = new Set(markerData.map(m => m.id));
    const nextMap = new Map<string, typeof markerData[0]>();
    for (const m of markerData) nextMap.set(m.id, m);
    for (const [id, entry] of prev) {
      if (!nextIds.has(id)) { entry.marker.setMap(null); prev.delete(id); }
    }
    for (const m of markerData) {
      const existing = prev.get(m.id);
      if (existing && existing.url === m.url) continue;
      if (existing) existing.marker.setMap(null);
      const marker = new google.maps.Marker({
        map, position: { lat: m.lat, lng: m.lng }, zIndex: m.zIndex,
        icon: { url: m.url, scaledSize: new google.maps.Size(m.w, m.h), anchor: new google.maps.Point(m.w / 2, m.h / 2) },
      });
      marker.addListener("click", () => onSelect(m.station));
      prev.set(m.id, { marker, url: m.url });
    }
    return () => { prev.forEach(e => e.marker.setMap(null)); prev.clear(); };
  }, [map, markerData, onSelect]);

  return null;
}

function DriveTimesFetcher({ userLoc, candidates, onResults }: { userLoc: LatLng; candidates: Station[]; onResults: (m: Map<string, DriveInfo>) => void }) {
  const fetchedKey = useRef("");
  const lastCallRef = useRef(0);

  useEffect(() => {
    if (candidates.length === 0) return;
    const key = `${userLoc.lat.toFixed(4)},${userLoc.lng.toFixed(4)}-${candidates.map((c) => c.id).join(",")}`;
    if (key === fetchedKey.current) return;

    const now = Date.now();
    const elapsed = now - lastCallRef.current;
    if (elapsed < DM_COOLDOWN_MS) {
      const timer = setTimeout(() => { fetchedKey.current = key; lastCallRef.current = Date.now(); callDM(); }, DM_COOLDOWN_MS - elapsed);
      return () => clearTimeout(timer);
    }

    fetchedKey.current = key;
    lastCallRef.current = now;
    callDM();

    function callDM() {
      const service = new google.maps.DistanceMatrixService();
      const batch = candidates.slice(0, 10);
      service.getDistanceMatrix(
        { origins: [new google.maps.LatLng(userLoc.lat, userLoc.lng)], destinations: batch.map((s) => new google.maps.LatLng(s.lat, s.lng)), travelMode: google.maps.TravelMode.DRIVING, unitSystem: google.maps.UnitSystem.METRIC },
        (resp, status) => {
          if (status !== "OK" || !resp) return;
          const m = new Map<string, DriveInfo>();
          const row = resp.rows[0]?.elements ?? [];
          row.forEach((el, i) => { if (el.status === "OK") m.set(batch[i].id, { durationSec: el.duration.value, distanceM: el.distance.value }); });
          onResults(m);
        }
      );
    }
  }, [userLoc, candidates, onResults]);
  return null;
}

function RouteLines({ userLoc, stations }: { userLoc: LatLng; stations: RankedStation[] }) {
  const map = useMap();
  const renderersRef = useRef<google.maps.DirectionsRenderer[]>([]);
  const lastCallRef = useRef(0);

  useEffect(() => {
    if (!map || stations.length === 0) return;
    const clear = () => { renderersRef.current.forEach((r) => r.setMap(null)); renderersRef.current = []; };
    clear();
    const now = Date.now();
    if (now - lastCallRef.current < DIRECTIONS_COOLDOWN_MS) return;
    lastCallRef.current = now;

    const ds = new google.maps.DirectionsService();
    stations.slice(0, 3).forEach((s, i) => {
      ds.route(
        { origin: userLoc, destination: { lat: s.lat, lng: s.lng }, travelMode: google.maps.TravelMode.DRIVING },
        (result, status) => {
          if (status !== "OK" || !result) return;
          const colors = ["#22c55e", "#3b82f6", "#71717a"];
          const weights = [5, 3, 2];
          const opacities = [0.9, 0.5, 0.3];
          const renderer = new google.maps.DirectionsRenderer({
            map, directions: result, suppressMarkers: true, preserveViewport: true,
            polylineOptions: { strokeColor: colors[i], strokeWeight: weights[i], strokeOpacity: opacities[i] },
          });
          renderersRef.current.push(renderer);
        }
      );
    });
    return clear;
  }, [map, userLoc, stations]);
  return null;
}

function OnTheWayPanel({ userLoc, onRouteFound, onClose }: { userLoc: LatLng; onRouteFound: (path: LatLng[], durationMin: number, destName: string) => void; onClose: () => void }) {
  const map = useMap();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const clearRenderer = useCallback(() => { if (rendererRef.current) { rendererRef.current.setMap(null); rendererRef.current = null; } }, []);
  useEffect(() => () => clearRenderer(), [clearRenderer]);

  const routeTo = useCallback(async (destName: string) => {
    if (!map || !inputRef.current) return;
    const dest = inputRef.current.value.trim() || destName;
    if (!dest) return;
    setLoading(true); setError(""); clearRenderer();
    try {
      const ds = new google.maps.DirectionsService();
      const result = await ds.route({ origin: userLoc, destination: dest, travelMode: google.maps.TravelMode.DRIVING, region: "au" });
      const renderer = new google.maps.DirectionsRenderer({
        map, directions: result, suppressMarkers: false,
        polylineOptions: { strokeColor: "#3b82f6", strokeWeight: 5, strokeOpacity: 0.8 },
      });
      rendererRef.current = renderer;
      const leg = result.routes[0]?.legs?.[0];
      const durationMin = leg ? Math.round(leg.duration!.value / 60) : 0;
      const path = result.routes[0]?.overview_path?.map((p) => ({ lat: p.lat(), lng: p.lng() })) ?? [];
      onRouteFound(path, durationMin, dest);
    } catch { setError("Could not find route. Try a more specific address."); } finally { setLoading(false); }
  }, [map, userLoc, clearRenderer, onRouteFound]);

  const routeToRef = useRef(routeTo);
  routeToRef.current = routeTo;

  useEffect(() => {
    if (!inputRef.current || autocompleteRef.current) return;
    const ac = new google.maps.places.Autocomplete(inputRef.current, { componentRestrictions: { country: "au" }, fields: ["geometry", "name", "formatted_address"] });
    if (userLoc) { const bias = new google.maps.Circle({ center: userLoc, radius: 50000 }); ac.setBounds(bias.getBounds()!); }
    ac.addListener("place_changed", () => { const place = ac.getPlace(); if (place?.geometry?.location) routeToRef.current(place.formatted_address ?? place.name ?? "Destination"); });
    autocompleteRef.current = ac;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute top-14 left-3 right-3 sm:right-auto sm:w-80 z-30 rounded-xl bg-black/90 backdrop-blur-md border border-zinc-700/50 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50">
        <span className="flex items-center gap-1.5 text-xs font-bold text-white"><Route size={12} className="text-blue-400" /> Where are you heading?</span>
        <button onClick={() => { clearRenderer(); onClose(); }} className="text-zinc-500 hover:text-white p-2 -m-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close route planner"><X size={16} /></button>
      </div>
      <div className="p-3 space-y-2">
        <div className="text-[10px] text-zinc-500 flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500" /> You <ArrowRight size={8} /> Where to?</div>
        <input ref={inputRef} onKeyDown={(e) => e.key === "Enter" && routeTo(inputRef.current?.value ?? "")} placeholder="Type an address..." className="w-full bg-zinc-900 border border-zinc-800 no-zoom-input text-white rounded-md px-3 py-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50" autoComplete="off" autoCapitalize="words" enterKeyHint="search" maxLength={200} autoFocus />
        <button onClick={() => routeTo(inputRef.current?.value ?? "")} disabled={loading} className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold py-3 min-h-[44px] hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {loading ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Car size={14} />}
          {loading ? "Finding route..." : "Find Route & Best Fuel"}
        </button>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function RankedList({ stations, onSelect }: { stations: RankedStation[]; onSelect: (s: Station) => void }) {
  return (
    <div className="space-y-0.5" role="list" aria-label="Fuel stations ranked by value">
      {stations.map((s) => {
        const bs = getBrand(s.brand);
        const isBest = s.rank === 1;
        const priceLabel = s.prices.map(p => `${p.type} ${p.price.toFixed(1)}`).join(", ");
        return (
          <button key={s.id} onClick={() => onSelect(s)} className={`w-full text-left flex items-center gap-2 rounded-lg px-2 py-2.5 min-h-[52px] transition-colors group active:scale-[0.98] ${isBest ? "bg-green-950/40 border border-green-800/40 hover:bg-green-900/40" : "hover:bg-zinc-800/60 active:bg-zinc-800"}`} aria-label={`${s.name}, ${priceLabel || "unknown"} cents per litre`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black ${isBest ? "bg-green-500 text-black" : s.rank <= 3 ? "bg-zinc-700 text-white" : "bg-transparent text-zinc-600"}`}>
              {isBest ? <Trophy size={11} /> : s.rank}
            </div>
            <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-[9px] font-bold" style={{ backgroundColor: bs.bg, color: bs.fg }}>{bs.abbr}</div>
            <div className="min-w-0 flex-1">
              <div className={`text-[13px] font-medium truncate ${isBest ? "text-green-300" : "text-white group-hover:text-green-300"}`}>{s.name}</div>
              <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                <span className="flex items-center gap-0.5"><Car size={9} className="text-zinc-600" /><span className="text-zinc-400 font-medium">{formatDist(s.distKm)}</span></span>
                <span className="flex items-center gap-0.5"><Timer size={9} className="text-zinc-600" /><span className={`font-medium ${isBest ? "text-green-400" : "text-zinc-400"}`}>{s.driveMin} min</span></span>
                {s.detourMin != null && s.detourMin > 0 && <span className="text-amber-500/80 text-[10px]">+{s.detourMin}m detour</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="space-y-0.5">
                {s.prices.map((p) => (
                  <div key={p.type} className="flex items-center justify-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: FUEL_COLOR[p.type] ?? "#888" }} />
                    <span className={`text-[12px] font-black tabular-nums ${isBest ? "text-green-400" : "text-white"}`}>{p.price.toFixed(1)}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] tabular-nums flex items-center justify-end gap-0.5 mt-0.5">
                <Zap size={8} className="text-amber-500" />
                <span className={`font-bold ${isBest ? "text-green-400" : "text-zinc-400"}`}>{s.effectivePrice.toFixed(1)}</span>
                <span className="text-zinc-700 text-[8px]">eff</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function useElapsed(dataAge: Date | null, lastRefresh: Date | null) {
  const [elapsed, setElapsed] = useState("");
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const ref = dataAge ?? lastRefresh;
    if (!ref) return;
    const tick = () => {
      const sec = Math.floor((Date.now() - ref.getTime()) / 1000);
      setStale(sec > 4 * 3600);
      if (sec < 60) setElapsed("< 1 min ago");
      else if (sec < 3600) setElapsed(`${Math.floor(sec / 60)}m ago`);
      else if (sec < 86400) setElapsed(`${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ago`);
      else setElapsed(`${Math.floor(sec / 86400)}d ago`);
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [dataAge, lastRefresh]);
  return { elapsed, stale };
}

const DataFreshnessStatus = memo(function DataFreshnessStatus({ loading, elapsed, stale }: { loading: boolean; elapsed: string; stale: boolean }) {
  return (
    <div className={`flex items-center gap-1 text-[9px] pr-1 ${stale ? "text-amber-500" : "text-zinc-600"}`}>
      {loading ? (<><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Refreshing&hellip;</>) : stale ? (<><AlertTriangle size={9} className="text-amber-500" /> Prices {elapsed}</>) : elapsed ? (<><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> Prices {elapsed}</>) : (<><Clock size={9} /> &ndash;</>)}
    </div>
  );
});

const StaleBanner = memo(function StaleBanner({ stale, loading, elapsed, onRefresh }: { stale: boolean; loading: boolean; elapsed: string; onRefresh: () => void }) {
  if (!stale || loading) return null;
  return (
    <div className="absolute top-[96px] pt-safe inset-x-0 z-50 flex justify-center pointer-events-none px-3">
      <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-amber-900/90 backdrop-blur-md border border-amber-600/50 px-3 py-1.5 shadow-xl">
        <AlertTriangle size={12} className="text-amber-400 shrink-0" />
        <span className="text-[11px] text-amber-200 font-medium">Prices may be outdated ({elapsed})</span>
        <button onClick={onRefresh} className="text-[11px] text-amber-400 font-bold hover:text-amber-300 underline underline-offset-2">Refresh</button>
      </div>
    </div>
  );
});

// ── Main Page ───────────────────────────────────────────

export default function FuelPage() {
  const [mode, setMode] = useState<AppMode>("now");
  const [activeFuels, setActiveFuels] = useState<Set<string>>(new Set(["U91", "Diesel"]));
  const [data, setData] = useState<FuelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Station | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [copied, setCopied] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelTouchRef = useRef<{ startY: number; startOpen: boolean } | null>(null);
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [geoAccuracy, setGeoAccuracy] = useState<GeoAccuracy>("unknown");
  const [accuracyMeters, setAccuracyMeters] = useState(0);
  const [driveMap, setDriveMap] = useState<Map<string, DriveInfo>>(new Map());
  const [dataAge, setDataAge] = useState<Date | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const { elapsed, stale } = useElapsed(dataAge, lastRefresh);

  const [routePath, setRoutePath] = useState<LatLng[]>([]);
  const [routeDuration, setRouteDuration] = useState(0);
  const [routeDest, setRouteDest] = useState("");

  const [vehicle, setVehicleState] = useState<VehicleProfile | null>(null);
  const [vehicleInput, setVehicleInput] = useState("");
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [fuelDropOpen, setFuelDropOpen] = useState(false);
  const [attribOpen, setAttribOpen] = useState(false);

  useEffect(() => { setVehicleState(loadVehicle()); }, []);

  const tankL = vehicle?.tank_litres ?? DEFAULT_TANK_LITRES;
  const lPer100 = vehicle?.consumption_l_per_100km ?? DEFAULT_CONSUMPTION_L_PER_100KM;

  const resolveVehicle = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setVehicleLoading(true);
    try {
      const res = await fetch("/api/vehicle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.trim() }) });
      if (!res.ok) throw new Error("Failed");
      const profile: VehicleProfile = await res.json();
      saveVehicle(profile); setVehicleState(profile); setVehicleOpen(false);
    } catch { /* ignore */ } finally { setVehicleLoading(false); }
  }, []);

  const clearVehicle = useCallback(() => {
    try { localStorage.removeItem(VEHICLE_STORAGE_KEY); } catch {}
    setVehicleState(null); setVehicleInput("");
  }, []);

  const toggleFuel = useCallback((type: string) => {
    setActiveFuels((prev) => {
      const next = new Set(prev);
      if (next.has(type)) { if (next.size > 1) next.delete(type); } else { next.add(type); }
      return next;
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true); setSelected(null); setFetchError(null);
    try {
      const types = Array.from(activeFuels).join(",");
      const res = await fetch(`/api/fuel?${new URLSearchParams({ types })}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.stations || !Array.isArray(json.stations)) throw new Error("Invalid response");
      setData(json); setLastRefresh(new Date());
      if (json.freshness?.newestAt) setDataAge(new Date(json.freshness.newestAt));
    } catch (err) { setFetchError(err instanceof Error ? err.message : "Failed to load"); setData(null); } finally { setLoading(false); }
  }, [activeFuels]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onBoundsChange = useCallback((b: Bounds) => setBounds(b), []);
  const onLocated = useCallback((loc: LatLng) => setUserLoc(loc), []);
  const onGeoStatus = useCallback((s: GeoStatus) => setGeoStatus(s), []);
  const onGeoAccuracy = useCallback((a: GeoAccuracy, meters: number) => { setGeoAccuracy(a); setAccuracyMeters(meters); }, []);
  const onDriveResults = useCallback((m: Map<string, DriveInfo>) => setDriveMap(m), []);

  const nearbyCandidates = useMemo(() => {
    if (!data || !userLoc) return [];
    return [...data.stations].map((s) => ({ s, d: haversineKm(userLoc, { lat: s.lat, lng: s.lng }) })).sort((a, b) => a.d - b.d).slice(0, 15).map((x) => x.s);
  }, [data, userLoc]);

  const throttledCandidates = useThrottle(nearbyCandidates, DM_COOLDOWN_MS);

  const nowRanked: RankedStation[] = useMemo(() => {
    if (!userLoc || nearbyCandidates.length === 0) return [];
    return nearbyCandidates.map((s) => {
      const drive = driveMap.get(s.id);
      const distKm = drive ? drive.distanceM / 1000 : haversineKm(userLoc, { lat: s.lat, lng: s.lng }) * 1.35;
      const driveMin = drive ? Math.round(drive.durationSec / 60) : Math.round(distKm / 35 * 60);
      const price = cheapest(s.prices)?.price ?? 0;
      const eff = effectiveWithDrive(price, distKm, true, lPer100, tankL);
      const driveCostPerTank = Math.round((eff - price) * tankL) / 100;
      return { ...s, distKm, driveMin, effectivePrice: Math.round(eff * 10) / 10, driveCostPerTank, rank: 0 };
    }).sort((a, b) => a.effectivePrice - b.effectivePrice).map((s, i) => ({ ...s, rank: i + 1 })).slice(0, 10);
  }, [nearbyCandidates, driveMap, userLoc, lPer100, tankL]);

  const onTheWayRanked: RankedStation[] = useMemo(() => {
    if (routePath.length === 0 || !data || !userLoc) return [];
    const RADIUS = 3;
    const nearRoute = data.stations.filter((s) => routePath.some((p) => haversineKm(p, { lat: s.lat, lng: s.lng }) <= RADIUS));
    return nearRoute.map((s) => {
      const closestDist = Math.min(...routePath.map((p) => haversineKm(p, { lat: s.lat, lng: s.lng })));
      const detourKm = closestDist * 2 * 1.35;
      const detourMin = Math.round(detourKm / 35 * 60) + 3;
      const distKm = haversineKm(userLoc, { lat: s.lat, lng: s.lng }) * 1.35;
      const driveMin = Math.round(distKm / 35 * 60);
      const price = cheapest(s.prices)?.price ?? 0;
      const eff = effectiveWithDrive(price, detourKm, false, lPer100, tankL);
      return { ...s, distKm, driveMin, effectivePrice: Math.round(eff * 10) / 10, driveCostPerTank: 0, rank: 0, detourMin: detourMin > 1 ? detourMin : 0 };
    }).sort((a, b) => a.effectivePrice - b.effectivePrice).map((s, i) => ({ ...s, rank: i + 1 })).slice(0, 15);
  }, [routePath, data, userLoc, lPer100, tankL]);

  const ranked = mode === "now" ? nowRanked : onTheWayRanked;
  const bestId = ranked[0]?.id ?? null;

  const prevBestRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode === "now" && nowRanked.length > 0 && nowRanked[0].id !== prevBestRef.current) {
      prevBestRef.current = nowRanked[0].id; setSelected(nowRanked[0]);
    }
  }, [mode, nowRanked]);

  const visibleStations = useMemo(() => {
    if (!data || !bounds) return data?.stations ?? [];
    return data.stations.filter((s) => s.lat >= bounds.south && s.lat <= bounds.north && s.lng >= bounds.west && s.lng <= bounds.east);
  }, [data, bounds]);

  const vpStats = useMemo(() => {
    const prices = visibleStations.flatMap((s) => s.prices.map((p) => p.price));
    if (prices.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
    const min = Math.min(...prices); const max = Math.max(...prices);
    return { min, max, avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 10) / 10, count: visibleStations.length };
  }, [visibleStations]);

  const zoomedIn = visibleStations.length > 0 && visibleStations.length <= 250;
  const handleSelect = useCallback((s: Station) => { setSelected(s); setPanelOpen(false); }, []);
  const copyAddress = useCallback(async (s: Station) => { try { await navigator.clipboard.writeText(fullAddress(s)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} }, []);

  const selectedDrive = useMemo(() => {
    if (!selected || !userLoc) return null;
    const di = driveMap.get(selected.id);
    const distKm = di ? di.distanceM / 1000 : haversineKm(userLoc, { lat: selected.lat, lng: selected.lng }) * 1.35;
    const driveMin = di ? Math.round(di.durationSec / 60) : Math.round(distKm / 35 * 60);
    const price = cheapest(selected.prices)?.price ?? 0;
    const eff = effectiveWithDrive(price, distKm, true, lPer100, tankL);
    return { distKm, driveMin, effectivePrice: Math.round(eff * 10) / 10, isReal: !!di };
  }, [selected, userLoc, driveMap, lPer100, tankL]);

  const handleRouteFound = useCallback((path: LatLng[], durMin: number, destName: string) => { setRoutePath(path); setRouteDuration(durMin); setRouteDest(destName); }, []);

  return (
    <div className="h-screen-safe relative overflow-hidden">
      {MAPS_KEY ? (
        <MapErrorBoundary>
          <GoogleMapsProvider>
            <ViewportTracker onBoundsChange={onBoundsChange} />
            <AutoLocate onLocated={onLocated} onStatus={onGeoStatus} onAccuracy={onGeoAccuracy} />
            <LocateButton geoStatus={geoStatus} geoAccuracy={geoAccuracy} accuracyMeters={accuracyMeters} onLocated={onLocated} onStatus={onGeoStatus} onAccuracy={onGeoAccuracy} />
            {userLoc && <UserLocationMarker loc={userLoc} />}
            {userLoc && mode === "now" && throttledCandidates.length > 0 && <DriveTimesFetcher userLoc={userLoc} candidates={throttledCandidates} onResults={onDriveResults} />}
            {userLoc && mode === "now" && nowRanked.length > 0 && <RouteLines userLoc={userLoc} stations={nowRanked} />}
            {data && (
              <StationMarkers
                stations={mode === "ontheway" && routePath.length > 0 ? onTheWayRanked : (data.stations ?? [])}
                vpMin={vpStats.count > 0 ? vpStats.min : (data.stats?.min ?? 0)}
                vpMax={vpStats.count > 0 ? vpStats.max : (data.stats?.max ?? 999)}
                zoomedIn={zoomedIn || (mode === "ontheway" && routePath.length > 0)}
                activeFuelTypes={activeFuels} bestId={bestId} onSelect={handleSelect} bounds={bounds}
              />
            )}
            {mode === "ontheway" && userLoc && <OnTheWayPanel userLoc={userLoc} onRouteFound={handleRouteFound} onClose={() => { setRoutePath([]); setMode("now"); }} />}
            {selected && (
              <NativeInfoWindow position={{ lat: selected.lat, lng: selected.lng }} onClose={() => setSelected(null)}>
                <div className="min-w-[260px] max-w-[320px] p-0.5">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5" style={{ backgroundColor: getBrand(selected.brand).bg, color: getBrand(selected.brand).fg }}>{getBrand(selected.brand).abbr}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-zinc-900 leading-tight">{selected.name}</div>
                      {selected.brand && <div className="text-[11px] text-zinc-500">{selected.brand}</div>}
                      <div className="text-[11px] text-zinc-500 mt-0.5">{fullAddress(selected)}</div>
                    </div>
                    <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-700 p-2 -m-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close"><X size={16} /></button>
                  </div>
                  {selectedDrive && (
                    <div className="flex items-center gap-3 mb-2 px-2 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200">
                      <div className="flex items-center gap-1 text-[11px] text-zinc-700"><Car size={11} className="text-blue-500" /><span className="font-bold">{formatDist(selectedDrive.distKm)}</span></div>
                      <div className="flex items-center gap-1 text-[11px] text-zinc-700"><Timer size={10} className="text-blue-500" /><span className="font-bold">{selectedDrive.isReal ? "" : "~"}{selectedDrive.driveMin} min</span></div>
                      <div className="flex items-center gap-1 text-[11px] ml-auto"><Zap size={10} className="text-amber-600" /><span className="font-bold text-amber-700">{selectedDrive.effectivePrice.toFixed(1)}</span><span className="text-[9px] text-amber-500">eff</span></div>
                    </div>
                  )}
                  <div className="border rounded-lg border-zinc-200 overflow-hidden mb-2.5">
                    {selected.prices.map((p) => (
                      <div key={p.type} className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-100 last:border-b-0">
                        <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: FUEL_COLOR[p.type] ?? "#888" }} /><span className="text-xs font-medium text-zinc-700">{p.type}</span></div>
                        <span className="text-sm font-bold text-zinc-900 tabular-nums">{p.price.toFixed(1)} <span className="text-[10px] text-zinc-400 font-normal">c/L</span></span>
                      </div>
                    ))}
                  </div>
                  {selectedDrive && selectedDrive.distKm > 0.5 && (
                    <div className="text-[10px] text-zinc-500 mb-2 px-1">
                      Round-trip drive adds ~{((selectedDrive.effectivePrice - (cheapest(selected.prices)?.price ?? 0)) * tankL / 100).toFixed(2)} AUD to a {tankL}L fill{vehicle ? ` (${vehicle.display_name})` : ""}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <a href={directionsUrl(selected.lat, selected.lng, userLoc ?? undefined)} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold py-3 min-h-[44px] hover:bg-blue-500 active:bg-blue-700 transition-colors"><Navigation size={15} /> Directions</a>
                    <button onClick={() => copyAddress(selected)} className="flex items-center justify-center gap-1 rounded-lg border border-zinc-300 text-zinc-700 text-sm font-medium px-4 py-3 min-h-[44px] hover:bg-zinc-100 active:bg-zinc-200 transition-colors">
                      {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}{copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </NativeInfoWindow>
            )}

            {/* Header bar */}
            <div className="absolute top-0 inset-x-0 z-40 pt-safe pointer-events-none">
              <div className="flex items-center justify-between px-3 py-2 gap-2 pl-safe pr-safe">
                <div className="flex items-center bg-black/80 backdrop-fix rounded-full border border-zinc-700/50 p-0.5 shadow-xl pointer-events-auto" role="tablist" aria-label="Search mode">
                  <button role="tab" aria-selected={mode === "now"} onClick={() => { setMode("now"); setRoutePath([]); }} className={`flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-full text-[11px] font-bold transition-all active:scale-95 ${mode === "now" ? "bg-green-500/20 text-green-400" : "text-zinc-500 hover:text-zinc-300"}`}><Fuel size={11} /> Fuel Now</button>
                  <button role="tab" aria-selected={mode === "ontheway"} onClick={() => setMode("ontheway")} className={`flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-full text-[11px] font-bold transition-all active:scale-95 ${mode === "ontheway" ? "bg-blue-500/20 text-blue-400" : "text-zinc-500 hover:text-zinc-300"}`}><Route size={11} /> On the Way</button>
                </div>
                <div className="flex items-center gap-2 pointer-events-auto">
                  <div className="relative" onKeyDown={(e) => { if (e.key === "Escape" && fuelDropOpen) { setFuelDropOpen(false); e.stopPropagation(); } }}>
                    <button onClick={() => setFuelDropOpen((p) => !p)} aria-expanded={fuelDropOpen} aria-haspopup="true" aria-label={`Fuel types: ${Array.from(activeFuels).join(", ")}`} className="flex items-center gap-1.5 rounded-full bg-black/80 backdrop-fix border border-zinc-700/50 px-2.5 py-2 shadow-xl text-[11px] font-bold text-white hover:border-zinc-600 transition-colors">
                      <div className="flex -space-x-1">{Array.from(activeFuels).slice(0, 3).map((t) => (<div key={t} className="w-2.5 h-2.5 rounded-full border border-black/60" style={{ backgroundColor: FUEL_COLOR[t] ?? "#888" }} />))}</div>
                      <span className="max-w-[80px] truncate hidden sm:inline">{Array.from(activeFuels).join(", ")}</span>
                      <ChevronDown size={10} className={`text-zinc-500 transition-transform ${fuelDropOpen ? "rotate-180" : ""}`} />
                    </button>
                    {fuelDropOpen && (
                      <div role="menu" aria-label="Fuel types" className="absolute top-full mt-1.5 right-0 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/60 rounded-2xl shadow-2xl p-2 min-w-[180px] z-50">
                        {FUEL_TYPES.map((ft) => {
                          const active = activeFuels.has(ft.value);
                          return (
                            <button key={ft.value} role="menuitemcheckbox" aria-checked={active} onClick={() => toggleFuel(ft.value)} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[12px] font-semibold transition-colors hover:bg-zinc-800/60">
                              <div className="w-3 h-3 rounded-full shrink-0 border-2 transition-colors" style={{ backgroundColor: active ? ft.color : "transparent", borderColor: active ? ft.color : "#52525b" }} />
                              <span style={{ color: active ? ft.color : "#a1a1aa" }}>{ft.label}</span>
                              {active && <Check size={12} className="ml-auto" style={{ color: ft.color }} />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {vehicle && (
                    <div className="flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/60 px-2.5 py-1.5 shadow-xl cursor-pointer hover:border-amber-400 transition-colors" onClick={() => setVehicleOpen(true)}>
                      <Car size={12} className="text-amber-400 shrink-0" />
                      <span className="text-[11px] font-bold text-amber-300 max-w-[80px] truncate hidden sm:inline">{vehicle.display_name}</span>
                      <button onClick={(e) => { e.stopPropagation(); clearVehicle(); }} className="text-amber-500/60 hover:text-amber-300 p-0.5 -mr-0.5" aria-label="Remove vehicle"><X size={10} /></button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {fuelDropOpen && <div className="absolute inset-0 z-20" onClick={() => setFuelDropOpen(false)} />}

            {/* Results panel */}
            <div className={`absolute z-30 pointer-events-none transition-all duration-300 ease-in-out bottom-0 inset-x-0 lg:top-[64px] lg:left-3 lg:right-auto lg:bottom-auto lg:w-[360px]`}>
              <div className={`pointer-events-auto bg-black/85 backdrop-fix border-t lg:border border-zinc-700/50 lg:rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ${panelOpen ? "max-h-[60vh] lg:max-h-[calc(100vh-140px)]" : "max-h-[140px] lg:max-h-[calc(100vh-140px)]"}`}>
                <div className="lg:hidden flex justify-center py-3 shrink-0 cursor-grab active:cursor-grabbing touch-none" onClick={() => setPanelOpen(!panelOpen)}
                  onTouchStart={(e) => { panelTouchRef.current = { startY: e.touches[0].clientY, startOpen: panelOpen }; }}
                  onTouchMove={(e) => { if (!panelTouchRef.current) return; const dy = e.touches[0].clientY - panelTouchRef.current.startY; if (panelTouchRef.current.startOpen && dy > 40) { setPanelOpen(false); panelTouchRef.current = null; } else if (!panelTouchRef.current.startOpen && dy < -40) { setPanelOpen(true); panelTouchRef.current = null; } }}
                  onTouchEnd={() => { panelTouchRef.current = null; }} role="button" aria-label={panelOpen ? "Swipe down to collapse" : "Swipe up to expand"}>
                  <div className="w-10 h-1.5 rounded-full bg-zinc-500" />
                </div>
                <div className="px-3 py-2 shrink-0 flex items-center justify-between touch-none"
                  onTouchStart={(e) => { panelTouchRef.current = { startY: e.touches[0].clientY, startOpen: panelOpen }; }}
                  onTouchMove={(e) => { if (!panelTouchRef.current) return; const dy = e.touches[0].clientY - panelTouchRef.current.startY; if (panelTouchRef.current.startOpen && dy > 40) { setPanelOpen(false); panelTouchRef.current = null; } else if (!panelTouchRef.current.startOpen && dy < -40) { setPanelOpen(true); panelTouchRef.current = null; } }}
                  onTouchEnd={() => { panelTouchRef.current = null; }}>
                  {mode === "now" ? (
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-white flex items-center gap-1.5"><Fuel size={13} className="text-green-400" /> Best Value Near You</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {geoStatus === "denied" ? <span className="text-amber-400">Location denied &mdash; enable in browser settings</span> : geoStatus === "unavailable" ? <span className="text-amber-400">Location unavailable</span> : userLoc ? <>Ranked by <span className="text-zinc-300 font-medium">true cost</span> = pump + drive</> : "Locating you..."}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-white flex items-center gap-1.5"><Route size={13} className="text-blue-400" /> Fuel On The Way</div>
                      {routePath.length > 0 ? <div className="text-[10px] text-zinc-500 mt-0.5"><span className="text-blue-400 font-medium">{routeDest}</span> &middot; {routeDuration} min &middot; {onTheWayRanked.length} stations</div> : <div className="text-[10px] text-zinc-500 mt-0.5">Enter destination to find fuel on route</div>}
                    </div>
                  )}
                  {ranked.length > 0 && !panelOpen && <button onClick={() => setPanelOpen(true)} className="lg:hidden text-[10px] text-green-400 font-bold px-2 py-1 active:scale-95">{ranked.length} stations &#x25b8;</button>}
                </div>

                {ranked.length > 0 && ranked[0] && (
                  <div className={`mx-2 mb-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors shrink-0 ${mode === "now" ? "bg-green-500/10 border-green-500/20 hover:bg-green-500/15" : "bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/15"}`} onClick={() => setSelected(ranked[0])}>
                    <div className="flex items-center gap-1 mb-1">
                      <Trophy size={10} className={mode === "now" ? "text-green-400" : "text-blue-400"} />
                      <span className={`text-[9px] font-black uppercase tracking-widest ${mode === "now" ? "text-green-400" : "text-blue-400"}`}>Best Value</span>
                      {driveMap.size > 0 && <span className="text-[8px] text-green-700 ml-auto">&#x25cf; Live drive times</span>}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">{ranked[0].name}</div>
                        <div className="text-[10px] text-zinc-500 flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-0.5"><Timer size={9} /> {ranked[0].driveMin} min</span>
                          <span>{formatDist(ranked[0].distKm)}</span>
                          {ranked[0].detourMin != null && ranked[0].detourMin > 0 && <span className="text-amber-500">+{ranked[0].detourMin}m</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0 pl-3">
                        <div className="space-y-0.5">{ranked[0].prices.map((p) => (<div key={p.type} className="flex items-center justify-end gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: FUEL_COLOR[p.type] ?? "#888" }} /><span className={`text-lg font-black tabular-nums ${mode === "now" ? "text-green-400" : "text-blue-400"}`}>{p.price.toFixed(1)}</span></div>))}</div>
                        <div className="text-[9px] text-zinc-500 flex items-center gap-0.5 justify-end mt-0.5"><Zap size={7} className="text-amber-500" /> {ranked[0].effectivePrice.toFixed(1)} eff</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className={`flex-1 overflow-y-auto scroll-touch px-1 py-1 ${panelOpen ? "" : "hidden lg:block"}`}>
                  {loading ? <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" /></div>
                   : fetchError ? <div className="text-center py-6 px-4"><WifiOff size={20} className="text-red-500 mx-auto mb-2" /><p className="text-xs text-red-400 mb-2">{fetchError}</p><button onClick={fetchData} className="text-xs text-green-400 hover:text-green-300 font-medium">Try Again</button></div>
                   : ranked.length > 1 ? <RankedList stations={ranked.slice(1)} onSelect={handleSelect} />
                   : mode === "ontheway" && routePath.length === 0 ? <div className="text-center py-6 px-4"><MapPin size={20} className="text-zinc-700 mx-auto mb-2" /><p className="text-[11px] text-zinc-500">Use the route planner on the map</p></div>
                   : ranked.length === 0 ? <div className="text-center py-6 px-4"><LocateFixed size={20} className="text-zinc-700 mx-auto mb-2" /><p className="text-[11px] text-zinc-500">{!userLoc ? "Allow location access" : "No stations found"}</p></div>
                   : null}
                  {!vehicle && ranked.length > 0 && (
                    <button onClick={() => setVehicleOpen(true)} className="mx-2 my-2 flex items-center gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 hover:bg-amber-500/15 transition-colors text-left">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0"><Car size={16} className="text-amber-400" /></div>
                      <div className="min-w-0"><div className="text-[11px] font-bold text-amber-300">Tell us your car</div><div className="text-[10px] text-zinc-500">Get an equivalent price per litre based on your car&apos;s range</div></div>
                      <ArrowRight size={14} className="text-amber-500/60 shrink-0" />
                    </button>
                  )}
                </div>
                <div className="shrink-0 pb-safe" />
              </div>
            </div>

            {/* Map legend */}
            <div className="absolute bottom-[148px] lg:bottom-3 left-3 z-20 rounded-lg bg-black/75 backdrop-fix border border-zinc-700/40 px-2.5 py-1.5 flex items-center gap-3 text-[10px] text-zinc-400 pointer-events-none">
              {mode === "now" && nowRanked.length > 0 ? (
                <><span className="flex items-center gap-1"><span className="w-5 h-1 rounded-full bg-green-500" /> Best</span><span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded-full bg-blue-500" /> #2</span><span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded-full bg-zinc-500" /> #3</span></>
              ) : (
                <><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Cheap</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Mid</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Exp</span></>
              )}
            </div>

            {/* Attribution */}
            <div className="absolute bottom-[148px] lg:bottom-3 right-3 z-20 flex flex-col items-end gap-1 pointer-events-auto">
              <a href="https://pact.tailor.au" className="flex items-center gap-1.5 rounded-lg bg-black/80 backdrop-fix border border-zinc-700/40 px-2.5 py-1.5 hover:border-green-500/40 transition-colors group shadow-lg">
                <span className="text-[10px] text-zinc-400 group-hover:text-zinc-300">Powered by</span>
                <span className="text-[11px] font-black text-white group-hover:text-green-400 transition-colors tracking-[0.14em]">PACT</span>
              </a>
              <div className="flex items-center gap-2">
                <button onClick={() => setAttribOpen(true)} className="text-[9px] text-zinc-600 hover:text-zinc-400 underline underline-offset-2">Data Sources</button>
                <DataFreshnessStatus loading={loading} elapsed={elapsed} stale={stale} />
              </div>
            </div>

            {attribOpen && (
              <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={() => setAttribOpen(false)}>
                <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[400px] max-w-[90vw] max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-bold text-sm">Data Sources &amp; Attribution</h3>
                    <button onClick={() => setAttribOpen(false)} className="text-zinc-500 hover:text-white p-1"><X size={16} /></button>
                  </div>
                  <div className="space-y-3 text-[11px] text-zinc-400 leading-relaxed">
                    <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700/50"><div className="text-white font-semibold text-[12px] mb-1">Queensland Government Fuel Prices</div><p>Based on or contains data provided by the State of Queensland (Department of Energy and Climate) 2025. In consideration of the State permitting use of this data you acknowledge and agree that the State gives no warranty in relation to the data (including accuracy, reliability, completeness, currency or suitability) and accepts no liability (including without limitation, liability in negligence) for any loss, damage or costs (including consequential damage) relating to any use of the data. Data must not be used for direct marketing or be used in breach of the privacy laws.</p></div>
                    <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700/50"><div className="text-white font-semibold text-[12px] mb-1">NSW FuelCheck</div><p>Fuel price data for NSW and TAS sourced from the NSW Government FuelCheck service.</p></div>
                    <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700/50"><div className="text-white font-semibold text-[12px] mb-1">FuelWatch WA</div><p>Western Australian fuel price data sourced from the WA Government FuelWatch service.</p></div>
                    <div className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700/50"><div className="text-white font-semibold text-[12px] mb-1">PetrolSpy</div><p>Community-reported fuel prices used to supplement official government data sources.</p></div>
                    <p className="text-zinc-500 text-[10px] pt-2 border-t border-zinc-800">PACT aggregates data from multiple sources. Prices shown are indicative and may not reflect the current price at the bowser. Always confirm pricing at the station.</p>
                  </div>
                </div>
              </div>
            )}

            {vehicleOpen && (
              <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={() => setVehicleOpen(false)}>
                <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[340px] max-w-[90vw] p-5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4"><h3 className="text-white font-bold text-sm">My Vehicle</h3><button onClick={() => setVehicleOpen(false)} className="text-zinc-500 hover:text-white p-1"><X size={16} /></button></div>
                  <p className="text-zinc-400 text-[11px] mb-3 leading-relaxed">Tell us what you drive and we&apos;ll personalise the effective fuel cost based on your car&apos;s actual consumption and tank size.</p>
                  {vehicle && (
                    <div className="mb-4">
                      <div className="flex items-center gap-3 bg-zinc-800 rounded-xl p-3 border border-zinc-700">
                        <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0"><Car size={18} className="text-amber-400" /></div>
                        <div className="flex-1 min-w-0"><div className="text-white text-sm font-bold truncate">{vehicle.display_name}</div><div className="text-zinc-400 text-[11px]">{vehicle.consumption_l_per_100km}L/100km &middot; {vehicle.tank_litres}L tank &middot; {vehicle.fuel_type}</div></div>
                      </div>
                      <button onClick={clearVehicle} className="mt-2 text-[11px] text-red-400 hover:text-red-300 font-medium">Remove vehicle</button>
                    </div>
                  )}
                  <form onSubmit={(e) => { e.preventDefault(); resolveVehicle(vehicleInput); }} className="flex gap-2">
                    <input type="text" value={vehicleInput} onChange={(e) => setVehicleInput(e.target.value)} placeholder="e.g. LC300, Prius, Hilux, Model 3..." className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500" disabled={vehicleLoading} autoFocus />
                    <button type="submit" disabled={vehicleLoading || !vehicleInput.trim()} className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black font-bold text-sm px-4 py-2.5 rounded-lg transition-colors min-w-[60px]">{vehicleLoading ? "..." : "Set"}</button>
                  </form>
                  {vehicle?.confidence === "low" && <p className="text-amber-500 text-[10px] mt-2">Low confidence match &mdash; consider being more specific (year, model variant)</p>}
                </div>
              </div>
            )}

            <StaleBanner stale={stale} loading={loading} elapsed={elapsed} onRefresh={fetchData} />
          </GoogleMapsProvider>
        </MapErrorBoundary>
      ) : (
        <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
          <div className="text-center px-6">
            <Globe size={48} className="text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500 text-sm">Set <code className="text-green-400 text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code></p>
          </div>
        </div>
      )}
    </div>
  );
}
