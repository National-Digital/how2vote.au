#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools>=4.53", "brotli>=1.1", "uharfbuzz>=0.39"]
# ///
"""Brand-mark generator — bakes the how2vote logo into src/lib/brand/mark.mjs
(the OpenGraph tagline copy into scripts/og-taglines.mjs, and the public brand SVGs
in docs/brand/ — ink and chalk inkings of each mark).

The identity is `how[2]vote`: a preference numeral "2" marked inside a ballot-paper
box, flanked by the ghost [1] and [3] cells of the column it belongs to. Rather than
rendering it with <text> at the mercy of whatever serif the platform substitutes,
this script converts the brand face itself — Newsreader (self-hosted, static/fonts,
OFL) instanced at wght 600 / opsz 72, the display cut — into vector outlines, shapes
"how" and "vote" through HarfBuzz so real kerning applies, and lays everything out on
a shared baseline. The result is deterministic path data that renders identically
everywhere: the Logo component, favicons, PWA icons, OpenGraph cards.

Four marks come out of one geometry:
  - MARK — the boxed 2 alone (64 grid). Favicon and small UI, where ghost cells
    would turn to fuzz.
  - COLUMN — the ballot column (64 grid): the 2's cell flanked by complete ghost
    [1]/[3] cells at half size and reduced opacity, so the 2 reads as a *preference
    on a ballot*, not a checkbox. App icons and standalone brand use.
  - WORDMARK — how[2]vote on one baseline, clean. The in-app lockup.
  - WORDMARK_DISPLAY — the wordmark with the ghost [1]/[3] cells above and below its
    box. Display surfaces (OpenGraph cards, marketing) that can afford the height.

Geometry decisions baked here (values in Newsreader font units, UPM 2000, unless a
grid is named):
  - Wordmark box: side 1736 = 2×drop + numeral cap 1413·k, so the ink margins above
    and below the numeral match while the numeral keeps the wordmark baseline.
  - Numeral in wordmark at k = 0.96 of text size, nudged 10 units left — the italic
    tail flares right, so bbox-centring alone reads right-heavy.
  - Box stroke 1/16 of its side; corner radius ~2px at UI scale (design tokens).
  - MARK (64 grid): 56-square box, 4 stroke, rx 2; numeral 42 tall, optically nudged
    0.5 up-left so its visual mass centres.
  - Ghost cells: about half the main cell's side, numerals at 0.62–0.65 of their
    cell, opacity 0.4–0.45 — present enough to read 1-2-3, quiet enough not to
    compete. In COLUMN the ghost cells run flush to the canvas edge (the column
    continues past the frame); their outer half-stroke is cropped on purpose.

Output is committed (it is the logo, a design decision), but never hand-edited —
rerun this script to regenerate: `uv run apps/web/scripts/generate-brand-mark.py`.
"""

import json
from io import BytesIO
from pathlib import Path

import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = Path(__file__).resolve().parent
FONTS = HERE.parent / "static" / "fonts"
OUT = HERE.parent / "src" / "lib" / "brand" / "mark.mjs"

AXES = {"wght": 600, "opsz": 72}


def load(name: str) -> tuple[TTFont, bytes]:
    font = TTFont(FONTS / name)
    instantiateVariableFont(font, AXES, inplace=True)
    font.flavor = None  # HarfBuzz wants raw sfnt, not woff2
    buf = BytesIO()
    font.save(buf)
    return font, buf.getvalue()


def draw(font: TTFont, glyph_name: str, transform: Transform, pen: SVGPathPen) -> None:
    font.getGlyphSet()[glyph_name].draw(TransformPen(pen, transform))


def run_path(font: TTFont, blob: bytes, text: str, transform: Transform) -> tuple[str, float]:
    """One combined SVG path for a HarfBuzz-shaped run; returns (d, advance)."""
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb.Font(hb.Face(blob)), buf)
    pen = SVGPathPen(font.getGlyphSet(), ntos=lambda v: f"{round(v, 2):g}")
    x = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        draw(font, font.getGlyphName(info.codepoint), transform.translate(x + pos.x_offset, pos.y_offset), pen)
        x += pos.x_advance
    return pen.getCommands(), x


