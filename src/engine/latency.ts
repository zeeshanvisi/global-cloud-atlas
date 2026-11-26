// Latency ESTIMATES. Nothing here is a measurement.
// Model: light in fibre ≈ 200 km/ms one way; real routes are ~1.5× the great-circle path; +2 ms for
// last-mile/processing. RTT ≈ 2 + 1.5 × 2 × d / 200 = 2 + d / 66.7 ms. Kept deliberately simple and labelled.
import { haversineKm } from './geo';

export const LATENCY_METHOD = 'Estimate: 2 ms + great-circle distance × 1.5 route factor at 200 km/ms in fibre (round trip). Not measured.';
export const estRttMs = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => 2 + haversineKm(a, b) / 66.7;
/** Inverse: distance (km) at which the estimate reaches a given RTT — used to draw latency rings. */
export const kmForRtt = (ms: number) => Math.max(0, (ms - 2) * 66.7);
export const LATENCY_RINGS = [20, 50, 100, 150];
