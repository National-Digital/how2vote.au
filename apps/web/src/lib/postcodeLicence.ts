/**
 * Attribution for the ABS postcode correspondence behind the postcode pages, read from the rights
 * register so the page wording cannot drift from LICENSE-DATA.md.
 */
import { rightsClasses } from "$data/rights/rights-classes.json";

const POSTCODE_RIGHTS_CLASS = "abs-asgs-cc-by";

const rc = rightsClasses.find((c) => c.id === POSTCODE_RIGHTS_CLASS);
if (!rc?.licence.url) throw new Error(`rights class ${POSTCODE_RIGHTS_CLASS} is missing`);

/** The register's required attribution, verbatim. */
export const POSTCODE_ATTRIBUTION: string = rc.attribution;

export const POSTCODE_LICENCE_NAME: string = rc.licence.name;

export const POSTCODE_LICENCE_URL: string = rc.licence.url;
