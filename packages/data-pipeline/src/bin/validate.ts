import { ELECTIONS, formatReport } from "@how2vote/data-schema";
import { loadSource, validateElection } from "../dataset.js";

/**
 * The dataset integrity gate as a CLI — validates every election (referential integrity plus,
 * where a committed snapshot exists, the snapshot-consistency gate), exits non-zero on any error.
 */
async function main(): Promise<void> {
  let ok = true;
  for (const meta of ELECTIONS) {
    const dataset = await loadSource(meta.id);
    const { report } = await validateElection(meta, dataset);
    console.info(`[${meta.id}] ${formatReport(report)}`);
    if (!report.ok) ok = false;
  }
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
