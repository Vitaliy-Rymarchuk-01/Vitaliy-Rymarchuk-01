#!/usr/bin/env node
/**
 * Restyles the Platane/snk-generated contribution-grid snake SVG:
 *   - commit-day cells become full-size gold sparkle stars (brightness tied
 *     to the original contribution intensity level) sitting on top of the
 *     normal dark cell square
 *   - the streak progress bar at the bottom uses the same gold palette
 *   - inactive cells get a soft night-indigo fill with slightly rounder corners
 *   - the snake body is replaced by a single running character image that
 *     mirrors horizontally to face the direction it is currently moving
 *
 * Safe to run on any freshly generated snake SVG: every transformation is
 * derived from the file's own structure (class names, keyframe values), not
 * hardcoded numbers, so it keeps working as the contribution graph changes
 * day to day. Running it twice is a no-op (idempotent).
 */

const fs = require("fs");
const path = require("path");

const CHARACTER_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "icons",
  "f6d34682c3e5ff2863b15dbb0d043f6d_8319818152811527332.webp"
);

function characterDataUri() {
  const bytes = fs.readFileSync(CHARACTER_PATH);
  return `data:image/webp;base64,${bytes.toString("base64")}`;
}

const STAR_PATH =
  "M6 0C6 3 6.5 5.5 12 6C6.5 6.5 6 9 6 12" +
  "C6 9 5.5 6.5 0 6C5.5 5.5 6 3 6 0Z";

const GOLD = { 1: "#9c7a2a", 2: "#c79f2e", 3: "#e8c233", 4: "#ffe873" };

const NIGHT_CELL_BG = "#1b1440";

const SNAP_EPSILON = 0.05; // % of the animation timeline for the "instant" flip

