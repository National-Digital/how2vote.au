/**
 * Electoral boundary maps for the ballot confirmation screen.
 *
 * Turns the AEC's national division shapefile (GDA94, ~69 MB) into eight small per-state JSON
 * files of pre-projected SVG path strings, so the web app renders monochrome maps with zero
 * runtime geo dependencies. Heavy lifting (projection, simplification) happens here at build
 * time via mapshaper; the output is committed like data/dist.
 *
 * Remote external territories (Christmas, Cocos, Norfolk, Lord Howe, Macquarie islands) are
 * cartographically part of mainland divisions but sit thousands of km off the state frame, so
 * they are dropped before the frame is computed — standard practice on printed electoral maps.
 */

export type CityMarker = { name: string; x: number; y: number };
export type DivisionShape = {
  name: string;
  /** SVG path in viewBox units, all polygon parts concatenated. */
  path: string;
  /** [x, y, width, height] in viewBox units — drives the client-side zoom panel. */
  bbox: [number, number, number, number];
};
export type StateMap = {
  state: string;
  attribution: string;
  /** [width, height]; x/y origin is always 0 0. */
  viewBox: [number, number];
  divisions: DivisionShape[];
  cities: CityMarker[];
};

// The AEC boundary geometry is licensed under the AEC Spatial Data Download Data Licence (see
// data/aec-spatial/source-record.json), NOT CC BY 4.0. This short credit carries no copyright year:
// the year belongs only in the prescribed derivative-product notice, taken from the accepted licence
// wording (currently 2026) rather than the boundary/election year.
export const MAP_ATTRIBUTION =
  "Boundaries © Commonwealth of Australia (Australian Electoral Commission)";

/** Width of every state's viewBox; height follows the state's aspect ratio. */
export const VIEW_WIDTH = 1000;

/**
 * Cities and town centres shown as bearings on a map most voters rarely look at. Coordinates
 * are GDA94 lon/lat; they ride through the same projection as the boundaries. The ACT gets its
 * town centres because the whole territory is one city.
 */
export const CITY_GAZETTEER: { state: string; name: string; lon: number; lat: number }[] = [
  { state: "NSW", name: "Sydney", lon: 151.2093, lat: -33.8688 },
  { state: "NSW", name: "Newcastle", lon: 151.7817, lat: -32.9283 },
  { state: "NSW", name: "Wollongong", lon: 150.8931, lat: -34.4278 },
  { state: "NSW", name: "Coffs Harbour", lon: 153.1094, lat: -30.2963 },
  { state: "NSW", name: "Dubbo", lon: 148.6011, lat: -32.2569 },
  { state: "NSW", name: "Wagga Wagga", lon: 147.3598, lat: -35.1082 },
  { state: "NSW", name: "Broken Hill", lon: 141.467, lat: -31.953 },
  { state: "VIC", name: "Melbourne", lon: 144.9631, lat: -37.8136 },
  { state: "VIC", name: "Geelong", lon: 144.3603, lat: -38.1499 },
  { state: "VIC", name: "Ballarat", lon: 143.8503, lat: -37.5622 },
  { state: "VIC", name: "Bendigo", lon: 144.2794, lat: -36.757 },
  { state: "VIC", name: "Mildura", lon: 142.1367, lat: -34.208 },
  { state: "VIC", name: "Traralgon", lon: 146.5403, lat: -38.1954 },
  { state: "QLD", name: "Brisbane", lon: 153.0251, lat: -27.4698 },
  { state: "QLD", name: "Gold Coast", lon: 153.4, lat: -28.0167 },
  { state: "QLD", name: "Toowoomba", lon: 151.9507, lat: -27.5606 },
  { state: "QLD", name: "Rockhampton", lon: 150.5089, lat: -23.3783 },
  { state: "QLD", name: "Townsville", lon: 146.8169, lat: -19.259 },
  { state: "QLD", name: "Cairns", lon: 145.771, lat: -16.9186 },
  { state: "QLD", name: "Mount Isa", lon: 139.4927, lat: -20.7256 },
  { state: "WA", name: "Perth", lon: 115.8605, lat: -31.9505 },
  { state: "WA", name: "Bunbury", lon: 115.6414, lat: -33.3271 },
  { state: "WA", name: "Albany", lon: 117.8837, lat: -35.0269 },
  { state: "WA", name: "Geraldton", lon: 114.6144, lat: -28.7742 },
  { state: "WA", name: "Kalgoorlie", lon: 121.4656, lat: -30.749 },
  { state: "WA", name: "Broome", lon: 122.237, lat: -17.9614 },
  { state: "WA", name: "Port Hedland", lon: 118.6011, lat: -20.3104 },
  { state: "SA", name: "Adelaide", lon: 138.6007, lat: -34.9285 },
  { state: "SA", name: "Mount Gambier", lon: 140.7807, lat: -37.8284 },
  { state: "SA", name: "Port Augusta", lon: 137.7648, lat: -32.4936 },
  { state: "SA", name: "Port Lincoln", lon: 135.8613, lat: -34.7282 },
  { state: "SA", name: "Coober Pedy", lon: 134.7544, lat: -29.0135 },
  { state: "TAS", name: "Hobart", lon: 147.3272, lat: -42.8821 },
  { state: "TAS", name: "Launceston", lon: 147.1441, lat: -41.4332 },
  { state: "TAS", name: "Devonport", lon: 146.3503, lat: -41.1801 },
  { state: "TAS", name: "Burnie", lon: 145.9037, lat: -41.0558 },
  { state: "ACT", name: "Civic", lon: 149.13, lat: -35.2809 },
  { state: "ACT", name: "Belconnen", lon: 149.0672, lat: -35.238 },
  { state: "ACT", name: "Gungahlin", lon: 149.133, lat: -35.185 },
  { state: "ACT", name: "Woden", lon: 149.085, lat: -35.3448 },
  { state: "ACT", name: "Tuggeranong", lon: 149.0888, lat: -35.4244 },
  { state: "NT", name: "Darwin", lon: 130.8456, lat: -12.4634 },
  { state: "NT", name: "Katherine", lon: 132.2635, lat: -14.4652 },
  { state: "NT", name: "Tennant Creek", lon: 134.19, lat: -19.6497 },
  { state: "NT", name: "Alice Springs", lon: 133.8807, lat: -23.698 },
];

