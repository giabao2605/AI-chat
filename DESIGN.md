---
name: AI Conversation Lab
description: Neutral dark conversation workspace for personal desktop use.
colors:
  bg: "#212121"
  panel: "#181818"
  panel-2: "#2b2b2b"
  line: "#383838"
  text: "#ececec"
  text-soft: "#cccccc"
  muted: "#ababab"
  surface-hover: "#363636"
  stroke-strong: "#575757"
  accent-strong: "#ffffff"
  accent-soft: "#303030"
  accent-ring: "#777777"
  danger: "#ffaaa5"
  primary-ink: "#171717"
typography:
  body:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "14px"
  conversation:
    fontSize: "16px"
    lineHeight: 1.75
    letterSpacing: "normal"
  headline:
    fontSize: "clamp(25px, 2.5vw, 34px)"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.025em"
  label:
    fontSize: "13px"
    fontWeight: 500
rounded:
  field: "8px"
  action: "10px"
  conversation: "16px"
  chip: "20px"
spacing:
  compact: "8px"
  field: "12px"
  section: "16px"
  canvas: "24px"
components:
  empty-action-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.field}"
    padding: "0 18px"
  empty-action-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  field:
    rounded: "{rounded.field}"
    padding: "10px 12px"
    textColor: "{colors.text}"
  composer:
    backgroundColor: "{colors.accent-soft}"
    rounded: "{rounded.conversation}"
    padding: "10px"
---

# Design System: AI Conversation Lab

## Overview

The user-approved reference is ChatGPT: neutral charcoal, a darker sidebar, restrained controls and a readable transcript. This is a personal entertainment workspace, primarily used on desktop. Typography and spacing carry the hierarchy; decoration stays quiet.

Key characteristics: system sans-serif, flat tonal surfaces, white primary actions and text labels. Source: `public/modern-theme.css`, loaded after the feature styles in `public/index.html`. These are extracted implementation values, not a replacement stylesheet.

## Colors

Primary actions use `text`, brightening to `accent-strong` on hover. The neutral canvas uses `bg`; the sidebar uses `panel`; secondary panels use `panel-2`. `accent-soft` contains the composer and user messages. `text-soft` supports control labels; `muted` supports metadata. Quiet borders use `line`, strengthening to `stroke-strong` on interaction. `danger` is reserved for destructive actions and failures. Existing success and warning colors remain semantic exceptions.

## Typography

Use the body system font throughout. Conversation text uses the larger conversation role; metadata is 11–12px, control labels 12–13px. Empty-state headings use the headline role. Transcript text drops to 15px below the narrow breakpoint. Preserve Vietnamese text and explicit control labels.

## Layout

The desktop workspace has no outer gutter. The sidebar is 296px, reducing to 272px between 901px and 1100px. Transcript and composer share an 808px maximum reading width. The composer leaves 24px on each side and below on desktop.

At 900px and below, settings use two columns and the chat panel has a 620px minimum height and 90dvh height. At 620px and below, settings stack, transcript side padding is 16px, and composer controls wrap. Preserve sidebar collapse/reopen behavior and keep overflow within readable regions.

## Elevation & Depth

Most surfaces have no shadow or backdrop blur. Tonal changes and fine borders separate regions. Drawers alone use the existing `--shadow` token (`0 16px 48px #00000040`); backdrops use translucent black. Avoid lifting ordinary buttons or messages.

## Shapes

Fields and ordinary buttons use the field radius. Start/send actions and history rows use the action radius; composer and user bubbles use the conversation radius. Suggestions are pill-like chips; participant avatars remain circular. Assistant messages remain unboxed.

## Components

- Buttons: white primary actions, transparent secondary controls, text-led destructive controls. Disabled buttons use .42 opacity. Hover changes color and surface without translation.
- Fields: 42px minimum height, dark fill and a subtle border. Focus uses an explicit gray outline. Keyboard-focusable buttons, links, summaries and tab stops use a 2px text-colored outline with 3px offset.
- Composer: a rounded tonal container; its border strengthens on focus within. Input remains transparent and send stays an explicit text action.
- Transcript: 16px text with generous line height, 32px participant avatars and 36px between messages. User messages have a tonal bubble; assistant messages use the canvas directly.
- History and inspectors: neutral drawers with quiet rows and tonal hover/selected states. Keep existing inspection, history and scenario functions available.

Button state transitions use .15s ease. Reduced-motion preference shortens transitions and animations to .01ms and disables smooth scrolling.

## Do's and Don'ts

- Do reuse the existing neutral tokens and vanilla HTML/CSS/JavaScript components.
- Do retain visible keyboard focus, readable metadata and text labels.
- Do distinguish statuses with meaningful text as well as existing semantic colors.
- Don't add gradients, neon decoration, icons or new features as part of styling.
- Don't introduce dependencies for this visual system or remove existing capabilities without user approval.