roman, roman_blob = load("newsreader.woff2")
italic, italic_blob = load("newsreader-italic.woff2")


class Numeral:
    """An italic digit's outline plus the metrics needed to centre it optically."""

    def __init__(self, char: str):
        self.name = italic.getBestCmap()[ord(char)]
        pen = BoundsPen(italic.getGlyphSet())
        italic.getGlyphSet()[self.name].draw(pen)
        x_min, y_min, x_max, y_max = pen.bounds
        self.x_mid = (x_min + x_max) / 2
        self.top = y_max  # above baseline
        self.bottom = -y_min  # below baseline (positive = overshoot)
        self.height = y_max - y_min

    def path(self, tx: float, ty: float, scale: float) -> str:
        """Baseline origin mapped to (tx, ty), y flipped to SVG coordinates."""
        pen = SVGPathPen(italic.getGlyphSet(), ntos=lambda v: f"{round(v, 2):g}")
        draw(italic, self.name, Transform(scale, 0, 0, -scale, tx, ty), pen)
        return pen.getCommands()

    def centred(self, cx: float, cy: float, height: float, nudge: float = 0.0) -> str:
        """The digit with its bounding box centred on (cx, cy) at `height` tall."""
        s = height / self.height
        return self.path(
            cx - self.x_mid * s + nudge,
            cy + (self.top - self.bottom) / 2 * s + nudge,
            s,
        )


ONE, TWO, THREE = Numeral("1"), Numeral("2"), Numeral("3")

# ---- MARK: the boxed 2 alone, on a 64 grid ----------------------------------------
NUDGE = -0.5  # optical: lift the numeral off pure bbox centre
mark = {
    "viewBox": "0 0 64 64",
    "rect": {"x": 4, "y": 4, "width": 56, "height": 56, "rx": 2, "strokeWidth": 4},
    "numeralD": TWO.centred(32, 32, 42, nudge=NUDGE),
}

# ---- COLUMN: the ballot column on a 64 grid ---------------------------------------
MAIN = 30.0  # main cell side (stroke centred on this square)
GHOST_SIDE = 16.0
CELL_GAP = 1.0
GHOST_OP = 0.45
column = {
    "viewBox": "0 0 64 64",
    "rect": {"x": 17, "y": 17, "width": 30, "height": 30, "rx": 1.5, "strokeWidth": 3.4},
    "numeralD": TWO.centred(32, 32, 22, nudge=-0.4),
    "ghostOpacity": GHOST_OP,
    "ghosts": [
        {
            # cell sits CELL_GAP above the main box top: y = 17 - 1 - 16 = 0
            "rect": {"x": 24, "y": 17 - CELL_GAP - GHOST_SIDE, "width": 16, "height": 16, "rx": 0.9, "strokeWidth": 2.1},
            "numeralD": ONE.centred(32, 17 - CELL_GAP - GHOST_SIDE / 2, GHOST_SIDE * 0.65),
        },
        {
            "rect": {"x": 24, "y": 47 + CELL_GAP, "width": 16, "height": 16, "rx": 0.9, "strokeWidth": 2.1},
            "numeralD": THREE.centred(32, 47 + CELL_GAP + GHOST_SIDE / 2, GHOST_SIDE * 0.65),
        },
    ],
}

# ---- WORDMARK: how [2] vote on one baseline, font units scaled 1:20 ---------------
SC = 1 / 20
K = 0.96  # numeral size relative to the letters
DROP = 190  # box bottom sits this far below the baseline
SIDE = 1736  # = 2·DROP + TWO cap·K, so top/bottom ink margins match
GAP = 270
STROKE = SIDE * 0.0625
RX = 39

