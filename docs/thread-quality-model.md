# Thread reception model (review draft)

Code: `custom_components/meshroute_topology_explorer/frontend/engines/thread/quality.js`; tests:
`tests/engine-thread-quality.test.mjs`. Not wired into the map yet. Basis: "colour by reception" for Thread uses
RSSI, and a reviewable model comes first.

## 1. What the data carries

- Per direction, Home Assistant's `matter/network_topology` gives `{ strength, lqi, rssi }`. `source_to_target` is
  measured at the source (spec 3.2). An unreported direction is `null` [S9].
- `lqi` is Thread link quality 0–3 on OpenThread [S9, S1]. `rssi` is the neighbour RSSI in dBm "when available" [S9].
  The matter.js server forwards `rssi = neighbor.avgRssi ?? neighbor.lastRssi`, the last RSSI only as fallback
  (`topology-utils.ts`, lines 585 and 898 [S9]). The Matter neighbour table carries both [S11, S3].
- `strength` is "Thread: LQI 0–3 → none / weak / medium / strong" [S9]: link quality renamed. `none` is link quality
  0, which the stack still lists; `unknown` means "no measurement". The connection-level `strength` is the strongest
  direction, a summary "for simple renderers" [S9].
- Also present: `path_cost` ("1 = direct") and `via_route_table` [S9]. Not carried: noise floor, link margin, entry
  age (the cluster's Age), frame and message error rates, TX power.

## 2. What the radio stack does with these values

- **Link quality comes from the link margin**: average RSSI minus the radio's receive-sensitivity constant, which
  OpenThread uses as noise floor (`otPlatRadioGetReceiveSensitivity` [S7]; `mac.hpp` GetNoiseFloor "currently use
  the radio receive sensitivity value"; `link_quality.cpp` ComputeLinkMargin [S14]). `kThreshold3/2/1` = 20 / 10 /
  2 dB with 2 dB hysteresis (`link_quality.hpp` [S14]; also [S1]): more than 20 dB → 3; more than 10 dB → 2; more
  than 2 dB → 1; otherwise 0.
- `RssAverager` averages the RSSI: mean of the first 8 samples, then a 1/8 exponential average; invalid when empty
  [S14]. Silicon Labs: "RSSI is mapped to a link quality from 0 to 3" [S2].
- **Link cost** is 4, 2 and 1 for link quality 1, 2 and 3; link quality 0 is the maximum route cost
  (`link_quality.hpp` [S14]). Secondary sources give other numbers; the model does not use them.
- **Routing uses both directions.** The router link cost uses the two-way link quality, the minimum of incoming and
  outgoing (`router_table.cpp` GetLinkCost, `router.hpp` [S14]); "asymmetric link costs are common in 802.15.4
  networks" [S2]. The Link Request margin (10 dB) is checked one-way, on the advertisement's average RSS.
- **Router links.** OpenThread attempts a link to a neighbouring router only with at least 10 dB margin
  (`OPENTHREAD_CONFIG_MLE_LINK_REQUEST_MARGIN_MIN`, default 10); the same applies before merging partitions [S6]. A
  REED or FED keeps about 3 router links (`CHILD_ROUTER_LINKS`) [S6].
- **Parent selection.** The first Parent Request round goes to routers only and accepts only two-way link quality 3;
  then ordered `IsBetterParent` criteria decide [S8, S14]. An attached MTD child keeps its parent until the link
  breaks. Periodic parent search is off by default on MTD builds; where enabled, it triggers below an average parent
  RSSI of −65 dBm, every 540 s with a 36 000 s backoff [S15]. `CHILD_TIMEOUT_DEFAULT` is 240 s. A sleepy or minimal
  end device has exactly one neighbour entry: its parent.
  - The stack's own "weak parent" line is therefore −65 dBm, where parent search is enabled.
  - The model's low band means something else: below what the stack attaches to in round 1 or links to as a router.
- **RSSI 127** is `OT_RADIO_RSSI_INVALID`, "invalid or unknown RSSI value" [S5].
- **Receiver sensitivity constant.** The nRF528xx port returns −100 dBm (`ot-nrf528xx` `radio.c`); the Zephyr default
  is −100 dBm [S14]. EFR32, ESP and TI constants are unverified. On those radios, −80 and −90 dBm are the stack's own
  link quality 3 and 2 limits, not a convention.
- Energy detection must be accurate to ±6 dB [S13].

## 3. Rules

**(a) Bands per direction.** Each band comes from RSSI, capped by the receiver's own link quality. The limits are the
link-quality margins on a constant of −100 dBm (section 2).

| Band | RSSI at the receiver | Link-quality equivalent | Reason |
|---|---|---|---|
| high | above −80 dBm | 3 (margin > 20 dB) | The stack's top class, lowest link cost |
| mid | −89 to −80 dBm | 2 (margin 10–20 dB) | Usable; the stack still sets up router links here |
| low | −90 dBm or below | 1 or 0 (margin ≤ 10 dB) | Below OpenThread's minimum margin for a new router link [S6] |

- **Cap.** Where RSSI and the receiver's link quality both exist, the band is the lower of the RSSI band and the
  link-quality band (3 → high, 2 → mid, 1 → low); the receiver's class accounts for its own sensitivity constant.
  Details basis text: "−75 dBm, link quality 2 (the receiver's own class)" (`basis` "lq cap"; "rssi" where RSSI
  decides, "lq" without RSSI).
- **Fallback.** RSSI missing or 127: link quality 3, 2 or 1 gives high, mid or low.
- **Link quality 0.** With a valid RSSI (not 127, not null) it is a measured low reading: band low, basis "rssi"; the
  stack lists such a neighbour. Without a valid RSSI (a fresh entry without samples) it gives no band and counts as
  "listed without a live link" (d3).
- **No value** gives no band (unknown look). The model never invents a value and never draws a weak link where the
  value is unknown.
- **Edges.** A limit belongs to the weaker band, as in the link-quality rule. The model has no hysteresis (the stack
  has 2 dB): a value at −80 or −90 dBm may change band between snapshots, which the number at the arrow shows.
- **Implied or unknown directions get no band.** An unmeasured parent link stays "implied".
- **Width and colour** both follow the band: three looks. `laneLook()` returns a stroke level of 1/6, 1/2 or 5/6,
  one width step each of the shared `laneStyle()` and three fixed points on the existing colour scale. The level is
  not a rank; `rating` stays null.
- **Texts for later wiring (no UI change yet).** Thread colour text: "Colour shows fixed dBm bands at the stack's
  link-quality limits (−80 / −90 dBm), not a rank". Pickers: "low / mid / high band".

**(b) Absolute, not relative per receiver.**

- RSSI is a physical unit, and the limits are where the receiving stack changes its own link quality, so the colour
  agrees with what the network uses for routing cost.
- Zigbee ranks per reporter because vendor LQI scales differ. A rank needs ten readings (spec 5.4); Thread tables hold
  one to five (a router a handful of neighbours, a sleepy end device only its parent). A rank over so few values would
  paint the weaker of two −40 dBm links "low".
- **Limit.** On a radio with another sensitivity constant, the stack's limits sit elsewhere than −80 / −90 dBm.
- **Safety valve.** The cap takes the receiver's own link quality into account. Where RSSI band and link quality are
  two bands apart, a hint says the colour may mislead for that receiver (d4).
- **Sample check.** All 8 readings in the sample agree with a floor between −105 and −97 dBm: −85 dBm comes with link
  quality 2, −77 to −21 dBm with 3.

**(c) Values shown.**

- **At the arrow:** RSSI as "−85 dBm" (the existing `threadValue`); without RSSI "LQ 2"; without either, the unknown
  glyph.
- **Details:** RSSI, link quality, band and basis ("from RSSI", "from link quality", or "−75 dBm, link quality 2
  (the receiver's own class)" where the cap applied).
- **Server `strength`:** neither used nor shown. It is link quality renamed [S9], its connection-level summary hides
  the weaker direction, and `engines/thread/from-matter.js` already treats its `none` and `unknown` as not measured.

**(d) Findings and hints.**

**d1. Weak parent link (finding).**

- **Raised when:** an available end device and its available parent have a link with either direction in the low
  band.
- **Example:** "Its parent Router 01 hears this device at −93 dBm (link quality 1), at or below −90 dBm. This device
  hears its parent at −70 dBm."
- **Why:** every poll of an end device crosses this link; a sleepy end device pays for a weak one in retries and
  battery.

**d2. Weak router links (finding).**

- **Raised when:** an available router whose own table was read has every link to another router or border router in
  the low band; the weaker known direction of each link counts.
- **Example:** "Every link of this router to another router is in the low band. Router 02 hears it at −92 dBm, and it
  hears Router 02 at −91 dBm. This is its only router link."
- **Why:** this router's share of the mesh, and its children, rest on links below the margin at which OpenThread
  would set up a new router link.

**d3. Listed by one side (hint).**

- **Raised when:** a neighbour lists the device with a live reading, and the device's own table, read in the same
  snapshot, has no entry or only a dead one. Never raised against a border router, which has no table.
- **Example:** "Router 01 lists this device (−60 dBm, link quality 3). This device's neighbour table does not list
  Router 01. The two tables are of unknown age, possibly hours apart, so the entry may have aged out."
- **Timing.** `refresh: false` returns the server's cache; the cluster's Age and error rates are not forwarded, so
  each table's age is unknown.
- **Own entry "listed without a live link":** only link quality 0 without a valid RSSI. Link quality 0 with a valid
  RSSI is a live low reading.
- **Why:** a stale child entry, or a router link set up on one side only. A hint, not a verdict.
- **Parent of an end device** (`engines/thread/model.js`): a sleepy or minimal end device has one neighbour entry,
  its parent. Where the child's own table was read, the parent is the router it lists; the routers' readings decide
  only when the child reported nothing. Other routers listing the child are "possibly stale". For a REED or FED, the
  other routers in its table are real links, not stale parents.

**d4. Signal and link quality disagree (hint).**

- **Raised when:** one reading's RSSI band and link-quality band are two bands apart, for example −60 dBm with link
  quality 1.
- **Example:** "This device rates its reading of Router 02 at link quality 1, although the RSSI is −60 dBm. The two
  disagree by two bands. The cause is not known from the snapshot."
- **Possible causes:** another sensitivity constant on that radio, a non-OpenThread stack, or RSSI and link quality
  from different samples. The text does not blame interference.
- **Why:** the one place where the absolute scale can be checked against the receiver itself. With the cap, the lane
  already shows the lower band.

**Not raised:**

- **Asymmetry alone.** It is common [S2]; it is drawn as two lanes and judged only through d1 and d2.
- **Zigbee kinds.** "Weak reception", "very low reading", "data incomplete" and the table findings.

**(e) What stays unknown.**

- Whether a given `rssi` is the average or the fallback last RSSI (the server does not say).
- Each receiver's noise floor and each sender's TX power.
- Entry age and error rates (the cluster's Age and error counters are not forwarded).
- Which other routers a sleepy end device could hear: its table holds only its parent, so no "better parent" can be
  named.
- The border router's own view of its links.
- Next hops and routes.
- The radio's actual sensitivity constant (the model assumes −100 dBm).

## 4. Example: the anonymized sample (`tests/fixtures/matter-sample.json`)

Node ids as in the fixture. "A hears B" is measured at A.

| Link | A hears B | B hears A | Bands (A, B) | Note |
|---|---|---|---|---|
| leader 14 – SED 16 (parent link) | −85 dBm, LQ 2 | −75 dBm, LQ 3 | mid, high | weaker direction mid: no finding |
| leader 14 – router 15 | −36 dBm, LQ 3 | −36 dBm, LQ 3 | high, high | |
| leader 14 – border router | −75 dBm, LQ 3 | not reported | high, none | border router has no table |
| router 15 – SED 18 (parent link) | −77 dBm, LQ 3 | −21 dBm, LQ 3 | high, high | 56 dB asymmetry, cause unknown |
| router 15 – border router | −69 dBm, LQ 3 | not reported | high, none | |

Result: one mid lane, seven high lanes, no findings and no hints (test "the sample raises no quality finding or
hint").

## 5. Notes for wiring into the engine

- The leader and the border routers are always labelled; they are the Thread engine's `anchors`.
- The Thread View tab hides the Zigbee-only groups. "Colour by reception" stays and uses `laneLook().level`.
- **Legend:** three rows, one per band, labelled with the dBm limits, for example "above −80 dBm (link quality 3)",
  without a judgement word.
- **`springQuality`:** proposed as the band level, link quality as fallback; null without a band.

## 6. Open questions for the owner

1. **Lane width by band (recommended) or by RSSI rank, as board M24 says.** Example: links at −40 and −45 dBm. By
   band both get the widest stroke; by rank per receiver the −45 dBm link gets the thinnest. Band keeps width and
   colour telling the same thing.
2. **Decided: fixed constant of −100 dBm, capped by the receiver's own link quality.** Example: −75 dBm with link
   quality 2 gives mid (cap), and nothing is flagged, as the two are one band apart; d4 catches the large cases.
   Revisit when more captures exist.
3. **"Listed by one side" as a hint (recommended), a finding, or not at all.** Example: Router 01 lists Router 02,
   and Router 02's table, read seconds later, does not list Router 01. As a hint it shows with "may have aged out"; as
   a finding it would count as a judged problem.
4. **Hint d4 in the Findings tab (recommended) or in debug mode only.** Example: one receiver rates −60 dBm as link
   quality 1. In the Findings tab every user sees the disagreement; in debug mode only those who debug see it.

## Sources (public documentation, read 2026-11-01)

- [S1] OpenThread API documentation of `LinkQualityInfo::GetLinkQuality()`, quoted on Nordic DevZone:
  https://devzone.nordicsemi.com/f/nordic-q-a/127154/thread-network-diagnostics-cluster-always-reports-very-low-lqi/562120
- [S2] Silicon Labs, Thread Fundamentals, Routing and Network Connectivity:
  https://docs.silabs.com/openthread/2.7.0/thread-fundamentals/05-routing-and-network-connectivity
- [S3] openthread.io, `otNeighborInfo` (`mAverageRssi` "Average RSSI", `mLastRssi` "Last observed RSSI",
  `mLinkMargin`): https://openthread.io/reference/struct/ot-neighbor-info
- [S5] openthread.io, radio types, `OT_RADIO_RSSI_INVALID` = 127: https://openthread.io/reference/group/radio-types
- [S6] openthread.io, MLE configuration: https://openthread.io/reference/config/group/config-mle
- [S7] openthread.io, radio configuration, `otPlatRadioGetReceiveSensitivity`:
  https://openthread.io/reference/group/radio-config
- [S8] openthread.io, Thread primer, network discovery and formation:
  https://openthread.io/guides/thread-primer/network-discovery
- [S9] matter.js server, `packages/ws-client/src/models/model.ts`, field documentation of `TopologyStrength`,
  `TopologyDirectionInfo` and `NetworkTopologyConnection`; schema 13 in `docs/websocket-api-schema-changelog.md`:
  https://github.com/matter-js/matterjs-server
- [S11] Apple Matter framework, `MTRThreadNetworkDiagnosticsClusterNeighborTableStruct` (`averageRssi`, `lastRssi`,
  `lqi`): https://developer.apple.com/documentation/matter/mtrthreadnetworkdiagnosticsclusterneighbortablestruct
- [S13] Nordic nRF52840 product specification, radio chapter (energy detection ±6 dB, an IEEE 802.15.4 requirement):
  https://docs.nordicsemi.com/bundle/ps_nrf52840/page/radio.html
- [S14] OpenThread source, read for semantics only: `link_quality.hpp` / `link_quality.cpp` (thresholds, link
  costs, `RssAverager`, ComputeLinkMargin), `mac.hpp` (GetNoiseFloor), `router_table.cpp` / `router.hpp`
  (GetLinkCost), `ot-nrf528xx` `radio.c` (−100 dBm), Zephyr OpenThread platform default (−100 dBm):
  https://github.com/openthread/openthread
- [S15] openthread.io, parent search configuration (`config-parent-search`):
  https://openthread.io/reference/config/group/config-parent-search
- Not public: the Thread specification text. Its thresholds are taken from [S1], which quotes it.
