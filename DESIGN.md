# Claude Light design system

## Direction
Operate mode. Extend the incumbent black notch, warm off-white text, terracotta buddy and small status lights. Music is led by original artwork; Tray by recognizable file thumbnails. The desktop surface is an orderly macOS-style preference window, with a persistent working preview.

## Tokens and geometry
Notch #000; inset #0a0a0a; text #f2ede7; muted #a69c93; terracotta #c97c5c. Existing status colors remain unchanged. Desktop light #f5f2ed with #ece7e0 sidebar; desktop dark #211f1d with #191817 sidebar. System sans for UI, monospace for time and file metadata. Expanded notch width 472pt, hardware width/height supplied by snapshot. Controls never occupy the camera column. Existing measured shell animates size over 260ms; view content fades over 180ms. Reduced motion disables both.

## Surfaces
Expanded navigation is below the camera: Claude, Music, Tray, then customization. Selected tab is explicit and stable. Attention is amber and remains actionable in all views. The desktop preview resembles a small landscape desktop, with the notch at its top edge and a mock Finder beneath. The preview's sample label stays outside the notch.

## Assets
Original vector record sleeves and a landscape illustration, bundled locally. These illustrate a fictional sample playlist; they do not represent a service connection or real playback.

## Boundaries
Use the same Island shell and Claude components in previews. New controls must not write the production config or affect live Claude gates. Every preview has empty/error/overflow examples. Gallery remains the exhaustive visual regression surface.
