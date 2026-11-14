# 14F: Post-PR 2 Pathfinder Profile

Baseline commit: `8f15144` (`feat: A* speed-ups in findNavPath with identical results (14F PR 2) (#409)`).  
Measured across the PR 1 golden cases (`shared/tests/fixtures/navGoldenCases.ts`, 79 `findNavPath`, 12 `closestApproach`, 4 squad `charge` validations) via function-level timing instrumentation against compiled `shared/dist`.

## 1. `findNavPath` on Standard Battlefield (44 cases)

- **Call mix:** 44 total calls — 11 direct straight-line fast-path hits, 33 A* searches.
- **Waypoints per A* search:**
  - Candidate waypoints generated (steps 3a–3d): mean `424.2`, median `422`, max `454` (~410 come from static terrain steps 3a–3c).
  - Valid waypoints after filtering: mean `417.8`, median `416`, max `443`.
- **Nodes and edges checked per A* search:**
  - Nodes expanded (`closedSet`): mean `64.1`, median `8`, p95 `375`, max `381` (bimodal: reachable paths expand ~8 nodes; unreachable/`no-route` searches expand the whole ~375-node connected component).
  - Edges within 16" (`lb` check): mean `8,372.2`, median `2,020`, p95 `42,222`, max `43,695`.
  - Edges passing lower-bound check (`current.g + dh < neighbor.g || isLadderStepSegment`): mean `5,673.4`, median `1,614`, p95 `26,356`, max `32,937`.
  - Edges passing `dropTwin` check: mean `3,968.1`, median `1,046`, p95 `18,526`, max `23,381`.
  - Edges passing `isSegmentSurfaceConstrained`: mean `2,101.5`, median `592`, p95 `10,106`, max `11,457`.
  - Edges passing `findMoveBlocker`: mean `593.5`, median `171`, p95 `3,120`, max `3,349`.
  - Edges passing `safeEdgeCost` (`classifySegment`): mean `201.5`, median `100`, p95 `817`, max `818`.

### Wall-Clock Time Breakdown in `findNavPath`

| Phase / Check | Standard Battlefield (44 cases, `1,355.8 ms`) | All Maps (79 cases, `1,569.7 ms`) | Notes |
| --- | --- | --- | --- |
| `A* safeEdgeCost` (`classifySegment`) | `506.2 ms` (`37.3%`) | `665.7 ms` (`42.4%`) | `measureElevatedGap` alone takes `405.2 ms` (`29.9%`) / `550.9 ms` (`35.1%`), re-collecting walkable surfaces and sampling every `0.1"` along elevated edges. |
| `A* findMoveBlocker` | `388.4 ms` (`28.6%`) | `402.4 ms` (`25.6%`) | Terrain checks take `243.5 ms` directly in the obstacle loop plus stair/fall helpers (`~387 ms` total); unit checks take only `1.3 ms` (`0.1%`). |
| Waypoint filtering | `159.8 ms` (`11.8%`) | `153.7 ms` (`9.8%`) | Filters all ~424 waypoints against terrain and units on every A* call (`isSegmentOnRampOrStairs` + `findMoveBlocker`). |
| `A* isSegmentSurfaceConstrained` | `112.4 ms` (`8.3%`) | `129.1 ms` (`8.2%`) | Re-scans `state.terrain` for stairs/ladders and re-collects walkable surfaces on every edge. |
| `A* lb check` (`isLadderStepSegment`) | `104.9 ms` (`7.7%`) | `118.6 ms` (`7.6%`) | Scans `state.terrain` for ladders on horizontal segments before knowing if a ladder is even nearby. |
| Waypoint generation (3a–3d) | `7.2 ms` (`0.5%`) | `7.7 ms` (`0.5%`) | Builds ~410 terrain waypoints and ~14 unit waypoints per call. |
| Clamping + `settleEnd` | `4.9 ms` (`0.4%`) | `4.3 ms` (`0.3%`) | Post-search clamping and endpoint settling. |
| Fast-path check | `3.1 ms` (`0.2%`) | `2.1 ms` (`0.1%`) | Straight-line check before A*. |
| `A* MinHeap` push/pop | `2.3 ms` (`0.2%`) | `2.2 ms` (`0.1%`) | Binary heap open set (PR 2). |
| No-route fallback | `1.4 ms` (`0.1%`) | — | Shortening direct segment when `foundTarget` is null. |
| Ladder post-step | `1.3 ms` (`0.1%`) | — | Vertical ladder alignment pass (step 5b). |
| String-pulling | `0.7 ms` (`0.1%`) | `0.5 ms` (`0.0%`) | Shortcut pass (step 5). |

### Top 10 Slowest Standard Battlefield Cases (Post-PR 2)

| Case | Category | Time |
| --- | --- | --- |
| `std-noroute-1` | `no-route` | `212.81 ms` |
| `std-noroute-3` | `no-route` | `196.11 ms` |
| `std-keep-4` | `keep-away` | `190.90 ms` |
| `std-noroute-2` | `no-route` | `171.49 ms` |
| `std-noroute-4` | `no-route` | `157.97 ms` |
| `std-stairs-3` | `stairs` | `28.95 ms` |
| `std-drop-2` | `drop` | `25.35 ms` |
| `std-stairs-4` | `stairs` | `25.17 ms` |
| `std-ladder-3` | `ladder` | `24.59 ms` |
| `std-obs-1` | `obstacle` | `22.97 ms` |

