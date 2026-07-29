# Electoral expenditure determination

**Operator:** General Consulting Services Pty Ltd as trustee for the Australian Business Trust, trading as National Digital  
**Project:** How2Vote  
**Reviewed:** 2018-10-12 to 2026-07-26  
**Determination date:** 2026-07-26  
**Reviewers:** Cameron Young and Tara Buckley  
**Evidence ID:** `EV-EXPENDITURE-CLASSIFICATION`

## Determination

National Digital reviewed the full known How2Vote cost history from commencement on 12 October 2018.

For a conservative result, every dedicated How2Vote domain and hosting cost has been treated as electoral expenditure, without relying on an argument that historical, educational or out-of-cycle work was non-electoral. On that deliberately over-inclusive basis, expenditure remained far below the applicable disclosure threshold in every period.

Project work by Cameron Young and Tara Buckley is recorded at **$0**. National Digital incurred no additional salary, director fee, bonus, contractor fee, invoice or other project-specific liability for that work. No commercial charge-out rate or opportunity cost has been imputed.

National Digital therefore did not become a third party or significant third party for any reviewed period, and no third-party electoral-expenditure return was required on the recorded facts.

## Figures

The authoritative period-by-period figures are the machine-checked ledger,
[`electoral-expenditure.json`](./electoral-expenditure.json) — they are deliberately not repeated
here. The headline the conclusion turns on (drift-gated against the ledger by
`scripts/check-expenditure-register.mjs`):

- Highest reviewed period: **A$578.30** (FY2024-25), against its **A$16,900** threshold.
- Current transitional period (2026-H2, through 26 July 2026): **A$46.75**, against **A$17,300**.
- Life-to-date conservatively classified electoral expenditure: approximately **A$3,885.20**.

The historical AWS and registrar figures are reconstructed estimates. Exact invoice reconciliation
should be retained where available, but cannot affect the threshold outcome because the margin is
substantial.

## Cost history and activity

- **12 October 2018:** `how2vote.com.au` registered and the project commenced.
- **2019:** initial v0 beta developed.
- **2022:** project reviewed; `how2vote.au` registered on 11 April 2022.
- **2025:** small update.
- **June 2026:** substantial redevelopment.
- **July 2026:** small amount of completion and migration work; AWS EC2 instance terminated and the application migrated to Cloudflare.
- **25 July 2026:** third-party form delivery (Formspree) and anti-abuse (Cloudflare Turnstile) replaced by self-hosted first-party equivalents; form submissions are relayed via Cloudflare Email Sending at no dedicated cost (the US$5/month account-level plan upgrade that enabled it is a National Digital account-wide overhead, $0 project-specific under the shared-overheads policy).
- **26 July 2026:** defensive `how2vote.app` domain registered for A$27.75/yr and permanently redirected to `how2vote.au` (it matches the published Android application ID `au.how2vote.app`; `.com` and `.org` were already held by third parties).
- **Cloudflare:** current architecture uses free-tier services, with no dedicated cash expenditure recorded through 26 July 2026.
- **Labour:** all project work was undertaken by Cameron Young and Tara Buckley without a project-specific charge to National Digital.

## Forecast treatment

The CY2027 domain renewals are recorded as **forecast**, not 2026-H2 actuals; if an invoice shows a
renewal was charged before 1 January 2027, move it into the `2026-H2` period. The ledger's
`forecast` block governs.

## Going-forward control

1. Update `docs/legal/electoral-expenditure.json` whenever a dedicated cost is incurred.
2. Keep receipts, registrar records and AWS/Cloudflare billing exports where available.
3. Review the ledger before 1 January 2027.
4. From 1 January 2027, track expenditure by calendar year against the $5,000 threshold.
5. Require a fresh determination before paid advertising, contractors, live-election candidate data or other material election-specific expenditure is approved.

## Sources

- AEC disclosure thresholds: <https://www.aec.gov.au/Parties_and_Representatives/public_funding/threshold.htm>
- AEC third-party disclosure guidance: <https://www.aec.gov.au/Parties_and_Representatives/financial_disclosure/guides/third-parties/>
- AEC transitional rules: <https://www.aec.gov.au/FADTransitionalRules/>
- AEC funding and disclosure reforms from 1 January 2027: <https://www.aec.gov.au/FADReform/>

## Approval

Approved by:

- Cameron Young, CEO
- Tara Buckley, COO

Approval date: 26 July 2026  
Next review date: 1 December 2026
