# Tactical RPG grass terrain textures

Six square, flat, alpha-capable top-surface PNG textures for procedural hex-map
clipping. Their alpha coverage is deliberately opaque edge-to-edge: a seamless
terrain texture cannot have transparent gaps without exposing the map beneath it.
The renderer should apply hex clipping and dynamic lighting after sampling these
source textures.

| File | Variation |
| --- | --- |
| `grass-01-quiet.png` | Quiet, nearly plain short grass |
| `grass-02-dense.png` | Slightly darker, denser grass |
| `grass-03-dry-flecks.png` | Sparse blades with warm dry flecks |
| `grass-04-mossy.png` | Soft mossy patches |
| `grass-05-worn.png` | Very subtle flattened-grass wear |
| `grass-06-pebbles.png` | Sparse small pebbles and grass variation |

All files are square 1254 × 1254 RGBA PNGs and use mirrored wrap construction to
match opposing edges exactly. They contain no hex silhouette, grid, text, UI
marker, unit shadow, selection state, or baked directional lighting.
