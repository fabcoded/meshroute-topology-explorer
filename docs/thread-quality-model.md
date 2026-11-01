# Thread reception model (review draft)

Brief tq, 2026-11-01. Code: `custom_components/meshroute_topology_explorer/frontend/engines/thread/quality.js`,
tests: `tests/engine-thread-quality.test.mjs`. Not wired into the map yet; the engine refactor will do that.
Owner decisions this builds on: "colour by reception" for Thread is built on RSSI; a reviewable model comes first.

## 1. What the data carries

- Per direction, Home Assistant's `matter/network_topology` gives `{ strength, lqi, rssi }`. `source_to_target` is
  measured at the source (spec 3.2). A direction the node did not report is `null` [S9].
- `lqi` is Thread link quality 0–3 on OpenThread [S9, S1]. `rssi` is the neighbour RSSI in dBm "when available" [S9].
  The documentation does not say whether this is the average or the last RSSI. The Matter neighbour table carries
  both [S11, S3].
- `strength` is "Thread: LQI 0–3 → none / weak / medium / strong" [S9], so it is link quality under another name.
  `none` means "observed dead" and `unknown` means "no measurement". The connection-level `strength` is the
  strongest direction, a summary "for simple renderers" [S9].
- Also present: `path_cost` ("1 = direct") and `via_route_table` [S9]. Not carried: noise floor, link margin, entry
  age, frame or message error rates, and TX power.

## 2. What the radio stack does with these values

- **Link quality comes from the link margin**, which is the average RSSI above the receiver's noise floor. Thresholds
  [S1, "per Thread spec"]:
  - more than 20 dB → link quality 3;
  - more than 10 dB → 2;
  - more than 2 dB → 1;
  - 2 dB or less → 0.

  A 2 dB hysteresis applies [S1]. Silicon Labs says the same in words: "RSSI is mapped to a link quality from 0 to
  3", and "a value of 0 means unknown cost" [S2].
- **Routing uses both directions.** "Routing cost is based on bidirectional link quality", and "asymmetric link costs
  are common in 802.15.4 networks" [S2].
- **Router links.** OpenThread attempts a link to a neighbouring router only with at least 10 dB margin
  (`OPENTHREAD_CONFIG_MLE_LINK_REQUEST_MARGIN_MIN`, default 10). The same 10 dB applies before merging partitions
  [S6]. A REED or FED keeps about 3 router links (`CHILD_ROUTER_LINKS`) [S6].
- **Parent selection.** The Parent Response carries the candidate's link margin and connectivity, and the child
  chooses [S8]. The public documentation gives no numeric rule beyond that.
- **RSSI 127** is `OT_RADIO_RSSI_INVALID`, "invalid or unknown RSSI value" [S5].
- **Receiver sensitivity.**
  - The radio reports its receive sensitivity in dBm [S7].
  - IEEE 802.15.4 at 2.4 GHz requires only −85 dBm [S12, secondary].
  - Real chips reach about −98 to −104 dBm. CC2520 −98 dBm is confirmed [S12]; other parts are unverified.
  - Energy detection must be accurate to ±6 dB [S13].

## 3. Rules

**(a) Bands per direction.** Each band comes from RSSI. The limits are the link-quality margins on a nominal noise
floor of −100 dBm.

| Band | RSSI at the receiver | Link-quality equivalent | Reason |
|---|---|---|---|
| high | above −80 dBm | 3 (margin > 20 dB) | The stack's own top class, link cost lowest |
| mid | −89 to −80 dBm | 2 (margin 10–20 dB) | Usable; the stack still sets up router links here |
| low | −90 dBm or below | 1 or 0 (margin ≤ 10 dB) | Below OpenThread's minimum margin for a new router link [S6] |

- **Fallback.** Where RSSI is missing or 127, link quality 3, 2 or 1 gives high, mid or low.
- **No value.** Link quality 0 or no value at all gives no band (unknown look). The model never invents a value and
  never draws a weak link where the value is unknown.