how_d, how_adv = run_path(roman, roman_blob, "how", Transform(SC, 0, 0, -SC, 0, 0))
box_x = how_adv + GAP
vote_x = box_x + SIDE + GAP
vote_d, vote_adv = run_path(roman, roman_blob, "vote", Transform(SC, 0, 0, -SC, vote_x * SC, 0))
numeral_d = TWO.path((box_x + SIDE / 2 - TWO.x_mid * K - 10) * SC, 0, K * SC)
width = (vote_x + vote_adv) * SC

wordmark = {
    "viewBox": f"0 {round(-(SIDE - DROP) * SC, 2)} {round(width, 2)} {round(SIDE * SC, 2)}",
    "width": round(width, 2),
    "height": round(SIDE * SC, 2),
    "textD": f"{how_d} {vote_d}",
    "rect": {
        "x": round((box_x + STROKE / 2) * SC, 2),
        "y": round((DROP - SIDE + STROKE / 2) * SC, 2),
        "width": round((SIDE - STROKE) * SC, 2),
        "height": round((SIDE - STROKE) * SC, 2),
        "rx": round(RX * SC, 2),
        "strokeWidth": round(STROKE * SC, 3),
    },
    "numeralD": numeral_d,
}

# ---- WORDMARK_DISPLAY: the wordmark inside its ballot column ----------------------
box_top = -(SIDE - DROP) * SC  # -77.3
box_bottom = DROP * SC  # 9.5
box_cx = (box_x + SIDE / 2) * SC
G_SCALE = 0.5  # ghost cell side relative to the main box
G_GAP = 8.0  # /20-grid units between box and ghost cell
G_OP = 0.4
g_side = SIDE * SC * G_SCALE  # 43.4
g_sw = STROKE * SC * G_SCALE * 1.4
g_n = g_side * 0.62

def ghost_cell(numeral: Numeral, cy: float) -> dict:
    return {
        "rect": {
            "x": round(box_cx - g_side / 2 + g_sw / 2, 2),
            "y": round(cy - g_side / 2 + g_sw / 2, 2),
            "width": round(g_side - g_sw, 2),
            "height": round(g_side - g_sw, 2),
            "rx": round(RX * SC * G_SCALE, 2),
            "strokeWidth": round(g_sw, 2),
        },
        "numeralD": numeral.centred(box_cx, cy, g_n),
    }

display_top = box_top - G_GAP - g_side
display_bottom = box_bottom + G_GAP + g_side
wordmark_display = {
    "viewBox": f"0 {round(display_top, 2)} {round(width, 2)} {round(display_bottom - display_top, 2)}",
    "width": round(width, 2),
    "height": round(display_bottom - display_top, 2),
    "ghostOpacity": G_OP,
    "ghosts": [
        ghost_cell(ONE, box_top - G_GAP - g_side / 2),
        ghost_cell(THREE, box_bottom + G_GAP + g_side / 2),
    ],
}


# ---- OG taglines: baked copy for the social cards ---------------------------------
# librsvg (sharp's SVG rasteriser) ignores @font-face entirely, so <text> taglines
# bake a fontconfig fallback (DejaVu on Linux CI) into the shipped PNGs. Baking the
# two static lines as outlines keeps the cards in Newsreader. Emitted to scripts/
# (not src/lib) so page copy can't leak into the client bundle. At 72px the opsz 72
# instance is the optically correct cut.
TAG_SCALE = 72 / 2000  # paths sized for a 72px line, baseline at y=0
tag1_d, tag1_adv = run_path(
    roman, roman_blob, "Their promises are words.", Transform(TAG_SCALE, 0, 0, -TAG_SCALE, 0, 0)
)
tag2_d, tag2_adv = run_path(
    italic, italic_blob, "Their votes are on the record.", Transform(TAG_SCALE, 0, 0, -TAG_SCALE, 0, 0)
)
OG_OUT = HERE / "og-taglines.mjs"


def js(value) -> str:
    return json.dumps(value, indent=2)


OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(f'''\
/**
 * Brand mark geometry — the single source of truth for the how2vote logo.
 *
 * GENERATED by scripts/generate-brand-mark.py — never hand-edit; rerun that script
 * (`uv run apps/web/scripts/generate-brand-mark.py`) to change the mark. The paths are
 * Newsreader (static/fonts, OFL) outlines at wght 600 / opsz 72, HarfBuzz-kerned and
 * baked to absolute coordinates, so the logo renders identically with zero font
 * dependency: in the Logo component, the favicon/PWA icons, and the OpenGraph cards.
 *
 * Four marks, all monochrome by construction (every `rect` is stroked, never filled;
 * `numeralD`/`textD` are ink fills):
 *   MARK              the boxed 2 alone (64 grid) — favicon and small UI
 *   COLUMN            the ballot column with ghost [1]/[3] cells (64 grid) — app icons
 *   WORDMARK          how[2]vote, clean — the in-app lockup (baseline y=0)
 *   WORDMARK_DISPLAY  the wordmark inside its ballot column — OG cards, marketing
 */

export const MARK = {js(mark)};

export const COLUMN = {js(column)};

export const WORDMARK = {js(wordmark)};

export const WORDMARK_DISPLAY = {js(wordmark_display)};

/** @type {{(r: Record<string, number>, color: string, extra?: string) => string}} */
const rect = (r, color, extra = "") =>
  `<rect x="${{r.x}}" y="${{r.y}}" width="${{r.width}}" height="${{r.height}}" rx="${{r.rx}}" fill="none" stroke="${{color}}" stroke-width="${{r.strokeWidth}}"${{extra}}/>`;

/** @type {{(spec: {{ghosts: Array<{{rect: Record<string, number>, numeralD: string}}>, ghostOpacity: number}}, color: string) => string}} */
const ghosts = (spec, color) =>
  spec.ghosts
    .map(
      (g) =>
        `<g opacity="${{spec.ghostOpacity}}">${{rect(g.rect, color)}}<path fill="${{color}}" d="${{g.numeralD}}"/></g>`,
    )
    .join("");

/** Inner markup (no <svg> wrapper) for the boxed-2 mark, inked in `color`. */
/** @type {{(color: string) => string}} */
export const markMarkup = (color) =>
  `${{rect(MARK.rect, color)}}<path fill="${{color}}" d="${{MARK.numeralD}}"/>`;

/** Inner markup for the ballot-column mark (ghost [1]/[3] cells), inked in `color`. */
/** @type {{(color: string) => string}} */
export const columnMarkup = (color) =>
  `${{rect(COLUMN.rect, color)}}<path fill="${{color}}" d="${{COLUMN.numeralD}}"/>${{ghosts(COLUMN, color)}}`;

/** Inner markup for the clean wordmark, inked in `color`. */
/** @type {{(color: string) => string}} */
export const wordmarkMarkup = (color) =>
  `<path fill="${{color}}" d="${{WORDMARK.textD}}"/>${{rect(WORDMARK.rect, color)}}<path fill="${{color}}" d="${{WORDMARK.numeralD}}"/>`;

/** Inner markup for the display wordmark (wordmark + ghost cells), inked in `color`. */
/** @type {{(color: string) => string}} */
export const wordmarkDisplayMarkup = (color) =>
  `${{wordmarkMarkup(color)}}${{ghosts(WORDMARK_DISPLAY, color)}}`;
''')
print(f"✓ brand mark → {OUT.relative_to(HERE.parent)}")

OG_OUT.write_text(f'''\
/**
 * OpenGraph tagline copy as baked Newsreader outlines (wght 600 / opsz 72, 72px em,
 * baseline y=0) — librsvg ignores @font-face, so <text> would rasterise in whatever
 * serif fontconfig finds. GENERATED by generate-brand-mark.py; to change the copy,
 * edit the strings there and rerun it. Lives in scripts/, not src/lib, so page copy
 * stays out of the client bundle.
 */

/** "Their promises are words." — roman, for a 72px line. */
export const TAGLINE_1 = {{ d: {json.dumps(tag1_d)}, width: {round(tag1_adv * TAG_SCALE, 1)} }};

/** "Their votes are on the record." — italic, for a 72px line. */
export const TAGLINE_2 = {{ d: {json.dumps(tag2_d)}, width: {round(tag2_adv * TAG_SCALE, 1)} }};
''')
print(f"✓ og taglines → {OG_OUT.relative_to(HERE.parent)}")