## 2. `closestApproach` (12 cases)

| Case | Total Time | `findNavPath` calls | Fast-path hits | A* searches |
| --- | --- | --- | --- | --- |
| `ca-single-open-contact` | `19.1 ms` | `9` | `7` | `2` |
| `ca-single-clamped` | `34.3 ms` | `5` | `0` | `5` |
| `ca-single-round-wall` | `70.0 ms` | `9` | `0` | `9` |
| `ca-single-round-wall-long` | `61.3 ms` | `9` | `0` | `9` |
| `ca-single-up-stairs-deck` | `315.3 ms` | `18` | `0` | `18` |
| `ca-single-up-ladder-deck` | `1,656.2 ms` | `18` | `0` | `18` |
| `ca-single-tall-deck-stays` | `1,250.5 ms` | `18` | `0` | `18` |
| `ca-squad-coherency-held` | `63.8 ms` | `9` | `0` | `9` |
| `ca-squad-round-wall` | `1,196.4 ms` | `18` | `0` | `18` |
| `ca-squad-up-stairs` | `1,086.5 ms` | `36` | `0` | `36` |
| `ca-squad-avoids-hazard` | `0.5 ms` | `9` | `7` | `2` |
| `ca-squad-6-target-difficult` | `5,027.8 ms` | `54` | `11` | `43` |

## 3. Squad Charge `validateAction` (4 cases)

| Case | Total Time | `findNavPath` calls (fast / A*) | Inside `findNavPath` |
| --- | --- | --- | --- |
| `charge-valid-4v3` | `2,608.0 ms` | `38` (`16` / `22`) | `2,604.6 ms` (`wpFilter 85.8`, `lb 246.3`, `surf 223.9`, `blk 783.7` [terr `492.5`, unit `0.9`], `cost 1,124.9`) |
| `charge-rejected-could-get-closer` | `3,619.3 ms` | `54` (`20` / `34`) | `3,616.3 ms` (`wpFilter 134.2`, `lb 335.9`, `surf 304.0`, `blk 1,080.3` [terr `683.6`, unit `1.8`], `cost 1,550.0`) |
| `charge-6v6-round-terrain` | `10,879.3 ms` | `108` (`0` / `108`) | `10,874.4 ms` (`wpFilter 415.7`, `lb 1,042.8`, `surf 1,029.8`, `blk 3,200.9` [terr `2,003.1`, unit `4.4`], `cost 4,573.2`) |
| `charge-10v5-stress` | `20,896.4 ms` | `217` (`78` / `139`) | `20,890.2 ms` (`wpFilter 531.4`, `lb 1,842.3`, `surf 1,829.4`, `blk 6,059.7` [terr `3,837.4`, unit `8.8`], `cost 9,533.2`) |

### Key Takeaways
1. **99.9%+ of squad charge validation time is spent inside `findNavPath`**, and **99.7% of A* blocker time is terrain**, whereas unit blocking is only `1.3 ms` across all 44 Standard Battlefield searches (`4.4 ms` across all 108 A* searches in `charge-6v6-round-terrain`).
2. **Repeated per-call terrain scanning dominates everything else:** `safeEdgeCost` (`37.3%`), terrain checks in `findMoveBlocker` (`28.5%`), waypoint filtering (`11.8%`), `isSegmentSurfaceConstrained` (`8.3%`), and `isLadderStepSegment` (`7.7%`) together account for ~**93.6%** of `findNavPath` time on the Standard Battlefield, even though `state.terrain` is identical across calls during a match or a single squad charge validation.
3. **Worst-case searches are unreachable/no-route candidates** (especially in `closestApproach`, which tests unreachable candidates against tall decks or blocked walls): A* expands the full ~375-node connected component and tests tens of thousands of edges.

## 4. Ideas (not decided)

- **Precompute per-terrain geometry cache (`getTerrainGeom`):** Key by `state.terrain` content (fast numeric checksum + WeakMap + canonical piece descriptor string) and precompute `allSurfaces`, `ladders`, `rampsAndStairs`, `stairByPiece`, `obstaclePieces` (including world XZ bounding boxes for quick AABB rejection), and `fallPieces`. Wire `collectWalkableSurfaces`, `getStairSurfaceHeight`, `isSegmentOnRampOrStairs`, `isSegmentOnLadder`, `findLadderForSegment`, `isLadderStepSegment`, `isShortLadderDescentStep`, and `isFallColumnBlocked` to read this cache instead of rescanning `state.terrain` per segment.
- **Split `findMoveBlocker` into `findTerrainSegmentBlocker` and `findUnitSegmentBlocker`:** Separates deterministic terrain collisions from dynamic unit separation/`keepAway` checks without altering behavior, letting static terrain edge results be reused while units are still checked fresh per search.
- **Reuse the terrain visibility graph & edge costs in `findNavPath`:** Cache the static waypoints (steps 3a, 3b `deckPts`/`fixedWps`, and 3c) and a lazily populated terrain-only edge cost matrix (`ptEdgeMatrix`) keyed by terrain geometry, board half-extents, and movement traits (`flying`, `strider`). Splice dynamic `[from, target]` drop spots immediately after each surface's fixed drop spots to keep `allNodes` index order and `MinHeap` tie-breaking identical to existing golden snapshots.
