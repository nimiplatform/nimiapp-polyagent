---
name: PolyAgent
description: A quiet observation desk for a personal trading assistant
colors:
  action-teal: "#087f82"
  ink: "#183d48"
  muted-ink: "#526b73"
  cool-paper: "#f3f7f8"
  separator: "#dce6e8"
  surface: "#ffffff"
  navigation: "#173c47"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "27px"
    fontWeight: 690
    lineHeight: 1.35
    letterSpacing: "-0.035em"
  title:
    fontSize: "16px"
    fontWeight: 680
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  table:
    fontSize: "12px"
rounded:
  control: "7px"
  navigation: "9px"
  surface: "12px"
spacing:
  control-x: "12px"
  control-y: "8px"
  section-x: "21px"
  section-y: "20px"
  column-gap: "23px"
components:
  button-primary:
    backgroundColor: "{colors.action-teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  working-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
---

# Design System: PolyAgent

## Overview

**Creative North Star: "Scientific observation log"**

A scientific observation log for a personal trading workspace: cool working surfaces, precise records and restrained teal controls. The native Chinese UI typography supports reading, comparing and acting; there is no campaign-style display face.

The system uses flat bordered surfaces, compact tabular information and clear task spacing. Mode, uncertainty and action remain explicit in words as well as color. Its component vocabulary extends the public Nimi Kit controls.

**Key Characteristics:**

- Cool paper ground and deep teal navigation.
- Native Chinese UI typography with tabular numerals.
- Flat working surfaces with fine separators.
- Persistent mode and mandate; evidence stays adjacent to selection.

## Colors

### Primary

Action teal identifies the principal operation. Deep teal navigation establishes a stable frame around the work.

### Neutral

Cool paper is the canvas; white surfaces hold records. Ink supplies primary text, muted ink supports context and fine separators organize rows. These values are extracted from `src/polyagent/styles.css`; the frontmatter is the recorded token layer.

**The Evidence Rule.** Use words and records to explain state; color reinforces the explanation.

## Typography

The body and operational headings use the native System/PingFang stack in the frontmatter. There is no separate display family. Section titles use the title role, table content uses the table role, and the app enables tabular numerals globally. Supporting labels vary between 10–13px in the desktop implementation; preserve legibility when adding content.

**The Native Reading Rule.** Keep operational headings and numbers in the native UI family, with tabular numerals for comparisons.

## Layout

The desktop shell uses a 204px navigation rail and a flexible main area. Main padding is 30px 34px 16px, with a maximum content width of 1900px. The trading workspace pairs a flexible table with a 310px detail panel and a 23px gap. Settings group fields in four columns.

At 1200px and below, the rail becomes 180px, work/detail sections stack and settings use two columns. At 720px and below, navigation becomes a horizontal strip and the shell stacks. At 1550px and above, main side padding grows to 44px and detail width to 340px. These narrow-layout rules are implemented, but native narrow-window acceptance is NOT-VERIFIED; the reviewed desktop content viewport is 1400×868.

The main region owns vertical scrolling. Dense record tables own horizontal overflow where required; long settings pages must keep their save controls reachable.

## Elevation & Depth

Working surfaces are flat, with one-pixel separators and no ambient card shadows. Order details use Nimi Kit OverlayShell; the app's detail panel adds a directional shadow (`-12px 0 40px rgba(18, 45, 52, 0.12)`).

**The Flat Workspace Rule.** Working surfaces use borders and tone; floating order details alone use directional depth.

## Shapes

Working surfaces use the surface radius, controls the control radius, and navigation the navigation radius in the frontmatter. Small mode and state badges have tighter corners. Drawn Lucide icons use a consistent stroke vocabulary; the original app mark is geometric.

## Components

### Buttons

Nimi Kit Button supplies semantics. App overrides give ordinary actions a white surface and fine border, primary actions teal fill and white text, and stop actions a pale warm ground with explicit wording. Controls have a 36px minimum height on desktop. Hover changes the surface; disabled controls reduce opacity to 0.48 and use a blocked cursor.

### Inputs / Fields

Inputs and selects have a pale working surface, fine border and rounded control corners. Number fields keep units next to the value. Search is compact and uses readable muted placeholder text. Visible focus uses a 3px teal outline with a 3px offset. Selection, caret and scrollbars use the same palette.

### Navigation

The deep teal rail uses tinted secondary labels, a lighter active row and stable icon/text alignment. The narrow implementation moves the same destinations into a horizontal strip.

### Cards / Containers

White bordered working surfaces group records by task. Section headers use the recorded padding and a lower divider. Rows remain dense enough for comparison; the selected market receives a restrained tonal highlight.

### Mode and mandate

The mode badge and explanatory banner remain visible across pages. The mandate strip keeps running/stopped state, limits, exposure and scan/stop actions together. They represent actual state, not illustrative metrics.

### Order details and motion

Order details reuse Kit's drawer focus, Escape and return-focus behavior. Row highlights transition over 160ms with ease-out; the loading icon rotates over 1.2s while work is active. Reduced-motion styling removes app animations and transitions. Do not substitute the unused legacy overlay selector for Kit behavior.

## Do's and Don'ts

### Do:

- Do preserve the visible distinction between paper and live trading.
- Do reuse Nimi Kit controls and its protected-focus overlay behavior.
- Do retain tabular numerals, visible focus and readable secondary text.
- Do keep selected detail consistent with the visible filtered records.

### Don't:

- Don't imply a confirmed fill from an accepted or uncertain submission.
- Don't use color as the sole signal for mode or order state.
- Don't add decorative dashboard gauges or promotional display typography to operational records.