# ---- docs/brand SVG exports -------------------------------------------------------
# The public brand files in docs/brand are exports of the geometry above wrapped in an
# <svg>. They are GENERATED here (not hand-edited) so they can never drift from the
# canonical mark. The inner markup mirrors the JS markup helpers emitted into mark.mjs
# exactly, so an export equals the runtime-rendered mark byte-for-byte.
#
# Each mark ships in two inkings: ink #181611 for light grounds and chalk #EBE8DF for
# dark, as separate single-tone files (currentColor + a root `style` default). This is
# the brand's re-ink model — set the ink from OUTSIDE the geometry — materialised as
# files, so an embedding context that cannot set `color` (e.g. a GitHub README, which
# renders the SVG through <picture>/<img>) can still pick the right inking per theme.
BRAND_DIR = HERE.parents[2] / "docs" / "brand"
INK, CHALK = "#181611", "#EBE8DF"


def num(v) -> str:
    """Stringify a number the way the JS markup helpers interpolate it: an integral
    float collapses to an int (JS `${0.0}` → "0"), everything else round-trips. This
    keeps the exports identical to the marks the app renders from mark.mjs."""
    f = float(v)
    return str(int(f)) if f.is_integer() else repr(f)


def rect_markup(r: dict, color: str) -> str:
    return (
        f'<rect x="{num(r["x"])}" y="{num(r["y"])}" width="{num(r["width"])}"'
        f' height="{num(r["height"])}" rx="{num(r["rx"])}" fill="none"'
        f' stroke="{color}" stroke-width="{num(r["strokeWidth"])}"/>'
    )


def ghosts_markup(spec: dict, color: str) -> str:
    return "".join(
        f'<g opacity="{num(spec["ghostOpacity"])}">{rect_markup(g["rect"], color)}'
        f'<path fill="{color}" d="{g["numeralD"]}"/></g>'
        for g in spec["ghosts"]
    )


def column_markup(color: str) -> str:
    return f'{rect_markup(column["rect"], color)}<path fill="{color}" d="{column["numeralD"]}"/>{ghosts_markup(column, color)}'


def wordmark_markup(color: str) -> str:
    return (
        f'<path fill="{color}" d="{wordmark["textD"]}"/>'
        f'{rect_markup(wordmark["rect"], color)}'
        f'<path fill="{color}" d="{wordmark["numeralD"]}"/>'
    )


def wordmark_display_markup(color: str) -> str:
    return f'{wordmark_markup(color)}{ghosts_markup(wordmark_display, color)}'


def svg_doc(view_box: str, inner: str, color: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}"'
        f' role="img" aria-label="how2vote" style="color:{color}">\n'
        f"  {inner}\n</svg>\n"
    )


# (filename stem, viewBox, inner-markup builder). how2vote-mark = the ballot column;
# how2vote-wordmark = the display lockup (ghost cells); -compact = the clean wordmark.
BRAND_SVGS = [
    ("how2vote-mark", column["viewBox"], column_markup),
    ("how2vote-wordmark", wordmark_display["viewBox"], wordmark_display_markup),
    ("how2vote-wordmark-compact", wordmark["viewBox"], wordmark_markup),
]
for stem, view_box, build in BRAND_SVGS:
    inner = build("currentColor")
    (BRAND_DIR / f"{stem}.svg").write_text(svg_doc(view_box, inner, INK))
    (BRAND_DIR / f"{stem}-chalk.svg").write_text(svg_doc(view_box, inner, CHALK))
    print(f"✓ brand svg → {(BRAND_DIR / f'{stem}.svg').relative_to(HERE.parents[2])} (+ -chalk)")
