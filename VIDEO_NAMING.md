# 360 Video Naming Convention

Universal naming scheme for 360 walkthrough videos across all buildings.

## Pattern

| Type | Pattern | Example |
|------|---------|---------|
| Corridor | `{building}_cor_{floor}F_{segment}_{fwd\|rev}.mp4` | `eng1_cor_1F_01_fwd.mp4` |
| Stairs | `{building}_str_{stairId}_{up\|down}.mp4` | `eng1_str_1_up.mp4` |
| Elevator | `{building}_elv_{elevId}_{floor}F.mp4` | `eng1_elv_1_1F.mp4` |

## Fields

- **building**: Building code (`eng1`, `eng2`, `sci1`, `bio`, etc.)
- **floor**: Floor number (`1F`, `2F`, ..., `5F`)
- **segment**: 2-digit corridor segment index per floor (`01`, `02`, `03`). Numbered sequentially along the graph edge traversal order.
- **fwd / rev**: Forward follows graph edge direction (from -> to). Reverse is the opposite.
- **stairId / elevId**: Integer ID, consistent across all floors (stair 1 on 1F is the same physical staircase as stair 1 on 5F).

## Directory Structure

```
videos/
  eng1/
    eng1_cor_1F_01_fwd.mp4
    eng1_cor_1F_01_rev.mp4
    eng1_cor_1F_02_fwd.mp4
    ...
    eng1_str_1_up.mp4
    eng1_str_1_down.mp4
    eng1_elv_1_1F.mp4
    eng1_elv_1_2F.mp4
  eng2/
    eng2_cor_1F_01_fwd.mp4
    ...
```

## Migration from Current Naming

Current eng1 videos use wing-based naming (`eng1_corridor_21_1F_cw.mp4`).

Mapping to new convention:

| Old | New | Notes |
|-----|-----|-------|
| `eng1_corridor_21_1F_cw.mp4` | `eng1_cor_1F_01_fwd.mp4` | Wing 21 -> segment 01 (depends on graph order) |
| `eng1_corridor_21_1F_ccw.mp4` | `eng1_cor_1F_01_rev.mp4` | cw -> fwd, ccw -> rev |
| `eng1_corridor_22_1F_cw.mp4` | `eng1_cor_1F_02_fwd.mp4` | Wing 22 -> segment 02 |
| `eng1_stair_1_up.mp4` | `eng1_str_1_up.mp4` | Abbreviated |
| `eng1_elev_1_1F.mp4` | `eng1_elv_1_1F.mp4` | Abbreviated |

The exact segment numbering for each building is determined when the navigation graph is built. Document the mapping in a `video_manifest.json` per building:

```json
{
  "building": "eng1",
  "segmentsPerFloor": {
    "1": ["01", "02", "03"],
    "2": ["01", "02", "03"],
    "3": ["01", "02", "03"]
  },
  "stairs": [1, 2, 3, 4],
  "elevators": [1, 2]
}
```