- **Edges.** A limit belongs to the weaker band, as in the link-quality rule. There is no hysteresis. A value at
  −80 or −90 dBm may change band between snapshots; the number shown at the arrow makes that visible.
- **No band for implied or unknown directions.** A parent link that no one measured stays "implied", with no band.
- **Width and colour** both follow the band: three looks. `laneLook()` returns a stroke level of 1/6, 1/2 or 5/6. This
  places each band in its own width step of the shared `laneStyle()` and gives three fixed points on the existing
  colour scale. The level is not a rank, and `rating` stays null.

**(b) Absolute, not relative per receiver.**

- RSSI is a physical unit, and the limits are where the receiving stack changes its own link quality. The colour then
  agrees with what the network itself uses for routing cost.
- Zigbee ranks per reporter because vendor LQI scales differ, and needs ten readings for a rank (spec 5.4). A Thread
  router reports a handful of neighbours, and a sleepy end device reports only its parent. A rank over one to five
  values would paint the weakest of two −40 dBm links as "low".
- **Limit.** Receivers differ in noise floor by several dB. The band edges are therefore a convention, not a verdict.
- **Safety valve.** The receiver's own link quality already accounts for its own noise floor. Where the RSSI band and
  the link quality are two bands apart, a hint says the colour may mislead for that receiver (rule d4).
- **Sample check.** All 8 readings in the sample agree with a floor between −105 and −97 dBm: −85 dBm comes with
  link quality 2, and −77 to −21 dBm with 3.

**(c) Values shown.**

- **At the arrow:** RSSI, as "−85 dBm" (the existing `threadValue`). Where RSSI is missing, "LQ 2". Without either,
  the unknown glyph.
- **Details:** RSSI, link quality, the band and its basis ("from RSSI" or "from link quality").
- **Server `strength`:** not used and not shown. It is link quality renamed [S9]. Its connection-level summary hides
  the weaker direction. Its `none` and `unknown` already make a direction "not measured" in `model/thread.js`.

**(d) Findings and hints.**

**d1. Weak parent link (finding).**

- **Raised when:** an available end device and its available parent have a link with either direction in the low
  band.
- **Example wording:** "Its parent Router 01 hears this device at −93 dBm (link quality 1), at or below −90 dBm. This
  device hears its parent at −70 dBm."
- **Why:** every poll of an end device crosses this one link. A sleepy end device pays for a weak link in retries and
  battery.

**d2. Weak router links (finding).**

- **Raised when:** an available router whose own table was read has every link to another router or border router in
  the low band. The weaker known direction of each link counts.
- **Example wording:** "Every link of this router to another router is in the low band. Router 02 hears it at
  −92 dBm, and it hears Router 02 at −91 dBm. This is its only router link."
- **Why:** this router's share of the mesh, and its children, rest on links below the margin at which OpenThread would
  set up a new router link.

**d3. Listed by one side (hint).**

- **Raised when:** a neighbour lists the device with a live reading, and the device's own table, read in the same
  snapshot, has no entry or only a dead one. It is never raised against a border router, which has no table.
- **Example wording:** "Router 01 lists this device (−60 dBm, link quality 3). This device's neighbour table does not
  list Router 01. The tables are read one node at a time, so the entry may have aged out in between."
- **Why:** a stale child entry, or a router link that is set up on one side only. It is a hint, not a verdict.

**d4. Signal and link quality disagree (hint).**

- **Raised when:** one reading has an RSSI band and a link-quality band two bands apart, for example −60 dBm with link
  quality 1.
- **Example wording:** "This device rates its reading of Router 02 at link quality 1, although the RSSI is −60 dBm.
  Its noise floor is probably more than 10 dB above −100 dBm (interference or another radio), or the RSSI is of a
  single frame. The colour of its lanes may overstate their quality."
- **Why:** this is the one place where the absolute scale can be checked against the receiver itself.

**Not raised:**

