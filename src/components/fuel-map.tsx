"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";

export type FuelStationMarker = {
  stationId: string;
  stationName: string;
  brandName: string | null;
  priceCpl: number;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  suburb: string | null;
  state: string;
  fuelType: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Map price to colour between green (cheap) and red (expensive) using min/max spread. */
function priceColor(price: number, min: number, max: number): string {
  if (!Number.isFinite(price)) return "#94a3b8";
  if (max <= min) return "#22c55e";
  const t = Math.min(1, Math.max(0, (price - min) / (max - min)));
  const r = Math.round(34 + t * (239 - 34));
  const g = Math.round(197 + t * (68 - 197));
  const b = Math.round(94 + t * (68 - 94));
  return `rgb(${r},${g},${b})`;
}

export default function FuelMap({ stations }: { stations: FuelStationMarker[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current).setView([-25.7, 134.5], 4);
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    const withCoords = stations.filter(
      (s): s is FuelStationMarker & { latitude: number; longitude: number } =>
        s.latitude != null &&
        s.longitude != null &&
        Number.isFinite(s.latitude) &&
        Number.isFinite(s.longitude)
    );

    if (withCoords.length === 0) {
      map.setView([-25.7, 134.5], 4);
      return;
    }

    const prices = withCoords.map((s) => Number(s.priceCpl));
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    for (const s of withCoords) {
      const color = priceColor(Number(s.priceCpl), min, max);
      const circle = L.circleMarker([s.latitude, s.longitude], {
        radius: 8,
        color: "#020617",
        weight: 1,
        fillColor: color,
        fillOpacity: 0.9,
      });

      const addr = [s.address, s.suburb, s.state].filter(Boolean).join(", ");
      const brand = s.brandName ? `${escapeHtml(s.brandName)} · ` : "";
      circle.bindPopup(
        `<div class="leaflet-popup-fuel text-gray-900 text-sm font-sans leading-snug min-w-[200px]">
          <div class="font-semibold">${escapeHtml(s.stationName)}</div>
          <div class="text-gray-600 mt-0.5">${brand}${escapeHtml(s.fuelType)}</div>
          <div class="text-base font-bold mt-1">${Number(s.priceCpl).toFixed(1)} c/L</div>
          ${addr ? `<div class="text-gray-600 mt-1 text-xs">${escapeHtml(addr)}</div>` : ""}
        </div>`
      );
      circle.addTo(layer);
    }

    const bounds = L.latLngBounds(
      withCoords.map((s) => [s.latitude, s.longitude] as [number, number])
    );
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 11 });
  }, [stations]);

  return (
    <div
      ref={containerRef}
      className="h-[min(70vh,560px)] w-full min-h-[320px] rounded-xl border border-gray-800 bg-gray-900/50"
    />
  );
}
