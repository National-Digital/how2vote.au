# Control: control-4 — printed / shared electoral output (Commonwealth Electoral Act 1918 s 321D;
#          docs/adr/0010, which supersedes the earlier user-as-sole-authoriser model).
#          Traceable to the legal control register entry for the print authorisation.
#
# Business context (readable by developers, lawyers and product owners):
#   A deep electoral-law review concluded that National Digital — the operator that publishes How2Vote
#   and creates the plan template, ballot list and voting instructions — is the safe authoriser of the
#   printed how-to-vote material. The printed plan therefore carries NATIONAL DIGITAL's electoral
#   authorisation (the operator entity particulars), and separately states that the preference order
#   was selected by the user. No user-entered authoriser particulars (name, locality, address) are
#   collected or printed. Printing is currently WITHDRAWN by the signed control plane until an
#   electoral-law specialist signs off the authoriser determination; this specification describes the
#   authorisation logic that applies when printing is re-enabled.
#
# This specification is bound to the real, DOM-free authorisation logic in
# apps/web/src/lib/print-auth.ts (formatAuthorisation / isPrintableText) by
# apps/web/src/features.test.ts, and mirrors the stamp asserted in print-auth.test.ts. The full print
# journey (printing withdrawn; the flow cannot be reached) is covered by
# apps/web/e2e/legal-electoral-output.spec.ts.

Feature: Printing how-to-vote material
  So that no unauthorised electoral matter can be produced, the printed plan carries National Digital's
  authorisation of the material it publishes, separately identifies the preference order as the user's
  own selection, and collects no user-entered authoriser particulars.

  Scenario: Printing how-to-vote material
    Given a user created the preferences in the current session
    When the user requests printable material
    Then the printed material carries National Digital's authorisation
    And the printed output states the preference order was selected by the user
    And no user-entered authoriser particulars are collected or printed