- **Asymmetry alone.** It is common [S2]. It is drawn as two lanes, and it is judged only through d1 and d2.
- **Zigbee kinds.** "Weak reception", "very low reading", "data incomplete" and the table findings are not raised.

**(e) What stays unknown.**

- Whether `rssi` is the average or the last RSSI.
- Each receiver's noise floor and each sender's TX power.
- Entry age and error rates.
- Which other routers a sleepy end device could hear: its table holds only its parent, so no "better parent" can be
  named.
- The border router's own view of its links.
- Next hops and routes.
- Link cost per link quality: secondary sources disagree (link quality 1 costs 4 or 6), so the model does not use it.

## 4. Example: the anonymized sample (`tests/fixtures/matter-sample.json`)

Node ids as in the fixture. "A hears B" is measured at A.

| Link | A hears B | B hears A | Bands (A, B) | Note |
|---|---|---|---|---|
| leader 14 – SED 16 (parent link) | −85 dBm, LQ 2 | −75 dBm, LQ 3 | mid, high | weaker direction mid: no finding |
| leader 14 – router 15 | −36 dBm, LQ 3 | −36 dBm, LQ 3 | high, high | |
| leader 14 – border router | −75 dBm, LQ 3 | not reported | high, none | border router has no table |
| router 15 – SED 18 (parent link) | −77 dBm, LQ 3 | −21 dBm, LQ 3 | high, high | 56 dB asymmetry, cause unknown |
| router 15 – border router | −69 dBm, LQ 3 | not reported | high, none | |

Result: one mid lane and seven high lanes. There are no findings and no hints (test "the sample raises no quality
finding or hint").

## 5. Notes for the engine refactor

- The leader and the border routers are always labelled (owner decision, 2026-11-01). They become the Thread engine's
  `anchors`.
- The Thread View tab hides the Zigbee-only groups (owner decision). "Colour by reception" stays and uses
  `laneLook().level`.
- **Legend:** three rows, one per band, labelled with the dBm limits, for example "above −80 dBm (link quality 3)".
  There is no judgement word.
- **`springQuality`:** proposed as the band level, with link quality as fallback. It stays null without a band.

## 6. Open questions for the owner

1. **Lane width by band (recommended) or by RSSI rank, as board M24 says.** Example: two links at −40 and −45 dBm.
   - By band, both get the widest stroke.
   - By rank per receiver, the −45 dBm link gets the thinnest stroke.

   Band keeps width and colour telling the same thing.
2. **Fixed nominal noise floor of −100 dBm (recommended), or a floor estimated per receiver from its own
   link-quality and RSSI pairs.** Example: a receiver reports −75 dBm with link quality 2.
   - Fixed: the lane is high, and nothing is flagged, because the two are only one band apart.
   - Estimated: that receiver's limits move up by about 5 dB.

   Fixed is simple and explainable. Hint d4 catches the large cases. Revisit when more captures exist.
3. **"Listed by one side" as a hint (recommended), as a finding, or not at all.** Example: Router 01 lists Router 02,
   and Router 02's table, read seconds later, does not list Router 01.
   - As a hint, it shows with the wording "may have aged out".
   - As a finding, it would count as a judged problem.
4. **Hint d4 shown in the Findings tab (recommended) or in debug mode only.** Example: one receiver rates −60 dBm as
   link quality 1.
   - In the Findings tab, every user sees that its colours may overstate.
   - In debug mode only, the hint is quieter, but only people who debug see it.

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
- [S12] IEEE 802.15.4-2011, 2.4 GHz O-QPSK sensitivity −85 dBm, as cited by an Anritsu product introduction (search
  result, secondary); CC2520 −98 dBm from a distributor listing (secondary).
- [S13] Nordic nRF52840 product specification, radio chapter (energy detection ±6 dB, an IEEE 802.15.4 requirement):
  https://docs.nordicsemi.com/bundle/ps_nrf52840/page/radio.html
- Not available publicly: the Thread specification text itself. Its thresholds are taken from [S1], which quotes it.
