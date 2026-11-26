import { feature, mesh } from 'topojson-client';
import type { Topology } from 'topojson-specification';

export interface Country { name: string; id: string; lat: number; lon: number; rings: number[][][] }
let p: Promise<{ countries: Country[]; borders: number[][][] }> | null = null;

/** Natural Earth 1:50m countries via world-atlas (public domain). Lazily imported. */
export function loadWorld() {
  return (p ??= import('world-atlas/countries-50m.json').then((m) => {
    const topo = (m as any).default as Topology;
    const fc = feature(topo, topo.objects.countries as any) as any;
    const countries: Country[] = fc.features.map((f: any) => {
      const polys: number[][][][] = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.coordinates ?? [];
      const rings = polys.map((poly) => poly[0]);
      // label point: bbox centre of the largest outer ring
      let best = rings[0] ?? [[0, 0]], bestN = 0;
      for (const r of rings) if (r.length > bestN) { best = r; bestN = r.length; }
      const lons = best.map((c) => c[0]), lats = best.map((c) => c[1]);
      return { name: f.properties?.name ?? '', id: String(f.id), rings: polys.flat(), lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
    });
    const borders = (mesh(topo, topo.objects.countries as any) as any).coordinates as number[][][];
    return { countries, borders };
  }));
}

/** Country name at a point (ray-casting point-in-polygon over Natural Earth outlines). Label use only. */
export async function countryAt(lat: number, lon: number): Promise<string | null> {
  const { countries } = await loadWorld();
  for (const c of countries) for (const ring of c.rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return c.name;
  }
  return null;
}
