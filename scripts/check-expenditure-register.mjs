#!/usr/bin/env node
/**
 * CI guard for docs/legal/electoral-expenditure.json (schemaVersion 3).
 *
 * The register is deliberately conservative: every dedicated domain/hosting cash cost is
 * counted as electoral expenditure. Unpaid founder/director labour may be recorded at $0 only
 * where no additional salary, fee, bonus, invoice or project-specific liability was incurred.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REGISTER_REL = "docs/legal/electoral-expenditure.json";
const VENDOR_REL = "apps/web/src/lib/privacy/third-party-services.json";

const CLASSIFICATIONS = ["electoral", "non-electoral", "mixed", "not-expenditure"];
const DISCLOSURE_STATUSES = ["not-a-disclosure-entity", "third-party", "significant-third-party"];

const isString = (v) => typeof v === "string" && v.trim().length > 0;
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isNonNegative = (v) => isNumber(v) && v >= 0;

function dateMs(v) {
  if (!isString(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function moneyEqual(a, b) {
  return Math.abs(a - b) < 0.005;
}

function serviceIsCovered(service, records) {
  const needles = [service?.name, service?.id].filter(isString).map((v) => v.toLowerCase());
  return records.some((record) => {
    const haystacks = [record?.supplier, record?.category]
      .filter(isString)
      .map((v) => v.toLowerCase());
    return haystacks.some((h) => needles.some((n) => h.includes(n) || n.includes(h)));
  });
}

export function computeTotals(register) {
  const periods = Array.isArray(register?.periods) ? register.periods : [];
  let actual = 0;
  let electoral = 0;
  for (const period of periods) {
    const records = Array.isArray(period?.records) ? period.records : [];
    for (const record of records) {
      if (isNumber(record?.actualAmount)) actual += record.actualAmount;
      if (isNumber(record?.electoralAmount)) electoral += record.electoralAmount;
    }
  }
  return {
    actual: Math.round(actual * 100) / 100,
    electoral: Math.round(electoral * 100) / 100,
  };
}

export function verdict(register, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  const vendorRegistry = options.vendorRegistry ?? null;
  const push = (message) => errors.push(message);

  if (!register || typeof register !== "object" || Array.isArray(register)) {
    return { ok: false, errors: ["register must be an object"], totals: computeTotals(register) };
  }

  if (register.schemaVersion !== 3) push("schemaVersion must be 3");
  if (register.currency !== "AUD") push('currency must be "AUD"');

  for (const key of [
    "reviewedFrom",
    "reviewedThrough",
    "reviewer",
    "secondReviewer",
    "reviewDate",
    "nextReviewDate",
    "evidenceRef",
    "operator",
  ]) {
    if (!isString(register[key])) push(`missing ${key}`);
  }

  if (register.reviewer === register.secondReviewer) {
    push("reviewer and secondReviewer must be different");
  }

  for (const key of ["reviewedFrom", "reviewedThrough", "reviewDate", "nextReviewDate"]) {
    if (dateMs(register[key]) === null) push(`${key} must be an ISO date`);
  }

  const nextReview = dateMs(register.nextReviewDate);
  if (nextReview !== null && now > nextReview) {
    push(`review overdue: ${register.nextReviewDate}`);
  }

  if (!Array.isArray(register.periods) || register.periods.length === 0) {
    push("periods must be a non-empty array");
  }

  const seenPeriodIds = new Set();
  const allRecords = [];
  if (Array.isArray(register.periods)) {
    for (const [periodIndex, period] of register.periods.entries()) {
      const label = `period[${periodIndex}]`;
      if (!period || typeof period !== "object" || Array.isArray(period)) {
        push(`${label} must be an object`);
        continue;
      }
      for (const key of [
        "id",
        "startDate",
        "endDate",
        "reportingBasis",
        "determination",
        "activityNote",
      ]) {
        if (!isString(period[key])) push(`${label}: missing ${key}`);
      }
      if (seenPeriodIds.has(period.id)) push(`${label}: duplicate period id ${period.id}`);
      seenPeriodIds.add(period.id);

      if (dateMs(period.startDate) === null || dateMs(period.endDate) === null) {
        push(`${label}: startDate/endDate must be ISO dates`);
      }
      if (!isNonNegative(period.disclosureThreshold)) {
        push(`${label}: disclosureThreshold must be >= 0`);
      }
      if (!Array.isArray(period.records) || period.records.length === 0) {
        push(`${label}: records must be a non-empty array`);
        continue;
      }

      const seenRecordIds = new Set();
      let actual = 0;
      let electoral = 0;
      for (const [recordIndex, record] of period.records.entries()) {
        const rlabel = `${label}.records[${recordIndex}]`;
        allRecords.push(record);
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          push(`${rlabel} must be an object`);
          continue;
        }

        for (const key of [
          "id",
          "kind",
          "category",
          "supplier",
          "payer",
          "sourceOfFundsCountry",
          "purpose",
          "classification",
          "classificationBasis",
          "amountBasis",
          "evidenceStatus",
        ]) {
          if (!isString(record[key])) push(`${rlabel}: missing ${key}`);
        }

        if (seenRecordIds.has(record.id)) push(`${rlabel}: duplicate record id ${record.id}`);
        seenRecordIds.add(record.id);

        if (!CLASSIFICATIONS.includes(record.classification)) {
          push(`${rlabel}: invalid classification ${record.classification}`);
        }
        if (!isNonNegative(record.actualAmount)) push(`${rlabel}: actualAmount must be >= 0`);
        if (!isNonNegative(record.electoralAmount)) {
          push(`${rlabel}: electoralAmount must be >= 0`);
        } else if (isNumber(record.actualAmount) && record.electoralAmount > record.actualAmount) {
          push(`${rlabel}: electoralAmount cannot exceed actualAmount`);
        }

        if (
          record.classification === "electoral" &&
          isNumber(record.actualAmount) &&
          isNumber(record.electoralAmount) &&
          !moneyEqual(record.actualAmount, record.electoralAmount)
        ) {
          push(`${rlabel}: electoral classification requires electoralAmount = actualAmount`);
        }
        if (
          ["non-electoral", "not-expenditure"].includes(record.classification) &&
          record.electoralAmount !== 0
        ) {
          push(`${rlabel}: ${record.classification} requires electoralAmount = 0`);
        }
        if (record.classification === "not-expenditure" && record.actualAmount !== 0) {
          push(`${rlabel}: not-expenditure requires actualAmount = 0`);
        }

        for (const flag of [
          "taxBenefitClaimed",
          "electionFundingClaimed",
          "publicFundingClaimed",
        ]) {
          if (typeof record[flag] !== "boolean") push(`${rlabel}: ${flag} must be boolean`);
        }

        if (isNumber(record.actualAmount)) actual += record.actualAmount;
        if (isNumber(record.electoralAmount)) electoral += record.electoralAmount;
      }

      actual = Math.round(actual * 100) / 100;
      electoral = Math.round(electoral * 100) / 100;

      if (
        !isNumber(period.totalActualCashCost) ||
        !moneyEqual(period.totalActualCashCost, actual)
      ) {
        push(`${label}: totalActualCashCost does not match records (${actual})`);
      }
      if (
        !isNumber(period.totalElectoralExpenditure) ||
        !moneyEqual(period.totalElectoralExpenditure, electoral)
      ) {
        push(`${label}: totalElectoralExpenditure does not match records (${electoral})`);
      }

      const exceeded = electoral > period.disclosureThreshold;
      if (period.thresholdExceeded !== exceeded) {
        push(`${label}: thresholdExceeded must be ${exceeded}`);
      }
      if (period.thirdPartyReturnRequired !== exceeded) {
        push(`${label}: thirdPartyReturnRequired must be ${exceeded}`);
      }
    }
  }

  if (vendorRegistry !== null) {
    if (!vendorRegistry || !Array.isArray(vendorRegistry.services)) {
      push("vendorRegistry must contain a services array");
    } else {
      // EVERY registry vendor — browser-loaded services AND infrastructure vendors — must have a
      // matching ledger record. (Originally services-only; with the forms + anti-abuse now
      // self-hosted that list is empty, so the infrastructure vendors are what keeps this
      // completeness gate live.)
      const vendors = [
        ...vendorRegistry.services,
        ...(Array.isArray(vendorRegistry.infrastructure) ? vendorRegistry.infrastructure : []),
      ];
      for (const service of vendors) {
        if (!serviceIsCovered(service, allRecords)) {
          push(`vendor completeness: ${service?.name ?? service?.id ?? "unknown service"}`);
        }
      }
    }
  }

  const totals = computeTotals(register);
  const life = register.lifeToDate;
  if (!life || typeof life !== "object") {
    push("lifeToDate must be an object");
  } else {
    if (
      !isNumber(life["actualCashCostThrough2026-07-12"]) ||
      !moneyEqual(life["actualCashCostThrough2026-07-12"], totals.actual)
    ) {
      push(`lifeToDate actual total must equal ${totals.actual}`);
    }
    if (
      !isNumber(life["conservativelyClassifiedElectoralExpenditureThrough2026-07-12"]) ||
      !moneyEqual(
        life["conservativelyClassifiedElectoralExpenditureThrough2026-07-12"],
        totals.electoral,
      )
    ) {
      push(`lifeToDate electoral total must equal ${totals.electoral}`);
    }
  }

  const disclosure = register.disclosureEntity;
  if (!disclosure || typeof disclosure !== "object") {
    push("disclosureEntity must be an object");
  } else {
    if (!DISCLOSURE_STATUSES.includes(disclosure.status)) {
      push("disclosureEntity.status is invalid");
    }
    for (const key of [
      "determinationDate",
      "reviewer",
      "secondReviewer",
      "evidenceRef",
      "determination",
      "basis",
    ]) {
      if (!isString(disclosure[key])) push(`disclosureEntity: missing ${key}`);
    }
    const anyReturnRequired = Array.isArray(register.periods)
      ? register.periods.some((period) => period.thirdPartyReturnRequired === true)
      : false;
    if (disclosure.status === "not-a-disclosure-entity" && anyReturnRequired) {
      push("disclosureEntity status contradicts a period requiring a return");
    }
  }

  return { ok: errors.length === 0, errors, totals };
}

const DETERMINATION_REL = "docs/legal/electoral-expenditure-determination.md";

const formatMoney = (n) =>
  `A$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatThreshold = (n) => `A$${n.toLocaleString("en-AU")}`;

/**
 * Drift gate for the human-readable determination: its headline figures and review window must
 * equal what the ledger computes, so the signed prose can never quietly diverge from the register.
 */