function recolorRoot(svg) {
  svg = svg.replace(/--ce:#[0-9a-fA-F]{6}/, `--ce:${NIGHT_CELL_BG}`);
  const goldVars = Object.entries(GOLD)
    .map(([n, c]) => `;--g${n}:${c}`)
    .join("");
  svg = svg.replace(/(--c4:#[0-9a-fA-F]{6})/, `$1${goldVars}`);
  return svg;
}

function roundCells(svg) {
  return svg.split('rx="2" ry="2"').join('rx="3" ry="3"');
}

function addStarDef(svg) {
  const starDef = `<defs><path id="star" d="${STAR_PATH}"/></defs>`;
  return svg.replace("</style>", "</style>" + starDef);
}

function findCommitCellClasses(svg) {
  const start = svg.indexOf("@keyframes c0");
  const end = svg.indexOf(".u{transform-origin");
  const segment = svg.slice(start, end);
  const names = [...segment.matchAll(/@keyframes (c[0-9a-z]+)\{/g)].map(
    (m) => m[1]
  );
  return names;
}

function goldIfyCommitKeyframes(svg) {
  const start = svg.indexOf("@keyframes c0");
  const end = svg.indexOf(".u{transform-origin");
  const segment = svg
    .slice(start, end)
    .replace(/var\(--c([1-4])\)/g, "var(--g$1)");
  return svg.slice(0, start) + segment + svg.slice(end);
}

function goldIfyTrailBar(svg) {
  return svg.replace(
    /\.u\.u([0-3])\{fill:var\(--c([1-4])\);/g,
    ".u.u$1{fill:var(--g$2);"
  );
}

function starsOnCommitCells(svg, cellNames) {
  if (cellNames.length === 0) return svg;
  const alt = cellNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(
    `<rect class="c (${alt})" x="([\\d.]+)" y="([\\d.]+)" rx="3" ry="3"/>`,
    "g"
  );
  return svg.replace(pattern, (_, cls, x, y) => {
    return (
      `<rect class="c" x="${x}" y="${y}" rx="3" ry="3"/>` +
      `<use class="c ${cls}" href="#star" x="${x}" y="${y}"/>`
    );
  });
}

function replaceSnakeBodyWithCharacter(svg) {
  const bodyPattern =
    /<rect class="s s0"[^/]*\/><rect class="s s1"[^/]*\/><rect class="s s2"[^/]*\/><rect class="s s3"[^/]*\/>/;
  const character =
    `<image class="s s0" x="-7" y="-7" width="30" height="30" ` +
    `href="${characterDataUri()}" preserveAspectRatio="xMidYMid slice"/>`;
  if (!bodyPattern.test(svg)) {
    console.warn(
      "style-snake: snake body rects not found, skipping character swap"
    );
    return svg;
  }
  return svg.replace(bodyPattern, character);
}

function fmtPct(v) {
  const s = v.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
}

function mirrorCharacterByDirection(svg) {
  const startMarker = "@keyframes s0{";
  const endMarker = ".s.s0{";
  const start = svg.indexOf(startMarker);
  const end = svg.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    console.warn("style-snake: s0 keyframes not found, skipping mirroring");
    return svg;
  }

  let block = svg.slice(start + startMarker.length, end);
  if (!block.endsWith("}")) return svg;
  block = block.slice(0, -1);

  const ruleRe = /([\d.]+)%\{transform:translate\((-?[\d.]+)px,(-?[\d.]+)px\)\}/g;
  const points = [...block.matchAll(ruleRe)].map((m) => [
    parseFloat(m[1]),
    parseFloat(m[2]),
    parseFloat(m[3]),
  ]);
  points.sort((a, b) => a[0] - b[0]);
  if (points.length === 0) return svg;

  let direction = 1;
  let prevX = null;
  const annotated = [];
  for (const [pct, x, y] of points) {
    if (prevX !== null) {
      const dx = x - prevX;
      if (dx > 0) direction = 1;
      else if (dx < 0) direction = -1;
    }
    annotated.push([pct, x, y, direction]);
    prevX = x;
  }

  const newPoints = [annotated[0]];
  for (let i = 1; i < annotated.length; i++) {
    const [pct, x, y, d] = annotated[i];
    const [prevPct, prevX2, prevY2, prevD] = annotated[i - 1];
    if (d !== prevD) {
      const snapPct = prevPct + SNAP_EPSILON;
      if (snapPct < pct) {
        newPoints.push([snapPct, prevX2, prevY2, d]);
      }
    }
    newPoints.push([pct, x, y, d]);
  }

  const newBlock = newPoints
    .map(
      ([pct, x, y, d]) =>
        `${fmtPct(pct)}%{transform:translate(${x}px,${y}px) scaleX(${d})}`
    )
    .join("");

  svg = svg.slice(0, start) + startMarker + newBlock + "}" + svg.slice(end);

  svg = svg.replace(
    /\.s\.s0\{transform:translate\((-?[\d.]+)px,(-?[\d.]+)px\);animation-name:s0\}/,
    ".s.s0{transform:translate($1px,$2px) scaleX(1);animation-name:s0;" +
      "transform-origin:8px 8px}"
  );
  return svg;
}

function restyle(svg) {
  if (svg.includes('id="star"')) {
    console.log("style-snake: already styled, skipping");
    return svg;
  }

  svg = recolorRoot(svg);
  svg = roundCells(svg);
  svg = addStarDef(svg);
  const cellNames = findCommitCellClasses(svg);
  svg = goldIfyCommitKeyframes(svg);
  svg = goldIfyTrailBar(svg);
  svg = starsOnCommitCells(svg, cellNames);
  svg = replaceSnakeBodyWithCharacter(svg);
  svg = mirrorCharacterByDirection(svg);
  return svg;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: style-snake.js <path-to-svg>");
    process.exit(1);
  }

  const svg = fs.readFileSync(path, "utf8");
  const styled = restyle(svg);
  fs.writeFileSync(path, styled, "utf8");
  console.log(`style-snake: styled ${path}`);
}

main();
