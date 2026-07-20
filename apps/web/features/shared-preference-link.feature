# Control: control-4 — printed / shared electoral output (Commonwealth Electoral Act 1918 s 321D;
#          docs/adr/0010). Traceable to the legal control register entry for share/print output.
#
# Business context (readable by developers, lawyers and product owners):
#   A share link carries only the user's candidate PREFERENCES (their answers), never a printable
#   how-to-vote card and never any authoriser particulars. Opening someone else's link produces a
#   read-only comparison: the recipient can see the preferences, but cannot print how-to-vote
#   material off the back of them, and learns nothing about who authored or authorised the original.
#
# This specification is bound to the real share codec (packAnswers / encodeShare / decodeShare) and
# the card model (generateCard) by apps/web/src/features.test.ts. The full browser journey — a shared
# /card#… link forced into the shared-readonly session with no print button — is covered end-to-end by
# apps/web/e2e/legal-electoral-output.spec.ts.

Feature: Opening a shared preference link
  So that a shared comparison stays a comparison and never becomes unauthorised electoral matter,
  a person opening someone else's link sees the preferences but can neither print nor learn the
  original author's authorisation details.

  Scenario: Opening a shared preference link
    Given a user has created candidate preferences
    When another person opens the shared URL
    Then the candidate preferences are displayed
    And no printable how-to-vote card can be generated
    And no authorisation details from the original user are disclosed