export function determinationVerdict(register, mdText) {
  const errors = [];
  const push = (message) => errors.push(message);
  if (!isString(mdText)) return { ok: false, errors: ["determination document is empty"] };

  const periods = Array.isArray(register?.periods) ? register.periods : [];
  const summed = periods
    .filter(
      (p) => p && isNumber(p.totalElectoralExpenditure) && isNonNegative(p.disclosureThreshold),
    )
    .map((p) => ({
      id: p.id,
      electoral: p.totalElectoralExpenditure,
      threshold: p.disclosureThreshold,
    }));
  if (summed.length === 0) {
    return { ok: false, errors: ["determination: register has no summable periods"] };
  }

  const highest = summed.reduce((a, b) => (b.electoral > a.electoral ? b : a));
  const current = summed[summed.length - 1];
  const expected = [
    [`highest-period amount ${formatMoney(highest.electoral)}`, formatMoney(highest.electoral)],
    [`highest-period id ${highest.id}`, highest.id],
    [
      `highest-period threshold ${formatThreshold(highest.threshold)}`,
      formatThreshold(highest.threshold),
    ],
    [`current-period amount ${formatMoney(current.electoral)}`, formatMoney(current.electoral)],
    [
      `current-period threshold ${formatThreshold(current.threshold)}`,
      formatThreshold(current.threshold),
    ],
    [
      `life-to-date total ${formatMoney(computeTotals(register).electoral)}`,
      formatMoney(computeTotals(register).electoral),
    ],
    [`review window start ${register.reviewedFrom}`, register.reviewedFrom],
    [`review window end ${register.reviewedThrough}`, register.reviewedThrough],
  ];
  for (const [label, needle] of expected) {
    if (!isString(needle) || !mdText.includes(needle)) {
      push(`determination: ${label} missing or stale (must match the ledger)`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const register = JSON.parse(readFileSync(new URL(`../${REGISTER_REL}`, import.meta.url), "utf8"));
  const vendorRegistry = JSON.parse(
    readFileSync(new URL(`../${VENDOR_REL}`, import.meta.url), "utf8"),
  );
  const determination = readFileSync(new URL(`../${DETERMINATION_REL}`, import.meta.url), "utf8");
  const result = verdict(register, { vendorRegistry });
  const md = determinationVerdict(register, determination);
  result.errors.push(...md.errors);
  if (!result.ok || !md.ok) {
    for (const error of result.errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.info(
    `electoral expenditure register OK — actual A$${result.totals.actual.toFixed(2)}, ` +
      `conservatively classified A$${result.totals.electoral.toFixed(2)}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
