import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mapshaper from "mapshaper";
import {
  buildStateGeometry,
  CITY_GAZETTEER,
  dropOutlierParts,
  MAP_ATTRIBUTION,
  nameKey,
  type ProjectedFeature,
  type StateMap,
} from "../maps.js";
import { DATA_DIR, REPO_ROOT, readJson, writeJson } from "../paths.js";

/**
 * Builds the per-state electorate maps for the ballot confirmation screen from the AEC's
 * national boundary shapefile. The shapefile is a raw upstream fetch (git-ignored); the
 * eight small JSON outputs are committed under apps/web/static/maps/ so the app stays
 * fully offline. Deterministic: output depends only on the shapefile + gazetteer.
 *
 * Source: https://www.aec.gov.au/Electorates/gis/gis_datadownload.htm
 *   → "2025 federal electoral boundaries — national" (AUS-March-2025-esri.zip)
 */

/**
 * Boundary vintage. Historical elections (2019/2022) were fought on different boundaries; each
 * needs its own AEC boundary set under data/raw/boundaries/aus-<id>/ and output directory before
 * the app will show maps for it — until then those elections confirm without a map.
 */
const ELECTION = "2025";

const SHP_DIR = resolve(DATA_DIR, `raw/boundaries/aus-${ELECTION}`);
const OUT_DIR = resolve(REPO_ROOT, `apps/web/static/maps/${ELECTION}`);

/** GDA94 → Australian Albers (EPSG:3577) — equal-area, the standard continental projection. */
const ALBERS = "+proj=aea +lat_1=-18 +lat_2=-36 +lat_0=0 +lon_0=134 +ellps=GRS80";

/**
 * Mainland window in degrees. Rings whose centroid falls outside are remote external
 * territories (Christmas, Cocos, Norfolk, Lord Howe, Macquarie) that belong to mainland
 * divisions but would stretch their state's frame by thousands of km.
 */
const MAINLAND = "cx > 112 && cx < 155 && cy > -44.5";

/**
 * Per-division simplification interval in metres, from the shapefile's Area_SqKm field:
 * outback giants get coarse geometry, inner-metro divisions keep the detail the zoom
 * panel needs. Clamped so nothing degenerates or bloats.
 */
const INTERVAL = "Math.min(5000, Math.max(60, Math.sqrt(Area_SqKm * 1e6) / 140))";

type Dataset = { ballots: { electorates: { state: string; electorate: string }[] } };

async function main(): Promise<void> {
  const dataset = await readJson<Dataset>(resolve(DATA_DIR, `dist/${ELECTION}/dataset.json`));
  const stateByKey = new Map<string, { state: string; electorate: string }>();
  for (const e of dataset.ballots.electorates) stateByKey.set(nameKey(e.electorate), e);

  const inputs: Record<string, Buffer> = {};
  for (const ext of ["shp", "shx", "dbf", "prj"])
    inputs[`in.${ext}`] = await readFile(resolve(SHP_DIR, `AUS_ELB_region.${ext}`));

  const out = await mapshaper.applyCommands(
    [
      "-i in.shp",
      "-explode",
      "-each 'cx=this.centroidX, cy=this.centroidY'",
      `-filter '${MAINLAND}'`,
      "-dissolve 'Elect_div' copy-fields='Area_SqKm'",
      `-proj ${ALBERS}`,
      `-simplify variable interval='${INTERVAL}' keep-shapes`,
      "-filter-fields Elect_div",
      "-o out.geojson format=geojson",
    ].join(" "),
    inputs,
  );
  const divisionsOut = out["out.geojson"];
  if (!divisionsOut) throw new Error("mapshaper produced no division output");
  const divisionsGeo = JSON.parse(divisionsOut.toString()) as {
    features: {
      properties: { Elect_div: string };
      geometry: { type: string; coordinates: unknown };
    }[];
  };

  const citiesGeojson = {
    type: "FeatureCollection",
    features: CITY_GAZETTEER.map((c) => ({
      type: "Feature",
      properties: { name: c.name, state: c.state },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
  const cityOut = await mapshaper.applyCommands(
    `-i cities.json -proj ${ALBERS} -o out.json format=geojson`,
    { "cities.json": JSON.stringify(citiesGeojson) },
  );
  const citiesOut = cityOut["out.json"];
  if (!citiesOut) throw new Error("mapshaper produced no city output");
  const citiesGeo = JSON.parse(citiesOut.toString()) as {
    features: {
      properties: { name: string; state: string };
      geometry: { coordinates: [number, number] };
    }[];
  };
  const citiesByState = new Map<string, { name: string; x: number; y: number }[]>();
  for (const f of citiesGeo.features) {
    const list = citiesByState.get(f.properties.state) ?? [];
    list.push({
      name: f.properties.name,
      x: f.geometry.coordinates[0],
      y: f.geometry.coordinates[1],
    });
    citiesByState.set(f.properties.state, list);
  }

  // Group projected divisions by state via the dataset (the shapefile has no state field),
  // failing loudly on any name that doesn't round-trip.
  const byState = new Map<string, ProjectedFeature[]>();
  for (const f of divisionsGeo.features) {
    const match = stateByKey.get(nameKey(f.properties.Elect_div));
    if (!match) throw new Error(`Shapefile division "${f.properties.Elect_div}" not in dataset`);
    const polygons = (
      f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates
    ) as [number, number][][][];
    const state = match.state.toUpperCase(); // dataset uses mixed case ("Qld"); files/keys are upper
    const list = byState.get(state) ?? [];
    list.push({ name: match.electorate, polygons });
    byState.set(state, list);
  }
  if (divisionsGeo.features.length !== dataset.ballots.electorates.length)
    throw new Error(
      `Expected ${dataset.ballots.electorates.length} divisions, got ${divisionsGeo.features.length}`,
    );

  for (const [state, features] of [...byState.entries()].sort()) {
    features.sort((a, b) => a.name.localeCompare(b.name));
    const { viewBox, divisions, cities } = buildStateGeometry(
      dropOutlierParts(features),
      citiesByState.get(state) ?? [],
    );
    const map: StateMap = { state, attribution: MAP_ATTRIBUTION, viewBox, divisions, cities };
    const file = resolve(OUT_DIR, `${state}.json`);
    await writeJson(file, map);
    const kb = (JSON.stringify(map).length / 1024).toFixed(0);
    console.info(`✓ ${state}: ${divisions.length} divisions, ${cities.length} cities, ${kb} KB`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