/**
 * Division names as printed differ from the shapefile only in punctuation/diacritic edge cases
 * (O'Connor, Eden-Monaro), so matching is done on a folded key rather than a lookup table.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();
}

type Ring = [number, number][];
export type ProjectedFeature = { name: string; polygons: Ring[][] };

const round2 = (v: number): number => Math.round(v * 100) / 100;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function ringBox(ring: Ring): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

const boxArea = (b: Box): number => (b.maxX - b.minX) * (b.maxY - b.minY);

/** Distance from a box's centre to the nearest point of another box (0 if inside). */
function boxDistance(b: Box, core: Box): number {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const dx = Math.max(core.minX - cx, 0, cx - core.maxX);
  const dy = Math.max(core.minY - cy, 0, cy - core.maxY);
  return Math.hypot(dx, dy);
}

/**
 * Drops small polygon parts lying far outside a state's core frame — concretely Jervis Bay
 * Territory, which is legally in the ACT's divisions but sits 120 km east on the NSW coast
 * and would squash Canberra into a corner of the frame. Sized/positioned so genuine outlying
 * islands (King Island, Groote Eylandt, Kangaroo Island) survive: a part is dropped only if
 * it is small relative to the state AND farther out than 60% of the core's extent — the
 * distance test is the discriminator (near islands pass it however small they are).
 */
export function dropOutlierParts(features: ProjectedFeature[]): ProjectedFeature[] {
  let core: Box | null = null;
  for (const f of features)
    for (const poly of f.polygons) {
      const outer = poly[0];
      if (!outer) continue;
      const b = ringBox(outer);
      if (!core || boxArea(b) > boxArea(core)) core = b;
    }
  if (!core) return features;
  const coreBox = core;
  const extent = Math.max(coreBox.maxX - coreBox.minX, coreBox.maxY - coreBox.minY);

  return features.map((f) => ({
    name: f.name,
    polygons: f.polygons.filter((poly) => {
      const outer = poly[0];
      if (!outer) return false;
      const b = ringBox(outer);
      const small = boxArea(b) < 0.1 * boxArea(coreBox);
      return !(small && boxDistance(b, coreBox) > 0.6 * extent);
    }),
  }));
}

/**
 * Converts one state's projected features (and city points in the same projected space) into
 * viewBox-space SVG paths. Projected y grows north; SVG y grows down, so y is flipped while
 * scaling into a VIEW_WIDTH-wide frame. Cities outside the frame are dropped.
 */
export function buildStateGeometry(
  features: ProjectedFeature[],
  cityPoints: { name: string; x: number; y: number }[] = [],
): { viewBox: [number, number]; divisions: DivisionShape[]; cities: CityMarker[] } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const f of features)
    for (const poly of f.polygons)
      for (const ring of poly)
        for (const [x, y] of ring) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
  const scale = VIEW_WIDTH / (maxX - minX);
  const height = round2((maxY - minY) * scale);
  const tx = (x: number): number => round2((x - minX) * scale);
  const ty = (y: number): number => round2((maxY - y) * scale);

  const divisions = features.map((f) => {
    let bMinX = Infinity,
      bMinY = Infinity,
      bMaxX = -Infinity,
      bMaxY = -Infinity;
    const parts: string[] = [];
    for (const poly of f.polygons)
      for (const ring of poly) {
        const pts = ring.map(([x, y]) => {
          const px = tx(x),
            py = ty(y);
          if (px < bMinX) bMinX = px;
          if (px > bMaxX) bMaxX = px;
          if (py < bMinY) bMinY = py;
          if (py > bMaxY) bMaxY = py;
          return `${px} ${py}`;
        });
        // Drop the GeoJSON closing point; Z closes the ring.
        parts.push(`M${pts.slice(0, -1).join("L")}Z`);
      }
    return {
      name: f.name,
      path: parts.join(""),
      bbox: [bMinX, bMinY, round2(bMaxX - bMinX), round2(bMaxY - bMinY)] as [
        number,
        number,
        number,
        number,
      ],
    };
  });

  const cities = cityPoints
    .map((c) => ({ name: c.name, x: tx(c.x), y: ty(c.y) }))
    .filter((c) => c.x >= 0 && c.x <= VIEW_WIDTH && c.y >= 0 && c.y <= height);

  return { viewBox: [VIEW_WIDTH, height], divisions, cities };
}
