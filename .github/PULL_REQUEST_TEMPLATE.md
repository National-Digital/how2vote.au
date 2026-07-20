<!-- The PR title becomes the squash-merge subject and drives versioning — use Conventional Commits
     (feat:, fix:, docs:, chore:, …). See CONTRIBUTING.md. -->

## What & why

<!-- What does this change, and why? Link any related issue (e.g. Closes #123). -->

## How I verified

<!-- Commands you ran and what you observed. -->

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm --filter @how2vote/web neutrality:check` (if UI/CSS changed)

## Checklist

- [ ] Commits are signed off (DCO — `git commit -s`); see CONTRIBUTING.md
- [ ] PR title follows Conventional Commits
- [ ] No hue introduced anywhere in the UI (strictly two-tone)
- [ ] If scoring changed: methodology version bumped and golden tests updated
- [ ] If the dataset changed: rebuilt deterministically from `data/source`

## Review tier

<!-- Pick the highest tier this PR touches. See CONTRIBUTING.md → "Review tiers". -->

- [ ] **Ordinary** — styling, copy, non-material UI only
- [ ] **Enhanced** — scoring, data imports, sharing, analytics, historical records, accessibility
- [ ] **Compliance** — printing/authorisation, election-period publishing, attribution, licence
      handling, provenance or retention

### Compliance-tier changes must complete this block

<!-- Delete this block only if NONE of the Compliance-tier paths above are touched. -->

- Linked legal/policy requirement (control): <!-- e.g. control-11; docs/legal/control-register.json -->
- Recorded policy version: <!-- methodologyVersion / compliancePolicyVersion / legal-review version -->
- BDD example (if behaviour changed): <!-- link the .feature scenario / acceptance test -->
- Automated test: <!-- the enforcedBy guard / suite proving it -->
- Sample output or data diff: <!-- golden diff, provenance sign-off, or attach output -->
- Named compliance reviewer (docs/legal/signatories.json id): <!-- e.g. cameron-young / tara-buckley -->

- [ ] Compliance CODEOWNERS review requested (auto for the paths above)
