# 360 Video Naming Convention

Universal naming scheme for 360 walkthrough videos across all buildings.

## Pattern

| Type | Pattern | Example |
|------|---------|---------|
| Corridor | `{building}_c_F{floor}_{id}_{cw\|ccw}.mp4` | `eng1_c_F1_1_cw.mp4` |
| Stairs | `{building}_s_{stairId}_{floor}{e\|o}{u\|d}.mp4` | `eng1_s_1_1eu.mp4` |
| Elevator | `{building}_e_{elevId}_{floor}{e\|o}.mp4` | `eng1_e_1_1e.mp4` |

## Fields

- **building**: Building code (`eng1`, `eng2`, etc.)
- **floor**: Floor number (`1`, `2`, ..., `5`)
- **id**: Corridor segment index per floor, numbered sequentially
- **cw / ccw**: Clockwise / counter-clockwise direction
- **stairId / elevId**: Physical staircase/elevator number (consistent across all floors)
- **e / o**: Enter (들어가기) / Out (나가기)
- **u / d**: Up (올라가기) / Down (내려가기) — stairs only

## Stair Video Logic

Going from floor X to floor Y via stair N:

| Direction | Entry clip | Exit clip |
|-----------|-----------|----------|
| X → Y (up) | `{building}_s_{N}_{X}eu.mp4` | `{building}_s_{N}_{Y}ou.mp4` |
| X → Y (down) | `{building}_s_{N}_{X}ed.mp4` | `{building}_s_{N}_{Y}od.mp4` |

Examples:
- 1F→2F via stair 1: entry=`eng1_s_1_1eu.mp4`, exit=`eng1_s_1_2ou.mp4`
- 3F→1F via stair 1: entry=`eng1_s_1_3ed.mp4`, exit=`eng1_s_1_1od.mp4`

Available clips per floor:
- Floor 1 (bottom): `1eu`, `1od`
- Floor 2-4 (middle): `{f}eu`, `{f}ed`, `{f}ou`, `{f}od`
- Floor 5 (top): `5ed`, `5ou`

## Elevator Video Logic

Going from floor X to floor Y via elevator N:

| Entry clip | Exit clip |
|-----------|----------|
| `{building}_e_{N}_{X}e.mp4` | `{building}_e_{N}_{Y}o.mp4` |

Examples:
- 1F→5F via elevator 1: entry=`eng1_e_1_1e.mp4`, exit=`eng1_e_1_5o.mp4`
- 5F→1F via elevator 1: entry=`eng1_e_1_5e.mp4`, exit=`eng1_e_1_1o.mp4`

## eng1 Building

- 4 staircases (stairId: 1-4)
- 2 elevators (elevId: 1-2)
- 5 floors (1-5)
- 3 corridor segments per floor
