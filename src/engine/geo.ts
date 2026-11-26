import * as THREE from 'three';
import type { Region } from '../domain/types';

export const R_EARTH = 1;
export function latLonToVec3(lat: number, lon: number, r = R_EARTH): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180), theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toR = Math.PI / 180, dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export interface Cluster { id: string; lat: number; lon: number; members: Region[] }
/** Greedy spatial clustering — O(n·k), fine for hundreds of regions; radius in km. */
export function cluster(regions: Region[], radiusKm: number): Cluster[] {
  const out: Cluster[] = [];
  for (const r of [...regions].sort((a, b) => a.key.localeCompare(b.key))) {
    const c = out.find((c) => haversineKm(c, r) < radiusKm);
    if (c) { c.members.push(r); const n = c.members.length; c.lat += (r.lat - c.lat) / n; c.lon += (r.lon - c.lon) / n; }
    else out.push({ id: r.key, lat: r.lat, lon: r.lon, members: [r] });
  }
  return out;
}

/** A "market" groups regions of different providers that serve the same metro (≤ 400 km apart). */
export interface Market { id: string; name: string; lat: number; lon: number; regions: Region[] }
export function buildMarkets(regions: Region[]): Market[] {
  return cluster(regions, 400).map((c) => {
    const names = [...new Set(c.members.map((m) => m.city))];
    return { id: c.id, name: names.slice(0, 2).join(' / '), lat: c.lat, lon: c.lon, regions: c.members };
  });
}

/**
 * Display-only de-overlap: regions within 30 km of each other (e.g. AWS + GCP Mumbai share the
 * same published metro) are fanned out on a small ring so each marker stays clickable.
 * Source coordinates (lat/lon) are never modified.
 */
export function withDisplayPositions(regions: Region[]): Region[] {
  const groups = cluster(regions, 30);
  const out = new Map<string, Region>();
  for (const g of groups) {
    g.members.forEach((r, i) => {
      if (g.members.length === 1) { out.set(r.key, { ...r, dlat: r.lat, dlon: r.lon }); return; }
      const a = (i / g.members.length) * Math.PI * 2 + 0.6, rad = 0.32;
      out.set(r.key, { ...r, dlat: r.lat + Math.sin(a) * rad, dlon: r.lon + (Math.cos(a) * rad) / Math.max(Math.cos((r.lat * Math.PI) / 180), 0.2) });
    });
  }
  return regions.map((r) => out.get(r.key)!);
}
