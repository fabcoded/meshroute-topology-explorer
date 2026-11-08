# Specification

What Meshroute Topology Explorer does, seen from the user and from Home Assistant's public interfaces: behaviour,
data rules and measurable acceptance, not code structure. **Bold** terms are defined where they first appear. Tags:
**[v1]** first usable version (ZHA only), **[v1.1]** route view, **[later]** further sources and views. Status:
reviewed draft.

## 1. Purpose and principles [v1]

Find and understand problems in the Zigbee and Thread networks Home Assistant runs: a lamp that drops out, a sensor
that reports late, a garden corner that hangs on one weak link.

- **Debugging first, calmly.** The default view answers "is my network healthy, and where is it weak"; raw values,
  reporters, tables and the scan are one click away (9.1).
- **Read only.** The explorer never changes a network or device. Radio traffic only on user request: a confirmed
  topology request (ZHA scan, Thread refresh, Zigbee2MQTT map request) and one read of a cluster's attribute values
  (9.2), and the optional one-time scan after a start (owner 2026-11-03, off by default, 10.1). Otherwise never
  automatic, never a write, no reporting, no binding.
- **Unknown beats wrong.** The explorer judges only through **findings** (5.6), each naming its evidence; missing
  data is never a verdict. (A first attempt called garden lamps "weak" and five sensors "without parent" on
  incomplete tables.)
- **Nothing leaves the house.** No telemetry, no third-party requests; map tiles only from a user-configured address.
- **Ship what you read.** Home Assistant serves one generated, readable file built from the repository's sources
  (Rollup, no minifying, comments kept); a check proves it matches them (10).

## 2. Users and questions

| Question a user brings | Where the answer lives | Tag |
|---|---|---|
| Which devices are badly connected, and to whom? | quality view, default fill, findings, details | v1 |
| Can I trust this picture right now? | status pill, "data incomplete" findings | v1 |
| Which router carries my battery devices? | details, findings | v1 |
| Which way does a packet travel, there and back? | selection (node view), details; route view, playback | v1, v1.1 |
| Which routers relay most traffic; what depends on one? | route view, subtree, relay-load fill | v1.1 |
| Where are my devices physically? | geo view | later |

## 3. Data sources

The panel reads through Home Assistant's websocket API and requires an administrator (`zha/*`, `matter/*`,
`thread/*`, `mqtt/subscribe` are admin-only; the registry commands are not). Each source is an **adapter** with a
**capability set** (4.6).

### 3.1 ZHA [v1]

- `zha/devices` returns per device: IEEE address (colon form), network address (number), device type
  (`Coordinator`, `Router`, `EndDevice`), availability, last seen, manufacturer, model, default and user name, area,
  power source; a **neighbour table** (IEEE, network address as hex text, LQI as text, relationship `Sibling` /
  `Child` / `Parent` / `PreviousChild` / `NoneOfTheAbove`, depth, device type, receiver-on-when-idle, permit-joining)
  and a **routing table** (destination and next hop as hex text, status, many-to-one, route record required, memory
  constrained); and the **signature**: the node descriptor (MAC capability flags, bit 3: receiver on when idle) and
  endpoints with profile (Zigbee Home Automation 0x0104, Zigbee Light Link 0xc05e), device type, input and output
  clusters.
- **Kind** (4.2): from the endpoints' device types, the more specific winning (a remote with a sensor endpoint is a
  button); else from a server cluster naming one function (lock, cover, thermostat, colour control, occupancy,
  temperature, IAS zone, other measurements); else unknown. The coordinator is a hub. **Sleep**: MAC capability flags,
  else a neighbour entry's receiver-on-when-idle, else unknown. On the sample every device has a kind and the 12 end
  devices sleep.
- Names and areas: `config/area_registry/list`, `config/device_registry/list`; ZHA loaded: `config_entries/get`.
- `zha/topology/update` starts a **scan**: the coordinator asks every router for its tables in turn, about a second
  per table page; it takes minutes (author's network: 21 of 32 router tables after 2 minutes, 30 after about
  2.5 hours, the other two routers offline). The command never answers: send it without waiting. A new scan cancels
  a running one. ZHA also scans every 4 hours by default (configurable, can be off).
- ZHA stores the tables across restarts. A scan replaces each router's table when it answers; otherwise the previous
  table stays, possibly hours old. A router that joined after the last successful scan has none.
- Traps:
  - Addresses and LQI arrive as text (or numbers); parse them (hex with `0x` or `0X`), never compare as strings.
  - The device-level `lqi` is the coordinator's reading of the last frame from that device on the last hop, whichever
    router forwarded it, not a device property. `rssi` is empty and neighbour `depth` mostly 15: no measurements.
  - A router's `last_seen` mostly reflects the last scan; availability decides whether it is up.
  - LQI 0 is ambiguous (unmeasured or very weak): shown as "0 (uncertain)", never rated or used for a finding.
  - Scales differ by reporter: the sample's coordinator median is 22 with LQI 0 and 24 without (the 5.4 pool), router
    medians 44 to 167.
  - Tables are limited by memory (8 to 26 entries per router, 31 at the coordinator on the sample); only 85 % of
    entries have a reverse entry. A missing entry is no evidence of a missing link.
  - A link listed by one side only (sample: 85 pairs, 242 by both) means a full or nearly full table (r22 leaves the
    choice to the device; one model's tables stop at one size, e.g. 16 router entries for IKEA, 26 for Signify), an
    end device on the other side, or a weak or aged-out link (4.3); no sample pair proves an asymmetric radio link. An
    active route proves a link that was two-way when built (3.6.3.5.2), of unknown age. A neighbour listed twice in
    one table counts once, with the higher LQI.
  - `Child` and `Parent` entries between routers record joining, not routing; ignored.
  - The coordinator keeps no routing entry for some destinations (direct neighbours; source routing, whose records
    Home Assistant does not expose): such paths are unknown unless assumed or read from zigpy (5.1).
  - A routing entry can point at an unavailable device.
- **zigpy's route records** (5.1; Home Assistant core 2026.10.1, zigpy 2.4.0): the integration's command
  `meshroute_topology_explorer/zigpy_routes` (admin only) reads in memory, without radio traffic, ZHA's zigpy
  application (`homeassistant/components/zha/helpers.py` `get_zha_gateway(hass).application_controller`) and per
  device its `relays`: None until the coordinator received a route record, then the relays from the device towards
  the coordinator (zigpy's source route is that list reversed). Answer:
  `{ radio, devices: [{ ieee, nwk, relays: [{ nwk, ieee }] }] }` (radio library, e.g. `zigpy_znp`; a relay's ieee is
  the device holding that address now, or null), or `not_supported` with "reason: text" (`zha_not_loaded`,
  `no_gateway`, `internals_changed`, `error`). zigpy keeps records across restarts without a time, so their age is
  unknown; a relay address may be outdated after a rejoin. Verified for zigpy-znp (route-record indication), other
  radio libraries unverified. Called once per data load.

### 3.2 Thread through Matter [v1.1 preview]

- `matter/network_topology` is in every supported Home Assistant (2026.9 or newer; the minimum is 2026.10, 10): a Matter
  server too old for it answers `not_supported` (an older Home Assistant would answer `unknown_command`, treated the
  same); the Thread entry of the network switch (9.1) is greyed with "the Matter server does not offer the topology;
  update the Matter server"; ZHA stays. Without a Zigbee network this is the panel's message (9.4).
- Read once per load, only when the Matter integration is loaded (`config_entries/get`, domain `matter`), always with
  `refresh: false`: a snapshot built from the Matter server's cache, no radio traffic. `refresh: true` would re-read every node's
  tables over the radio; `tools/guard.py` refuses it in shipped code. `tools/capture.py --matter` captures the same
  answer. Scan re-reads (6) and zigpy's route records (3.1) are ZHA only.
- **Direction** (matter.js server `packages/ws-client/src/models/model.ts` NetworkTopologyConnection, schema 13):
  `source_to_target` is the source's own neighbour-table record of the target, "source hears target", received at
  the source; `target_to_source` the reverse; a missing direction is `null`.
- Snapshot content: nodes with kind (`matter`, `border_router`, `thread_unknown`, `wifi_ap`), role, extended address,
  RLOC16, extended PAN id, vendor, model, last seen, availability; links with strength (strong / medium / weak / none
  / unknown), LQI and RSSI per direction, route-table origin, path cost; `collected_at`.
- **Mapping** (`engines/thread/from-matter.js`, `engines/thread/model.js`):
  - Key: the extended address; without one, `thread:<node>`, whose pins are dropped (pins use EUI-64 keys only).
  - Roles: `leader` and `router` are routers (the leader with crown "L", 8); `reed`, `end_device`,
    `sleepy_end_device` end devices; kind `border_router` the role "border router" (wired, picture hub); else unknown.
  - Name: device registry through `ha_device_id`, else the border router's `host_name` or model, else "Matter node
    <id>". Availability `null` (border routers, found by mDNS) is drawn as available, and Details say so.
  - Readings: link quality 0–3 and RSSI in dBm. Strength `none` (seen dead) and `unknown` are not measured and never
    drawn as a dead link; RSSI 127 is no value; link quality 0 with a valid RSSI is a measured low reading.
  - Parent: the router the end device's own table lists (a Thread child holds only its parent); if it reported
    nothing, the router-role node with the best reading. Other routers listing it are possibly stale (a REED's or
    FED's further routers are real links). None: "parent unknown", the device stays listed.
  - Kind (picture): the snapshot has no device signature, so it comes from the device's Home Assistant entities
    (`hass.entities`, `hass.states`, already in the panel; `engines/thread/kinds.js`): light, switch (outlet; relay
    for device class `switch`), cover, lock, climate, motion / occupancy / presence, temperature and humidity only,
    other sensors, event or button only, in that priority; config and diagnostic entities and helpers do not count.
    Nothing matches, or no `hass.entities` (older Home Assistant): unknown.
  - No Zigbee field gets a default: no network address (the RLOC16 has its own field, searchable in Devices), no
    router-table counts or capacity, no relay load or rating, no "router tables x/y" or completeness; what the
    snapshot does not name is null.
  - Readings of an unavailable node are stale: kept for Details, not drawn. Wi-Fi nodes and links, and nodes outside
    the largest extended PAN id group, are ignored and counted.
- No next hop per destination: no paths, stages, theoretical paths, playback or direction switch (4.6). The map draws
  parent links solid (both directions) and measured neighbour lanes dashed; a click shows the device's own lanes with
  values and the glyphs of its unread directions. Leader and border routers are always labelled; the fit contains
  every device and label (7.1).
- `collected_at` is built by the Matter server when the request arrives (matterjs-server main 0bd06f2, 2026-10-31:
  `WebSocketControllerHandler.ts`, `NetworkTopologyService.ts`): the time the panel (or the recorder) took the
  snapshot, never the read time of the tables. The server re-reads neighbour and route tables about once a day
  (`ThreadDetailsPoller.ts`, daily poller since PR #943), on a new subscription and on an explicit refresh; some
  devices also report table changes themselves. When the server last read is not reported, and 24 h is no guaranteed
  upper bound.
- Limits: the tables in the snapshot are what the Matter server last read, at an unknown time; the snapshot may list
  removed routers or miss end devices; border routers vanish when Thread diagnostics are off. No reconciliation with
  OTBR data (`otbr/*` returns keys, 3.4).
- **[later]** `matter/subscribe_network_topology` (also 2026.9); `thread/discover_routers` and `thread/list_datasets`
  label border routers and mark the preferred one; networks grouped by extended PAN id.

### 3.3 Zigbee2MQTT [later]

Through Home Assistant's MQTT integration: subscribe with `mqtt/subscribe` to `<base>/bridge/response/networkmap`,
publish `{"type": "raw", "routes": true, "transaction": <id>}` to `<base>/bridge/request/networkmap` with the
`mqtt.publish` service, match the transaction. Instances are found by their retained `<base>/bridge/state`. The
request slows the network for 10 seconds to 2 minutes: a user action like the ZHA scan. Built only against a real
recorded answer.

### 3.4 Allowed commands [v1]

The panel and the integration call only these commands; `tools/guard.py` enforces the list.

| Command | Purpose | Tag |
|---|---|---|
| `config/area_registry/list`, `config/device_registry/list`, `config_entries/get` | names, areas, ZHA present | v1 |
| `zha/devices` | devices and tables | v1 |
| `zha/topology/update` | user-started scan | v1 |
| `zha/devices/clusters/attributes/value` | user-started read of one attribute, once per button press (9.2) | v1 |
| `meshroute_topology_explorer/*` | own settings and observations (10), zigpy's route records (3.1, read only), reception history (10.2, read only) | v1 |
| `matter/network_topology` with `refresh: false` | Thread topology, snapshot from the server's cache (3.2) | v1.1 preview |
| `matter/subscribe_network_topology`, `thread/discover_routers`, `thread/list_datasets` | Thread | later |
| `mqtt/subscribe`, service `mqtt.publish` to `<base>/bridge/request/networkmap` only | Zigbee2MQTT | later |

Entity states and area names come from the `hass` object Home Assistant hands every panel (`hass.states`,
`hass.areas`; developers.home-assistant.io, frontend data), only for the selected device. Everything else is
forbidden, in particular commands that return keys or change a network: `zha/network/*`, `otbr/*`,
`thread/get_dataset*`, `thread/set_*`, `matter/set_*`, `matter/commission*`, `matter/open_commissioning_window`,
`zha/devices/permit`, other `zha/devices/clusters/*` commands, `zha/devices/bind`, `zha/devices/unbind`,
`zha/groups/*`, `zha/configuration/*`, and ZHA services that write attributes, issue cluster commands or bind. The
integration's Python reads from zigpy only IEEE address, network address and relays per device, and, for the reception
history (10.2), calls the registered handlers of `zha/devices` and `matter/network_topology` (`refresh: false`) and no other, reads ZHA's two scan settings from the application config, reads the topology's scan task state and attaches a
listener to its events (never a scan of its own: the one-time scan of 10.1 goes through ZHA's command handler); network settings,
keys, their saved copies and every call that sends to the radio stay out of reach (`tools/guard.py` PY_DENY).

## 4. Data model [v1]

One normalized model per network; every value knows its origin.

### 4.1 Network

Source (adapter), network id (ZHA config entry; Thread extended PAN id), coordinator or border routers, snapshot time
(Thread `collected_at`, 3.2), completeness (6).

### 4.2 Device

Key: IEEE / extended address, never a name. Network address, **role** (`coordinator`, `router`, `end device`,
`border router`, `unknown`), power source, **kind** (light, outlet, relay, button, sensor, motion, temperature,
thermostat, blind, lock, hub, unknown; its symbol's picture, 8), **sleepy** (receiver off when idle: yes, no,
unknown), vendor, model, display name, the integration's name in the device registry, area, available, last seen;
for Details (9.2) also firmware (`sw_version`), area id and the device's entities. "Battery device" means an end
device powered by a battery.

### 4.3 Radio link

A directed reading "reporter R hears subject S": value, scale (`zigbee-lqi` 0–255, `thread-lqi` 0–3, `rssi-dbm`),
relationship if known. Each direction of a pair is a separate single reading of the last frame; on the sample the
two differ by a median of 8 LQI and by more than 60 in a tenth of pairs.

**Evidence per direction** ("A hears B", pairs of available devices):
- **measured**: LQI above 0 in A's table;
- **implied**: no reading, but an active route of A via B or of B via A, or B is the parent of end device A; named
  "route" or "parent", as both prove a two-way link at setup;
- **unknown**, with a reason: "end device (no table)", "table full (n/cap)", "table nearly full (n/cap), link probably
  weak", "table has space, link probably weak or aged out", "lqi 0", "table missing or stale", "capacity unknown".
  The model carries the reason as a code with size and capacity, not as text.

**Capacity** of a model: the most router entries (routers and coordinator) in any table of its manufacturer and model
in this network, from at least two devices. A model on one device borrows its manufacturer's largest table ("vendor
estimate"); "capacity unknown" only when no other device of the manufacturer has a table. "Full" is that many,
"nearly full" two fewer or less. Capacity is information only, never a finding. Pairs evidenced only by LQI 0 are not
pairs; such a reading is kept, marked as not measured.

### 4.4 Route

"Owner forwards packets for destination D to next hop H", with status and flags; direct if H is D. Entries not
`Active` are kept for Details but not followed.

### 4.5 Parent

Only end devices have one: the router or coordinator listing it as `Child`; of several, the higher LQI wins, the
others are "possibly stale". `PreviousChild` is ignored.

### 4.6 Capability set

| Capability | ZHA | Thread/Matter | Zigbee2MQTT |
|---|---|---|---|
| Radio readings per direction | yes (LQI) | yes (LQI, RSSI) | yes (LQI) |
| Routes with next hop | yes | no | partly |
| Parents of end devices | yes | yes (the end device's own table) | yes |
| Measurement time | no (observed, 6) | yes | per answer |
| User-started refresh | scan | refresh (not built; the panel reads the cache) | map request |
| Reading scale | LQI 0–255 | link quality 0–3 and RSSI dBm | LQI |
| Ratings, "weak reception", "very low reading" | yes | no (Zigbee LQI scale) | yes |

- What needs a missing capability (view, option, finding) is hidden, not greyed. Thread's View tab replaces
  "Communication paths", "Path display" (waits for the Thread reception model) and "Return paths without a table
  entry" by one line: "Thread data names neighbours and parents, not routes; there are no path views." The scan
  appears only with `capabilities.scan`. Thread findings: offline, parent offline, parent unknown ("The topology lists
  no link between this end device and a router.").
- One viewer engine per network type. Each network carries `engine` and `capabilities`, stamped by its source's
  build; `engineFor()` (`engines/index.js`) never falls back to another engine. The adapter (`adapters/`, with the
  schema mapping) declares the capabilities, only the engine reads them, and the shared shell (panel, graph, ui
  frames) never tests a network type (`tests/engine-leaks.test.mjs`).

## 5. Derived facts

### 5.1 Paths [v1]

- **Up path** (device to coordinator): follow the parent of an end device, else each hop's routing entry towards the
  coordinator.
- **Down path** (coordinator to device): follow the coordinator's entry for the device, then each hop's entry. A
  parent delivers to its end-device child directly: it keeps no routing entry for its own child, and the child check
  comes first (Zigbee r22, 3.6.3.3). If an end device's entries do not lead to its parent, the down path to the parent
  plus the parent link is used, but only if the path to the parent is complete; otherwise it stays incomplete.
- A path that meets a missing table or entry, a loop or an unavailable hop stops and is **incomplete**; it is never
  guessed, not even for the coordinator's direct neighbours.
- **Paths of one device** (node view, 7.1), per view:
  - "coordinator": its up and down path. The coordinator stands for Home Assistant: the routes it holds (walked like
    the down path) and the routes of other devices towards it.
  - "table": only **table walks**. Out walks go to every destination of the device's usable entries (active, not from
    a stale table), each holder forwarding by its own entry for that destination, a parent delivering to its child,
    an end device sending to its parent. "Include return routes" adds in walks from each destination back by every
    hop's entry for the device. A router or the coordinator without a usable entry delivers directly to a goal that is
    a router or the coordinator listed in its own neighbour table, whatever the relationship or LQI ("neighbour": the
    NWK unicast to a neighbour, Zigbee r22 3.6.3.3; a coordinator keeps no entry for its neighbours); an end-device goal
    keeps the parent rule, as another router's Child listing may be stale. A walk stops at "no entry", "entry
    inactive", a table not read, a loop or an unavailable device, and names where. Nothing else fills a gap
    (discovery, reversed way out, source route or route record); a return route missing from the tables is no verdict
    on the link. No up or down path; end devices and unavailable devices have none.
  - "all": adds a **theoretical** (5.7) **out path** to and **in path** from every other available device except the
    coordinator, whose way is the up and down path. Unavailable devices have none. The coordinator gets out and in
    paths for every available device, from its own table on.
  - On the sample every one of these paths is complete (12).
- **Reception at a hop** (sender to hearer): the hearer's evidence (4.3): its LQI of the sender; "Parent" or "Route"
  where only a parent link or route implies the hop; "–" where the hearer's table was read and lacks the sender; "?"
  where there is no table to ask. Map and Details use this glyph rule alike (7.1).
- **Source route** (View tab 9.1, stored 11): a ZHA coordinator reaches many devices without a routing entry, along
  the relays of the device's own route record (its up path reversed), which Home Assistant does not expose. Stages:
  - **off**: the down path stays unknown.
  - **assume** (default): the down path is the up path reversed, marked **assumed** wherever it shows, never counted
    as measured, drawn dash-dot unless a table or a parent link names the lane (7.1). Only for an available device whose measured down path is incomplete, whose up path is
    complete, and for which the coordinator's table (present) holds no active route; so a direct neighbour of the
    coordinator gets a one-hop return path. An end device with a coordinator entry stays unknown: its gap lies
    elsewhere. Then every available sample device has a measured or assumed down path (12).
  - **read from zigpy** (experimental, 3.1): a route record becomes the down path, drawn and counted as **measured**
    ("back, measured (route record, age unknown)"; no line class of its own), only if: the device is available and not
    the coordinator; its measured down path is incomplete; the coordinator's table, if present, has no active route to
    it; its network address equals the record's; every relay is a known, available device holding the recorded
    address now; no device repeats; every hop joins a pair of the model. Other devices get the assumption. A record
    never replaces a complete measured down path; if it differs, Details says "Route record differs: via …" and
    nothing is drawn. If zigpy cannot be read, the stage assumes and the pill's menu says why.

### 5.2 Relay load [v1]

Per router: routes in all available routers' tables using it as next hop towards another destination; direct routes
do not count.

### 5.3 End-device children [v1]

Per router or coordinator: end devices whose parent it is.

### 5.4 Rating relative to the reporter [v1]

- The **rating** of a reading R hears S is its mid-rank percentile among all non-zero values R reported. With fewer
  than 10 such values the pool is all reporters of R's vendor; below 10 there too, the reading keeps its raw value and
  no rating.
- A device's **reception** is the best rating among readings with it as subject, LQI 0 excluded.
- A rating is a rank, not a health claim: the interface says "lower / middle / higher reception rank", and Details
  name the basis ("rank among the readings of Router 12", or "rank within the IKEA group", marked "group", where the
  reporter has fewer than ten readings).
- By construction a tenth of every reporter's readings are its lowest tenth, worded "weakest tenth of what R hears".
  Differences below 60 LQI between readings are noise, never a finding.

### 5.5 Offline [v1]

Unavailable devices show since when (last seen). Availability decides; routers' `last_seen` is text only.

### 5.6 Findings [v1]

A **finding** is the only form in which the explorer judges. It names its evidence (values, reporters, tables used)
and the tables it would need but lacks. **Expected reporters**: for a router the available routers in its own
neighbour table, for an end device its parent.

| Finding | Raised when |
|---|---|
| offline | device unavailable in Home Assistant |
| parent offline | end device whose parent is unavailable |
| route to offline device | an active routing entry whose next hop or destination is unavailable |
| data incomplete | available router without a table, or device with an expected reporter that has no table |
| weak reception | available device whose reception is in the lowest tenth **and** below half the reporter's median, while all expected reporters have tables |
| very low reading | a non-zero reading of 1 to 10 LQI on a link to an available device, whatever the reporter's scale; a hint, not "weak" |
| parent unknown | end device that no table lists as child: "no parent" only if every available router has a table, otherwise "parent unknown (tables of … missing)" |
| isolated | available router with a table that no other table lists, only if every available router has a table |
| many end-device children | router or coordinator with 3 or more |

- No finding comes from an unavailable device's (stale) table, from LQI 0 or from a missing neighbour entry alone.
  Exception: "parent offline" may name the "last known parent" from that parent's stale table, as no other table
  lists the child.
- Path walks never follow routes or parents from an unavailable device's table.
- The coordinator's table counts like a router's for "data incomplete", "parent unknown" / "no parent" and
  "isolated": without it, none of the three is a verdict.
- The interface groups "data incomplete" by the missing table (9.1).

### 5.7 Theoretical paths [v1]

How a frame from device S would most likely reach device D today, after the unicast routing of Zigbee r22
(05-3474-22, 2017): its routing table, then its next hop's, and so on. Computed, not observed; Home Assistant does not
show whether two devices really talk. At each holder H of the frame, in this order:

1. H is an end device: to its parent ("parent").
2. D is an end device whose parent is H: delivered ("child"; 3.6.3.3 checks children first).
3. H holds an active, current entry for D: to its next hop ("table"). 3.6.3.3 also relays on `VALIDATION_UNDERWAY`;
   the explorer follows `Active` only (4.4; the sample has no other status). Many-to-one entries point at the
   coordinator and are its stage-1 ways.
4. D is a router or the coordinator measured in H's neighbour table: directly ("neighbour"). 3.6.3.3 checks the
   neighbour table first, optionally ("may"); the table comes first here because stacks route around weak
   neighbours (35 active sample entries go via another hop to a destination their owner measures, LQI 1–169). End
   devices are routed by their own address under stochastic addressing (3.6.3.3, `nwkAddrAlloc` 0x02), so a router
   hearing only an end device's parent discovers instead.
5. Otherwise the rest is **one of the cheapest ways by the tables' LQI**, a candidate for what a route discovery from
   H would take, not a prediction ("discovery"; hit rate in 12): the lowest **path cost** to D, for an end device to
   its parent (which answers for its child, 3.6.3.5.2) and then "child".
   - Usable: links between available routers or the coordinator that both sides measure (with `nwkSymLink` a route
     request over a neighbour without outgoing cost is dropped, 3.6.3.5.2).
   - Path cost: the sum of link costs (3.6.3.1); a link costs the larger of its directions ("the maximum of the
     incoming and outgoing costs", 3.6.3.5.2); a direction costs **1 + round(6 × (1 − LQI / 255))** (255 → 1, 128 →
     4, 0 → 7). r22 wants 1 to 7 (3.4.8.3.2) from "a table-driven function" (3.6.3.1); its example
     min(7, round(1 / p⁴)), p = LQI / 255, is 7 below LQI 160 (206 of 241 sample pairs) and would reduce discovery to
     hop counting.
   - Ties: fewer hops, then lower device ids from S on.

- A table not read or an inactive entry counts as no entry (rules 4 and 5 apply), and the leaving hop says so ("table
  not read", "entry inactive").
- A loop (also a discovery back over a passed device), an unavailable device, a holder without usable link ("no
  link", or "table not read" without a table) and an unknown parent stop the walk; the path is incomplete and says
  why.
- The way back D to S is walked separately from D: tables differ per direction.
- The **backbone** (7.1) is every lane the theoretical paths between available devices use (sample numbers in 12).

### 5.8 Path history of a pair [v1.1]

Code: `frontend/engines/history-records.js`, `engines/zigbee/history.js`; input is the reception history (10.2).

- **Snapshot:** one record; a time-only record repeats the previous one. The network at a snapshot is the live input
  with every device's neighbour and routing tables replaced by the snapshot's (`buildNetwork`). A device only the
  snapshot knows is a placeholder (role unknown, no address); a live device without tables there is "table not read";
  a device holding tables there counts as available. End devices' parents come
  from the record's `p` (10.2), given to the engine as the parent's "Child" listing (an empty listing is added where the
  parent's table has none); a child with two parents takes the one that lists it with the better reading, then the lower
  key; only a known end device with a router or coordinator parent counts. A record without `p` (older files) takes the
  live "Child" listings, and for a child whose live parent is not in the snapshot the strongest router listing it.
- **Walk:** `tableWalk` there and back (5.1), each hop with RX at its receiver (`pathHops`); the rank is the panel's
  "rank N %" (5.4), computed within that snapshot's readings of the receiver. A walk that stops is incomplete with its
  reason; nothing is guessed.
- **Weakest hop** per direction: the lowest rank at the receiver, ties to the first hop. A hop without a rank (parent
  or route link without a reading, LQI 0, too few readings) is never the weakest; never chosen by raw LQI.
- **Span:** consecutive records with identical there and back hop lists (for a stopped walk, with its reason). A span
  carries min, mean and max rank per hop; its weakest hop is the one with the lowest mean.
- **Lane series:** per direction `[t, lqi(, rssi)]`, `[t, null]` where a record lacks the entry; a window centred on a
  record (+-48 h) or the last 48 h; the first record with the entry tells when the lane appears.
- **Thread** has no routing table in the Matter topology: lane values per direction (LQI, RSSI), no walk.
- **Limits:** the recorder leaves out entries without a readable LQI, so such a neighbour does not count as listed for
  a direct delivery; an address change since the record is not seen; a record that truly has no parents looks like an older one and falls back to the live parents.

## 6. Data status and the scan [v1]

- **Status pill**, always visible (9.1): the pill's name is the network ("Zigbee (ZHA)"); its second line is the data
  state: "Router tables: x/y" as "{x}/{y} router tables" (available routers with a table of all available routers,
  coordinator not counted, no percentage) and the newest observed change ("unchanged since …"), or a followed scan.
  The menu has the full state: the same parts, the source-route stage (5.1) except in the view "routing table", which
  draws no assumed or recorded return path, and "Names and areas not read". Findings name devices missing from every
  table. ZHA's own 4-hourly table reads are explained by an info button beside "Read data again" (9.1).
- **The dot** (11 px, last in the pill): green = every available router's table read (Thread: every linked pair measured
  both ways, a border router listed, snapshot younger than 4 hours); amber = anything else (a table missing, a one-way
  link, no border router, a snapshot of 4 hours and older); red = connection to Home Assistant lost (a message
  replaces the map only when no network is left, 9.4). Colour is never the only signal: the second line says
  the same and takes a matching text tone in amber and red. ZHA gives no scan time and "unchanged since" can be days
  old on a quiet network, so ZHA's age plays no part; 4 hours is ZHA's default scan interval, reused for Thread, where
  the dot's criterion is the age of the panel's snapshot, not of the tables in it (unknown, 3.2).
- **Thread**: source "Thread (Matter)"; "Links with both directions: x/y" (pairs measured both ways of all linked
  pairs; sample 3/5); "snapshot {time} ({age})" from the snapshot's `collected_at`, noted as built by the Matter
  server from its cache when the panel asked, with tables that can be many hours old and an unreported read time; in
  the menu's full line only, right after it, "Thread tables: age unknown" with the same note as tooltip (the compact
  line keeps "snapshot {time}"); "no border router listed" when there is none. No banner, no "unchanged since".
- **Completeness** (share of available routers with a table) is no percentage and no gate: each finding has its own
  evidence rule (5.6). Below 90 % the map carries the banner "incomplete".
- **Observations**: ZHA has no scan timestamp, and the integration cannot read ZHA's tables publicly. The panel keeps
  per router a fingerprint of its sorted neighbour and routing tables (with LQI) and when it first saw it, stored
  through the integration (10) as `routers: { <ieee>: { fingerprint, firstSeen } }`.
  - The pill's "unchanged since {time}" therefore means observed unchanged since, accurate only for times a
    panel was open; its tooltip says "observed, not reported", and Details have the row "Table observed unchanged
    since".
  - Saves merge per router (the same fingerprint keeps the earlier time, another the newest view) and keep unknown
    keys; above 256 KiB the oldest entries go first, reported in debug mode. Times use the browser's local time.
- **Scan** (debug mode): explains the radio load and asks for confirmation, which starts on "Cancel"; disabled while
  this panel's scan runs; sends with the connection's fire-and-forget send, without waiting.
  - Re-reads every 15 seconds for 2 minutes, then every 60 seconds up to 15 minutes, showing "tables changed since the
    scan started: x of y" (available routers, coordinator not counted; gaining a table counts as changed), with the
    note that an unchanged table may also have answered. It never claims "finished".
  - A re-read reaches the map only if tables or availability changed, so the layout does not restart every 15
    seconds; a failed re-read is skipped. Leaving the panel or "stop" ends the following, not the scan, which ZHA
    cannot cancel.

## 7. Views

Two core views, switchable; the choice is stored per network.

### 7.1 Quality view [v1]

**Layout.** A force-directed model: springs along readings, repulsion between all devices, a pull to the centre.
- Every measured reading is a spring of rest length L = L0 × D × f(q), q = LQI / 255, f(q) = 1 + 5 (1 − q)²; a reading
  of 0 or without value (3.1) is no spring. A pair with two readings has two springs. Origin of the curve and the
  numbers below: [provenance.md](provenance.md).
- L0, the base length: node diameter plus mean label width in the label font, at zoom 1. D, the **density**: 0.96
  dense, 1.44 medium (default), 2.28 wide (stored name `spread`), or a custom factor (below). Repulsion scales with (L0 × D)², so the balance of forces, and the
  picture's meaning, is the same in every density: the layout is computed once with D = 1 and drawn at D times its
  positions.
- Any standard spring-electrical integrator is acceptable if deterministic with a fixed seed and meeting the fidelity
  and speed targets (12).
- Density changes only the distances between connected devices: the same layout is redrawn at D times its positions,
  symbols and labels keep their size, the selection (else the view's centre) stays in place, and the stored density
  (11) applies on load. **Custom density**: D chosen in steps of 25 % (× or ÷ 1.25) within 0.6 to 8, shown as "×" and
  one decimal. A step, from the View tab's stepper or the map's "Spread" buttons or the keys `[` (less) and `]` (more), switches to Custom
  starting from the active density's factor. **Zigbee fit "base"**: "fit" and the first view fit the layout at D = 1, so dense sits
  slightly smaller than the window and medium and spread reach about 44 % and 128 % past it. **Thread fit
  "contain"**: every device and its label inside the window at the active density (a few devices, each an extreme of
  its box, would otherwise reach past it), refitted on a density change while the user has not moved the view. The
  fit is a field of the engine's scene.
- Devices without readings sit evenly on an ellipse just outside the mesh (the mesh's bounding-box half-axes plus
  L0 / 2, before D); the ring and Details ("No readings") say so, the symbol does not change (8).
- Dragging a device pins it (pin mark); "release" in Details or a double click unpins it. Pins are stored (11).

**Lanes.** Each pair (4.3) is two **lanes**, one per direction from sender to hearer, each on the right of its
direction of travel (3 px from the centre line at zoom 1, growing with the symbols), ending 1 px outside the symbol's
contour (8) with an arrowhead at the hearer.
- **Classes per direction** belong to a lane (sender S, hearer R), never to a pair, so the way back of an up hop is
  not up. **Up**: R is the next hop of S on S's up path (5.1). **Down**: on the coordinator's path to a device,
  **measured** (its table and the walk of 5.1, also up to where an incomplete walk stops) or **assumed** (source
  route, stage "assume", 5.1). **Route**: on the walk of an active, current route between two devices other than the
  coordinator. **Heard**: a reading, no traffic. A lane with several classes is drawn as its strongest: up and
  measured down, assumed down, route, heard. Sample (12): 12 of the 41 up lanes go to a parent; 75 lanes carry
  nothing and have no reading (73 unknown, 2 only implied by a route or parent link).
- **Styles**, colourless by default, each with an arrowhead at the hearer: the dash says the **evidence**, the width
  the **role** (decision 2026-11-02).
  - **Read**, solid in the foreground: a usable routing entry of the sender names the hearer as next hop (for any
    destination), or the two are an end device and its parent (4.5); under "read from zigpy" also a recorded hop (5.1).
  - **Assumed or derived**, dash-dot (6 3 1.5 3) in the foreground: any other hop of a path, such as an assumed return
    path (5.1) or a direct hop to a neighbour without an entry (5.7 rule 4).
  - **Computed**, the same dash-dot in grey: a hop the path takes only by route discovery (5.7); never coloured.
  - **Heard only**, dashed (6 3) in grey.
  - **Solid belongs to the lane, not to the path**: a lane keeps its dash in every view and between overview and
    click; views only add or remove lanes. One exception: on a click in "all" the selection's own tree draws a hop it
    takes only by discovery computed, even on a lane a table names (decision 2026-11-01); the overview has no single
    path, so there such a lane is read.
  - **Width**: strong on the way to the coordinator and back (up and down lanes in every overview, the routing table's
    included; on a click the selection's own up and down path in every view), regular for other routes, thin for heard
    only; within each, three steps by the lane's own rating.
- **Glyphs**: a direction without a reading has no lane but a glyph at its lane's middle wherever the view draws its
  pair as heard only (and in debug mode): "–" when the hearer's table does not list the sender (full, nearly full or
  with space), "?" when there is no table to ask (end device, missing or stale table) or it says LQI 0. A lane
  carrying nothing that only a route or parent link proves shows in debug mode only, thin dotted grey, no head.
- **Path display** (View tab 9.1, stored 11): grey (default) or **coloured by reception**: every drawn lane with a rated
  reading takes its rating (5.4, relative to the hearer) on a scale of reception rank from lower over middle to higher
  (never worded bad or good), red, yellow and green unless the user chose three own colours (for colour blindness).
  Lanes without rating and computed hops keep their colour. Dash and width stay, so evidence, role and rating read
  without colour (8).

**Communication paths** (View tab 9.1, stored 11). Three views, each on its own basis (none contains another, so no
"+" in their names); they filter the drawing only, while springs, positions and fit stay. "Stage 1" and "stage 2"
mean the first and third view.
- **With the coordinator, there and back** (`coordinator`, default): the overview draws the up and down lanes of all
  devices, each in its own direction only. A click shows only the device's up and down path (its **node view**, 5.1; for
  the coordinator the routes it holds and those towards it), every hop with its value; other lanes are not drawn, other
  devices dimmed to about 20 %.
- **Routing table** (`table`): the overview draws the lane of every usable routing entry (owner -> next hop) as a route,
  nothing else (no up or down lane, no band). A click shows the device's table walks (5.1) as routes, every hop with its
  value, a gap as the dashed stem with "?" at the device where the walk stopped; a device without usable entries (an end
  device) shows nothing. A direct hop to a listed neighbour takes the look of its lane: solid where a usable entry of
  the sender names the hearer, dash-dot (derived) otherwise. **"Include return routes"** (checkbox under this view only, default off, greyed in the others,
  which hold both directions anyway) adds each destination's walk back. zigpy's route records and assumed return paths
  are another basis and stay out (Details says so).
- **Paths to all devices (theoretical)** (`all`): the overview draws the **backbone**, every lane any theoretical path
  (5.7) between two available devices uses, the coordinator's included; a lane that is not up or down is drawn as a
  route in the look of its evidence (computed where only a discovery takes it). It is computed once per network, not per frame. A click shows
  the device's theoretical way to every other device and back (5.1) and turns the rest off as in stage 1. On a click
  (and hover) the selection's own tree decides each hop's class, so a hop it takes only by discovery is computed; the
  overview and stage 1 keep each lane's strongest class (sample in 12).
- **"Additional heard neighbours (best 3)"** (checkbox under "Routing table", after "Include return routes", default
  off) takes effect in that view only; elsewhere it draws nothing, while the stored value is kept (no migration).
  Without a selection it changes nothing. A click adds the device's 3 best **partners**, both directions, as
  measurement lines with values and the glyph of a direction without a reading, never as routes or destinations. A
  partner is a device with a reading with the selection, none of whose lanes the selection's table walks take; up and
  down lanes are not drawn in this view, so a pair carrying one can be a partner, drawn as heard. Partners rank by the
  best rating at the hearer of the pair's measured lanes, then LQI; a partner is a whole pair.
- **Hover** previews the device under the pointer: its lanes that the overview draws anyway lie on top with values,
  the rest is dimmed; it never adds lanes. In stage 2 the backbone carries the device's trees, so they show; partners
  wait for the click.
- **Debug mode** draws every lane of every class, the glyphs and lanes without traffic, with values on both lanes; a
  selection's lanes lie on top.
- Drawing order: lanes without class (debug), heard only, computed, routes, down, up on top. With source routes off
  the 2 assumed lanes count as routes in the backbone (overview numbers in 12).

**Node view on the map.** Each hop lies on the lane of its direction, dashed by its evidence and weighted by its role
(Styles above), its width step by the hearer's rating where it measured the hop. Every hop carries
its value: raw LQI at the hearer; "Parent" or "Route" where implied; "–" or "?" by the glyph rule.
- The node view's lanes, glyphs and stems lie above the symbols (a lane ends outside its own two), so a device on a
  lane's line never hides it; the band and the overview stay under the symbols (decision 2026-11-02).
- An incomplete path ends at the device where its walk stopped with a short dashed stem towards its goal (right of
  that direction, about 30 px at zoom 1, at most 45 % of the way), a "?" and "path unknown".
- On a click (not hover) the up path also lies as a wide translucent band under its hops; in stage 2 it sets the way
  to the coordinator apart. Devices on the paths, their goals and the partners keep full strength and their labels.

**Values at the arrows.** A value is an upright number in a small pill that interrupts its lane (decision 2026-11-02):
the lane stops about 2 px before the pill and continues after it; the pill is about 16 px high with rounded ends, the
number about 11.5 px, no "RX:" prefix. Fill is the map's background (light or dark theme); a 1 px outline in the lane's
own colour (grey by default, the reception colour when lanes are coloured by reception).
- Position: measured back from the arrow tip along the lane, the pill's centre sits at min(a quarter of the lane
  length, 4 symbol diameters on screen), so long lanes keep the value near the hearer. Each direction of a pair has
  its own pill on its own lane, so the two never meet.
- A lane shorter than about 60 px on screen, or one where the pill would touch the arrowhead or a symbol, puts it at the
  lane's middle; where it fits nowhere, the map shows no value and Details keep it.
- Text values ("Parent", "Route", "–", "?") use the same pill, wider.
- Values of the focus's lanes (click and hover) are never dropped. They keep their place unless it covers the label of
  the selected or hovered device (type line and name, on a light plate) or a symbol: then the pill slides to the next
  free place along its own lane, else the place covering least; on a lane with a single place it stays there, overlap
  accepted. Focus labels choose their places clear of the pills' first places.
- In the debug overview, values slide along their lane for a free place; a lane without room shows none, and Details
  list every value.
- Placement order: up and down, routes, computed hops, heard only. The overview without debug shows ratings by width
  only.
- **Known limit**: at dense hubs values and neighbour labels overlap; the selected label stays readable, and the
  written paths in Details are the reference.
- **UI texts stay short**: notes and legend rows for computed and assumed paths and RX say only what a reader needs
  ("Possible paths from the available tables; actual traffic may differ.", "Return path assumed: the outbound path
  reversed. The actual return path is not available in these data."); the rules stay in 5.1 and 5.7, the short
  warning on "–" and "?" in the legend.

### 7.2 Route view [v1.1]

The layout comes from routing. (The selected device's paths with reception per hop and unknown ends are in v1's node
view, 7.1.) The route view adds the radial layout, the direction switch, playback, the subtree and the relay-load
fill.
- A radial tree from the up paths, used in both directions: coordinator in the centre; a device's tree parent is the
  next hop of its up path; one ring per hop, spacing L0 × D; a subtree's angle proportional to its device count;
  siblings by subtree size, then address. Devices with an incomplete up path sit on an outer ring "path unknown".
- A switch selects **receive** (up path) or **send** (down path); it changes the played and labelled path, not the
  layout. A device whose path in that direction is unknown keeps its place with a dashed stem "path unknown".
- Selecting a device plays its path: a packet marker travels hop by hop (0.6 s per hop), hop number and reading
  appear in turn; then the other direction is drawn statically in its own colour. Buttons "again" and "step";
  selecting elsewhere or Esc cancels; with reduced motion the path appears at once.
- Selecting a router highlights its **subtree**, the devices whose known up path runs through it, with the count in
  Details ("7 devices route through this router").
- Fill "relay load" becomes available. Thread networks offer parents and neighbours only and say so.

### 7.3 Geo view [later]

Devices at stored positions on a flat map, later possibly 3D with floors; positions stored by the integration,
imported from GeoJSON points (properties `ieee`, optional `name`, `entity_id`) or placed by hand. Background: a
user-supplied image or map tiles from a user-configured address.

## 8. Visual language [v1]

- **Device symbols**: one symbol per device, a rounded square on a 24-unit grid (outer edge 0.7, corner radius 5.05,
  frame 1.1) holding everything; nothing sticks out. Inside, scaled 0.92 about the centre: the **picture** (kind, 4.2;
  coordinator a hub, unknown a question mark), radio arcs above it for radio devices, a cable (plug and bend) below
  it for wired or also wired devices (coordinator, border routers); on the right a bed for a sleepy end device, or a
  crown with "C" (coordinator) or "L" (Thread leader), and then picture, arcs and cable move 3 units left. Unknown
  sleep shows no bed.
- **Role**: a router's frame (coordinators and border routers included) is open at 8 places, two per side at 8 and
  16, gaps 2.6 wide, each with a short stroke from the outer edge inwards to 2.75; its fill reaches the outer edge, so
  the outline stays closed and links end at one contour. The strokes mean the role, not a neighbour count. Every
  other role, unknown included, has a closed frame.
- **State**: offline has no fill (map background); selected a frame of 2.2 grown inwards; pinned a small pin inside
  at the top left. Hover changes only highlighting (7.1). No dashed outline: beside the gapped router frame it would
  be ambiguous; devices without readings show it by their place on the ring (7.1).
- **Size**: 32 px at zoom 1 for every device, growing with zoom up to 1.5 times (48 px), never below 20 px on screen
  (provisional, not decided). Symbols never change with the density.
- **Fill** of the symbol's background, one selectable: none (default), role, power source; relay load in v1.1; time
  since last heard later. Areas and vendors are "highlight group" filters (later), not colours. With none, every
  symbol is neutral grey (`#c5c8cb` light, `#5c6166` dark) with lines in the theme's foreground; reception shows at
  the arrows, not as a fill. Under role and power the lines take the theme's foreground or background, whichever
  contrasts more with the fill (at least 3:1 on every fill used). A device without a value under the current fill is
  grey with a slash, a fixed pair (`#bfbfbf` light, `#393939` dark).
- **Category fills**: the four Okabe–Ito colours near 3:1 on white and near-black, nudged to 3:1 per theme: role
  (coordinator vermillion, router bluish green, end device blue, border router reddish purple), power source (mains
  blue, battery reddish purple, DC bluish green). ZHA's "Battery or Unknown" counts as battery, and the legend says
  so.
- **Lanes**: the dash says the evidence, the width the role and the rating; colour by reception only on request (7.1).
- **Palettes**: Okabe–Ito for categories; graphic elements reach 3:1 against light and dark
  Home Assistant themes. Colour never carries meaning alone (7.1). The opt-in path display coloured by reception uses
  by default red, yellow and green per theme (light #d93a26, #b58300, #1d6f31; dark #f2604d, #f2c230, #3fbd5c),
  CIELAB lightness at least 8 apart so they differ without hue; the user may replace each for both themes. The scale
  is interpolated between the three and nudged to 3:1 against the background; numbers and widths say the same.
- **Labels**: a block of up to three lines, each switchable (View tab, stored 11): the **type** above the symbol in
  grey (kind, 4.2; none for an unknown kind, whose symbol shows "?"; on), the readable name
  below (user's name, else model; on), and the original Home Assistant name (the integration's registry name) in a
  smaller grey line below, only where it differs (off). The type line shows only from the working scale (9.3) up.
  - Labels are text, never HTML. A name keeps the part that distinguishes it from similar names (cut shared
    beginnings at word starts, keep the end); identical readable names get the network address appended.
    At the dense setting a name is cut to fit 128 px (about 20 characters); at medium, wide and custom only a name
    longer than 28 characters is cut, by the same rules, so those labels may overlap more; labels follow a density change.
  - Below a scale measured on screen (devices half a label width from their nearest neighbour, so a spread map is
    labelled from a smaller zoom) only the engine's anchors (Zigbee coordinator; Thread leader and border routers),
    the selection and its neighbours carry labels.
  - A block tries five places, as a whole, every line free of other devices and texts: (1) split, type 3 px above and
    names 3 px below the symbol, each centred; (2) all 3 px below, centred; (3) all 3 px above, centred; (4) right of
    the symbol, 4 px from its edge, left-aligned, centred vertically; (5) the same on the left, right-aligned. Equal
    places (the name alone: 1 and 2) are tried once. Without a free place the block is left out, except for the
    coordinator and the focus, which take the first place, and every device on the focus's paths, which takes the place
    covering least of the focus's values; a value it still covers is drawn again on top (overlap accepted).

## 9. Interaction [v1]

### 9.1 What is on screen

One place per thing; nothing appears twice.
- **On the map, only:** top left a button **Devices** with the findings count as badge and below it a slide switch
  **Details on click** (`role="switch"`), shown only while the left panel is closed; top right a button **View** and
  below it **Legend**; bottom right the zoom group (+, −, fit) with the "Spread" group above it (7.1); the status pill at the bottom centre (below); banners (incomplete
  data, connection lost, reading) between the top groups, or below them where that leaves less than 280 px. No header
  bar: the map fills the panel; on narrow screens Home Assistant's sidebar button joins the top left. Controls are
  rounded, on the theme's surface with a light shadow, targets at least 44 px. View switch **[v1.1]**.
  **System insets** (#4): Home Assistant pads the panel's container with `--safe-area-inset-*` (status bar, Android navigation bar), so the panel is the viewport height minus the top and bottom inset, never a bare 100dvh; the phone's full-screen history window, in the top layer, pads the bottom inset itself.
- If the device or area registry cannot be read, the map keeps the integrations' own names and the pill's menu adds
  the line "Names and areas not read".
- **Status pill** [spec 6; boards M31, M32]: a floating control at the bottom centre of the map, between the panels' insets,
  styled like the other floating controls (48 px high, 14 px corners, theme surface, light shadow). Left to right: a
  round arrow button (30 px, light grey, chevron up; down while the menu is open), two lines (the network's name,
  bold 15 px; the data state, 12 px, 6), and the dot last. The whole pill is a WAI-ARIA menu button (`ui/status-pill.js`;
  `menuitemradio` for networks, `menuitem` for the rest, arrows move, Esc closes and returns focus) opening upwards;
  hover: outline, darker arrow button, pointer. The menu holds, top to bottom: **Network** (the networks, an unreadable
  one greyed with its reason; omitted with one network, the pill still opens the menu), the full data state (6; including
  the source-route stage "Return paths assumed for 8 devices (source route)", "Source route off · 8 return paths
  unknown", "Source route from zigpy · 6 recorded, 2 assumed", "zigpy not available · 8 assumed"; nothing when no device
  is concerned or in the view "routing table", 5.1; a followed scan with its Stop button), and **⚙ Settings ↗**.
  Settings opens Home Assistant's page of this integration, `/config/integrations/integration/meshroute_topology_explorer`, in
  the same tab the way Home Assistant's panels navigate (`history.pushState`, then the event `location-changed`;
  modified clicks keep the browser's behaviour); shown to administrators only. The View tab ends with the same link below a
  divider ("⚙ Settings (Home Assistant) ↗", and the grey line "Integration options in Home Assistant"). Where the map is
  narrower than 600 px the second line is hidden and the name is the network's short one ("Zigbee", "Thread"); the dot
  keeps the state. The pill leaves 72 px at each side for the zoom group, and the fit leaves room below the map for the pill.
  Switching networks clears the selection, keeps the panels on their tab and refits the map; the first load shows Zigbee
  where it can be shown. Greyed entries: Thread when the Matter integration is not running or its topology is not
  supported, empty or unreadable; Zigbee when ZHA is not running or its devices cannot be read (#15, 9.4). A network
  that is not set up is not listed.
- **Two panels.** The **left panel** has the tabs Devices, Findings (with count) and Details; the button Devices opens
  it on Devices. The **right panel** has View and Legend, each opened by its button. A button pressed while its tab is
  in view closes the panel. Wide screens: side panels on their own side (both may be open), hiding their corner's
  buttons. Narrow screens: bottom sheets, one at a time. A panel never covers the selected device (the map pans).
  Closing (×, Esc) returns focus to where the panel was opened.
- **Devices:** a search field ("Name, model, area, address"), a line saying what a click does, the list (9.3), and a
  count only while a search filters. Rows: coordinator first, then by name; the name in bold, below one grey line:
  type · role ("sleeps" for a sleepy end device) · "direct to the coordinator" (an end device whose parent it is, a
  router whose up path is one hop) or "via <parent>" for other end devices · area (`hass.areas` name before the
  registry's) · "unavailable" when down. The reception rank is in Details.
- **Findings:** the badge counts findings without hints ("very low reading") and each missing table once. "Data
  incomplete" and the hedged "parent unknown (tables of … missing)" are consequences of missing tables, not verdicts:
  the tab lists them by the table they name (a finding lacking several tables under each, a table only one device
  misses flat), and the badge counts them only through that table. The unhedged "no parent" is a finding of its own.
  Hints sit in their own collapsed group.
- **View** tab, in this order:
  - **Communication paths**: one radio group of the three views (7.1), each with a one-line hint; the routing table's:
    "Each router's table names the next hop to a destination. This view follows those entries until the destination
    or a gap; a listed neighbour is reached directly." Indented under it, greyed in the other views: the checkbox
    "include return routes" ("Follow each destination's route back by the same rules.") and then "additional heard neighbours (best 3)"
    ("needs a selection: adds the device's 3 best partners with a reading and no drawn lane"; no info button). Below
    the group: "Each view has its own basis. Debug shows everything."
  - **Path display**: grey or coloured by reception, info button "Colour shows the relative reception rank, not
    connection reliability."; three colour pickers (lower, middle, higher reception rank), prefilled with the theme's
    red, yellow and green, dimmed and inert while grey, and while coloured a way back to the defaults (7.1, 8).
  - **On click on a device**: checkbox "Open details", the same setting as the map switch; what the map shows on a
    click follows the communication paths.
  - **Return paths without a table entry (source route)**: off (return path "unknown"), assume (the way up reversed,
    dash-dot), read from zigpy (tagged "experimental") (5.1); info button "The return path is assumed to follow the
    outbound path in reverse. It has not been verified."
  - **Node distance (density)**: Dense, Medium, Wide, Custom with the stepper "− ×3.3 +" (7.1); info button "Spacing helps arrange the
    network. It does not show physical distance."
  - **Symbol fill**: none, role, power source. **Labels on the map**: device type above, readable name below,
    original Home Assistant name (8).
  - Below a line: debug mode; "Read data again" with an info button whose note the adapter supplies (ZHA: reloads
    the tables ZHA holds, starts no radio scan, ZHA reads them itself every 4 hours by default, 6; Matter: reloads
    the Matter server's cached topology, no radio scan, refresh false, 3.2); "Release all pins (n)"; in debug mode the
    scan (6); a note on where settings are kept, only when not in Home Assistant (11).
  - Group titles 13 px bold; rows 32 px with a fine pointer, 44 px with a coarse one.
- **Legend** tab, compact, in sections:
  - **Communication paths**, one row per evidence whatever the view: read from a routing table (every view);
    assumed or derived "(views 1 and 3)"; computed, "a candidate, not observed traffic" "(computed, view 3)"; heard only
    "(option under "Routing table", needs a selection)"; one row for the width by role; the band; the glyphs "–" and "?" wherever
    the map can show them (option on in the routing table view, debug); in debug mode also the lane without traffic,
    the width steps and the unknown end; the number in the line (the reception reported by the receiver at the
    arrowhead, drawn in a pill; receivers may use different scales), with the text "Number in the line = reception at
    the arrowhead"; the colour bar while paths are coloured. These rows come
    from the graph's own legend entries.
  - The fill while one is chosen.
  - **Symbols**: one row per sign, drawn at 40 px by the map's own code on a device of the network with its picture
    (router frame with gaps and strokes; closed frame with a bed for a sleeping end device; crown "C" and plug for the
    coordinator; plug without arcs for a wired-only device, if any). **States**: offline, selected, pinned.
  - Thread: parent link, neighbour (measured, from the neighbour table; no route data), the glyphs "–" and "?", and
    "RX" as RSSI in dBm, link quality 0–3 where no RSSI was reported (`THREAD_VALUE`).
  - Longer explanations stay in this specification.
- **Debug mode** (View tab, not stored): values and reporters on both lanes, hop numbers, raw tables in Details, the
  scan, per-router "observed unchanged since". ZHA's raw value texts (power source, relationship, device type and the
  like) are translated everywhere, with the raw text beside them in debug mode.
- **Sizes**: wide means a panel at least 720 px wide; a side panel takes 36 % of it within 320–384 px. The expanded
  sheet takes 55 % of the map (at least 240 px, always leaving 120 px of map). Opened by Details on click from the
  map, the sheet starts collapsed to one line; opened on request (button, right-click, long press, menu key) it
  starts expanded, as one line shows no list.

### 9.2 Selection and details

- Click or tap selects a device in every view; the selection shows its paths in the node view (7.1) or plays its path
  (route view). Clicking the background or Esc clears it.
- **Details** (left-panel tab): the name in bold, one line "type · role · vendor model" ("unavailable since …" below
  when down; administrators: a **History** button beside the name, 9.5), then a segmented control (WAI-ARIA tabs, arrows move) with three sub-tabs, each a stack of cards with a
  small bold heading. At the narrowest side panel it takes less padding and type, never an ellipsis. The sub-tab stays
  when the selection changes.
  - **Communication**:
    - "Communication path with the coordinator": one line per path, every hop with the reception at its hearer, the
      value in bold ("there: Sensor → Router 17 · RX 103 → Coordinator · RX 51", "back: …"), each line ending in a small "history ↗" (9.5); an assumed return path
      "back, assumed (source route): …" with a note; a recorded one "back, measured (route record, age unknown): …"
      with a note naming the radio library and that zigpy keeps no time for it; "Route record differs: via …" under a
      complete measured one the record contradicts (5.1); "path unknown" where a walk stops; an unavailable goal named
      so. For the coordinator in stage 1 its routes ("to X", "from X"), collapsed above 12 lines.
    - In stage 2, **"Paths to other devices (theoretical)"** (5.7), collapsed above 12 rows; its note (computed, not
      observed, and how) at the top. A row per other device: hops there (→) and back (←), shortest first, equal counts
      by name in natural order (Router 2 before Router 10), the whole path's cost at the row's end. No "weakest RX"
      summary in this list: it would mix a missing value with a low one and compare receivers on different scales
      (the path history, 5.8, names a weakest hop by rank, never by raw LQI, and leaves out hops without a reading). A row opens to
      both ways, every hop with its RX and how it is taken ("routing table entry", "direct to a neighbour (no table
      entry needed)", "route discovery (computed)", "parent", "child"; "table not read" or "entry inactive" where
      the holder had none), a discovery with its path cost, a stopped way with its reason. A "–" hop names its basis
      ("Basis: Router 05 hears Router 13 with 48; Router 13's table is full (16/16)"; where the table has room "Link
      probably one-sided or aged").
    - In the view "table", **"Routing table · n"** after the coordinator card (for the coordinator itself the only
      path card, as its stage-1 list would repeat the routes), collapsed above 12 rows: a row per destination of the
      usable entries by name, hops there (→) and with "include return routes" back (←), "?" for a stopped walk. A row
      opens to the walks, every hop with its RX and how it is taken ("routing table entry", "direct to a neighbour (no
      table entry needed)", "child", "parent"), a gap
      as "path unknown beyond X (no entry | entry inactive | table not read | loop | unavailable)". Notes: what the
      view follows; that return routes are off, or that a missing one is no verdict on the link; that route records
      and assumed return paths are another basis. Without rows it says why: "No usable routing-table entries on this
      device.", "End devices keep no routing table; their parent routes for them.", or that the unavailable device's
      table is stale.
    - The parent (end devices: availability, LQI at the parent, receiver when idle, possibly stale parents) or the
      children ("Children (end devices)", each with its model: not every end-device child sleeps).
    - The device's findings with evidence and "Show in Findings", only if it has some.
    - "Heard by n · hears m": the reception, the 5 best readings as rows of name, RX and rank relative to the
      reporter, the rest and what the device hears behind "… all with RX and rank relative to the reporter".
    - "Tables and load": neighbour table against the model's capacity, routing table, relay load, the routing entries.
      Debug mode adds the raw tables.
  - **Entity**: the node card with badges for logical type, power source, receiver ("always listening" / "sleeps when
    idle", MAC capability bit 3), frequency band (node descriptor) and stack revision ("Zigbee PRO r22", server mask
    bits 9-15; 0 is "before r21"); then IEEE, network address in hex and decimal, manufacturer with code, model,
    firmware (`sw_version`, else "unknown"), quirk (only an applied one), buffer and transfer sizes, last heard. "Open
    in Home Assistant": device page, ZHA's Zigbee info (`/config/zha/device/<ieee>/signature`, ZHA only), area page,
    logbook and history filtered to the device's entities (`entity_id` list), entity list
    (`/config/entities?device=<id>`); links stay in the app. Then the entities; a click opens Home Assistant's
    more-info dialog (event `hass-more-info`).
  - **Cluster**: every cluster of the signature (name, id as `0x0006`, direction In or Out), grouped by endpoint with
    profile and device type names and ids; manufacturer-specific clusters (0xFC00-0xFFFF) carry the vendor's name and
    a "manufacturer-specific" tag. A note: In is the server side (the device offers the function), Out the client side
    (it uses it at others). A row or its button opens the cluster details.
- **Cluster details**: a modal dialog (focus kept inside, Esc, close button, focus back to the row): name and id;
  device · endpoint · direction · profile; one sentence on the cluster and on In or Out; the attributes the public ZCL
  specification lists (id, name, type, side; [v1] catalogue: Basic, Power Configuration, Identify, Groups, Scenes,
  On/Off, Level Control, Color Control, OTA, Poll Control, Temperature, Humidity, Occupancy and Illuminance
  measurement, IAS Zone, Metering, Electrical Measurement, Diagnostics, Touchlink), else "no attribute list known".
  - A **current value** where Home Assistant knows it as the state of the device's one obvious entity (On/Off → light
    or switch state, current level → brightness, colour temperature → `color_temp_kelvin`, measurement clusters and
    battery percentage → the sensor of that device class), else "—".
  - **"Read values from the device"** reads the attributes of the device's side once, one after another
    (`zha/devices/clusters/attributes/value`, 3.4), shows each result ("from the device", "no value", "no answer", an
    error), stops at the first timeout (15 s) or error and sends nothing after the dialog closes; a hint for sleepy
    devices.
  - "Manage in ZHA" (`/config/zha/device/<ieee>/clusters`) and "The map is read-only: writing, reporting and binding
    are done in ZHA's device management."
- **Thread device details**: no sub-tabs (no signature, no clusters): the head (name, role, "Thread leader" where it
  applies), "Neighbours (Thread)" with both directions per neighbour ("hears X: −75 dBm · LQI 3", "heard by X: …",
  parent first), the device's findings, and the Thread facts (role, extended address, RLOC16, Matter node id; "not
  reported" where missing).
- **Details on click** defaults to on for wide screens, off for narrow ones. It applies to clicks on the map and in
  Devices: it opens the left panel on Details (closed, on Devices, or following on Details), never takes Findings away
  and on narrow screens never pushes the right sheet away. Selecting from Findings or a device named in Details zooms
  to the device and keeps the list. Clearing the selection on the map closes a panel that Details on click opened and
  that still shows Details. Right-click on a node (captured on nodes only), long press or the menu key open Details
  whatever the switch says.

### 9.3 Gestures and keys

- One gesture model: a press moving less than 8 px is a tap, more a drag (node: pin and move; background: pan). Long
  press: 500 ms within 8 px. Pinch zooms. Wheel: × 1.2 per notch around the pointer. Zoom 0.1 to 8 times the fitted
  view. Buttons +, −, fit. Above them, the group "Spread" (own icons, apart / together; tooltips "More space between devices" / "Less space between devices") steps the custom node distance (7.1).
- Selecting in the list or a finding, a double click or Enter zooms and pans to the **working scale**, at which
  devices of the base layout (D = 1) sit one mean label width from their nearest neighbour (density not compensated:
  wide shows 2.28, medium 1.44, dense 0.96 label widths; never out past the overview), and keeps the device clear of
  the panels.
- A tap on the map zooms the same way only if the shortest lane of the selection's paths (`shortestFocusLane` in
  `graph/renderer.js`) would be under 24 px on screen (`TAP_ZOOM_MIN_LANE`): lanes under 4 px are not drawn, and a
  single skipped hop breaks a path. Otherwise the view only pans clear of edge and panels. Hover never zooms.
- Hover previews the selection highlight on pointer devices; nothing depends on hover.
- Keys: arrows and Enter in the device list, the keyboard path to every device (its filter matches words in any order
  in name, model, vendor, area and addresses); Esc clears selection and stops playback; Space plays again; Right
  arrow steps; +, −, 0 zoom; `[` and `]` less and more space between devices (7.1), on the focused map like the zoom keys. Closing a panel returns focus to where it was opened. Hit areas at least 24 px.
- Every canvas value also exists as text; the status pill describes the canvas; playback is announced in a live
  region ("path: 3 hops, LQI 120 / 89 / 45").

### 9.4 Errors and empty states

Clear messages for: user not an administrator; connection lost (retry automatically); scan running; and, when no
network can be shown, the reason of each source that is set up, one line each in menu order, "Zigbee cannot be shown:
…" (ZHA is not running ({state}), ZHA has no devices yet, ZHA's devices could not be read) and "Thread cannot be shown:
…" (the Matter integration is not running ({state}), the Matter server does not offer the topology, the topology lists
no Thread device, the topology could not be read), with a retry; the block takes the worst tone of its lines (error,
else warning, else neutral). A source is set up when it has a config entry that is neither ignored nor disabled
(`config_entries/get`); it is running when one such entry is loaded, else it is "not running" with that entry's state
(`setup_retry`, `setup_error`, ...). Only with no such entry for either source the one message is "No Zigbee or Thread
network: set up ZHA or Matter, then try again." (owner 2026-11-08, #15). Each source is read on its own: a source that
is not running or whose read fails is greyed in the network switch (9.1) and the other is shown; the error page
comes only when no network is left. A lost connection keeps the last picture under a banner and reads again when the connection
is back.

### 9.5 Path history window [v1.1]

Code: `frontend/ui/history-*.js` (window, loader, host, partners, links, route, route-view, timeline, lane, sparkline, chart, texts); data:
5.8 and 10.2; boards M35, M36. Administrators only (the commands are admin only).

- **Entry:** with a device selected, every other device shows a small grey badge at its top right, a question mark drawn
  as a route (hops between nodes; the hovered one dark). Hover: "Path history with {selected}" and, for Zigbee, "there 4
  hops · back 3 hops" (the live network's walks, selected to other and back). A click opens the window for the pair and
  leaves the selection. Thread: no hop counts.
- **One-click entries** (owner 2026-11-05), (2) and (3) open this window on the tab used last (the first time Timeline); none
  changes the map selection, administrators only: (1) a click on any value pill drawn on the map (the selection's lanes
  and the overview's) opens a small **Direct link card** at the pill (not the window; correction 2026-11-05, board M37b B): title
  "Direct link: A ⇄ B" (the selected device first), both directions one line each ("B hears A · 64 · rank 45 %", Thread "−75 dBm · LQI 3")
  with a 48 h sparkline (Thread: RSSI) from the loader's cache (values alone while loading; the loader's state text without a
  recording), and the buttons "Direct link history ⇄" (window on the Direct link tab, last 48 h) and "Route history" (window on
  Timeline, same pair); × and Esc, a tap on the empty map or another pill closes or replaces it, one card at a time, a phone gets a
  bottom sheet; hit area at least 24 px around the pill, pointer cursor, title "Direct link: A ⇄ B"; (2) the **History** button next to the name in Details (9.2); (3) "history ↗" on the lines of
  "Communication path with the coordinator". Terms: a **direct link** is two neighbours that hear each other (history in
  both directions), a **route** is the way between two devices.
- **Window:** modal dialog "A ⇄ B" with ×, tabs Timeline, Route, Direct link (the last one used is remembered), ranges 48 h, 7 d,
  30 d, 90 d limited to "Keep for" (read from `history/info`: `keep_days`, with `record` and `problems`); a full-screen
  sheet on a phone. Records are read per range (`history/records`) and cached per network and range for 5 minutes; the
  live input is what the panel already holds (`network.live`).
- **Partner menu:** the second name in the header is a menu: the coordinator (Thread: the border routers) first, then
  the first device's neighbours by reception (strongest first), and a search over all devices. A change keeps tab and
  range. The History button's partner: the coordinator, Thread the border router with the strongest link; for the
  coordinator or a border router itself its strongest neighbour by reception.
- **Timeline** (Zigbee): per direction a band of route spans ("via X, Y", "direct"; a walk that stopped is a dashed gap
  with its reason) and under it the rank of the weakest hop at its receiver over time (0 to 100 %), a point per record, the
  weakest hop named where it changes. Weakest = by rank, never raw LQI; a hop without a reading is never the weakest; a route of one hop has none.
  Thread: a note, no bands.
- **Route** with a switch Metro-Map | Mesh, a shared time slider (record ticks, play) and the record kept when switching.
  Metro-Map: there above, back below; stations are the map's symbols in shared columns with dotted verticals;
  arrowheads; the RX pill of each hop placed as on the map (a quarter before the arrowhead, at most four symbol
  diameters; "Parent" where an end device's parent link has no reading); the weakest hop with a red outline and a thicker
  line; routes before the shown record as faded dashed ghosts with their last value, no date. **One structure per pair and range
  (owner 2026-11-05):** stations (Metro-Map columns, Mesh fit) are the union of every device on the way there or back in any record
  of the range, laid out once; the slider only changes highlighting: the shown record's route solid, other devices of the
  union faded, later routes not drawn as lanes. Changing pair or range recomputes; slider and play never do. Thread keeps its per-record view. Mesh: the same hops at the
  devices' current map positions, each direction offset to the right of its travel, ghosts dashed. Thread: the direct
  link both ways (Metro-Map) and its neighbours in that record (Mesh), pills stacked ("−75 dBm" over "LQI 3").
- **Direct link:** a click on a pill (ghosts too) opens the Direct link tab for that hop, centred on the record shown (±48 h, ±24 h, ±7 d,
  ±30 d), the pill and its two nodes ringed in Route. Above the chart the strip: the route's nodes, the lane's two ringed
  with both directions in the chart's colours, and "way back, Nov 2 08:00: hop 2 of 3". One LQI axis (0 to 255; Thread 0
  to 3) for both directions, blue "Y hears X", orange "X hears Y"; the clicked record dashed; "after now: no records" and
  "lane not used yet" as areas; hover crosshair with both values; "Show as table". Thread: RSSI in its own chart below,
  never a second axis. From a Details row: the last 48 h.
- **Details** (9.2), "Heard by · hears": each row gets a 48 h sparkline (one grey series, the last point a dot) and "48 h
  min–max"; a click opens the window on the tab Direct link. Zigbee only.
- **States:** not recorded ("Reception history is not recorded. Settings ↗", also instead of the sparklines), no records
  yet, source not supported (the problem of the shown network's own source, `problems`; never the other network's),
  fewer than 3 records (points only), a refused command (message).
- **Dev page:** `?history=<name>` reads `captures/<name>.json` (git-ignored), `sample` the committed fixture, `none`, `off`,
  `unsupported`; `keep=<days>`.

## 10. Integration [v1]

- Custom integration with a config flow; manifest `name` "Meshroute Topology Explorer", domain
  `meshroute_topology_explorer`, version, documentation, issue tracker, code owners, `brand/icon.png`, `hacs.json`;
  hassfest and HACS checks in CI. No Python dependencies beyond Home Assistant; it needs neither ZHA nor Matter and loads
  after both where they are set up (`after_dependencies`). Minimum Home Assistant 2026.10 (owner 2026-11-06):
  forms use `probatio`, which replaced `voluptuous` there; `tools/guard.py` forbids importing `voluptuous`.
- One admin panel (URL path `meshroute-topology`, custom element `meshroute-topology-explorer`), removed on unload. The panel
  takes the viewport's height (Home Assistant's custom-panel container has none) and brings its own sidebar button
  on narrow screens.
- Websocket commands, each checking admin rights, validating input and rejecting payloads above 256 KiB:
  `meshroute_topology_explorer/settings/get` and `/settings/set`, `meshroute_topology_explorer/observations/get` and
  `/observations/set`. Data is per network, shared by all administrators, kept in a Home Assistant store.
  - Requests carry `network` (1–64 characters of `A-Za-z0-9_.:-`; the network ids of 11) and, for `set`,
    `settings` or `observations` (a JSON object, at most 256 KiB compact UTF-8, replacing the stored one).
  - Results: `get` → `{settings: object|null}` or `{observations: object|null}` (null = never set); `set` → `{}`.
  - Errors: `unauthorized` (not an administrator), `invalid_format` (bad `network`, field missing or not an object),
    `payload_too_large`, `storage_unavailable` (the stored file cannot be read; nothing is written).
  - Registered once per run on entry setup; they keep answering after unload.
  - Home Assistant moves a corrupt store file aside, which counts as never set; `storage_unavailable` only for a newer
    store version or I/O errors. Validity is checked with Home Assistant's JSON writer, so anything the store could
    not write (e.g. nesting deeper than 254 levels) is `invalid_format`. Removing the integration deletes the file.
- Panel files are served from a path containing a content hash of the frontend folder, computed on entry setup, so
  caching is safe and an entry reload ships changed panel files without a restart; each hash's path is registered
  once per run.
- The panel loads as one module, `dist/panel.js` (owner 2026-11-08, #16: about 100 module files took 4 s to 50 s on a
  remote link). `tools/bundle.mjs` generates it from the sources beside it, and it is committed with every frontend
  change; the pre-commit hook `bundle-fresh` fails when it no longer matches them. The sources stay in the folder for
  the tests and the dev page, and the content hash covers both.
- The panel defines its custom element only if the name is free, compares its version with the integration's and asks
  for a reload when they differ, does not reload data when Home Assistant pushes a new state object, and unsubscribes
  and stops drawing when hidden.
- Texts in English only: one flat table per part, merged in `ui/i18n.js`. Dates and numbers follow the user's Home
  Assistant locale.

### 10.1 Options [v1]

"Configure" on the integration (Settings > Devices & services; administrators only) opens one form; saving reloads the
config entry, never Home Assistant. Stored flat in the entry's options (defaults apply to missing keys). Layout (owner
2026-11-08, #15): "Show in the sidebar", the section "Reception history", and the section "Zigbee (ZHA)" only when ZHA
has a config entry that is neither ignored nor disabled (loaded or not). A hidden section sends nothing; its stored
values are kept (the form is checked against the stored options, not the defaults). Thread will get its section with
the query mode of #12/#14 ("off" is its switch).

| Option | Default | Effect |
|---|---|---|
| Show in the sidebar (administrators) | on | Off: the panel is not registered (removed on reload); the websocket commands stay. |
| Record reception values (history) | on | Off stops recording; records stay until they expire. When they are taken: 10.2. |
| Allow scan and attribute reads in the panel (Zigbee; key `radio_actions`) | on | Off: the panel config carries `radio_actions: false`; the panel hides the scan control and the cluster dialog's read row. A switch of this panel, not a lock: the commands are ZHA's own, and administrators can still use ZHA's pages. |
| ZHA's scan period (Zigbee section text) | - | Shows "ZHA scans every N min" ("ZHA's topology scan is off", with the note that a changed period would also need `topology_scan_enabled: true`; "unknown" where the period cannot be read) and a note how to change it: add `zha:` / `zigpy_config:` / `topology_scan_period: 240` (minutes, at least 20; more often than every 3 hours means more radio traffic in the whole network) to configuration.yaml and restart Home Assistant Core. No input field: the integration never writes configuration.yaml or changes ZHA at runtime. |
| Keep for (days) (history) | 30 | 1 to 90, else refused with the range. |
| Scan once 30 minutes after Home Assistant starts (Zigbee) | off | Once per Home Assistant run (a reload of the entry does not repeat it, an unload before the time cancels it), only if recording is on, "Allow scan and attribute reads" is on, ZHA is running, its scan task is seen and not running, and the newest Zigbee record is older than ZHA's period (or none). It asks ZHA through its registered `zha/topology/update` handler (in-process, no parameters; never the topology's own scan method); the scan's events are recorded by the normal path (10.2, guarded, floor). `history/info` gives `last_forced_scan` or `forced_scan_note` (why it was skipped). |
| Delete the recorded history (history) | off | Acts on Submit (when the form is valid), not stored. |

### 10.2 Reception history [v1]

Records the reception values over time (board M33/M34 option A), in the integration's own files, never in the recorder
or statistics. It takes what ZHA and the Matter server already hold and never
starts a scan or writes to a network. When (owner decision 2026-11-03): ZHA's topology fires `neighbors_updated` and
`routes_updated` per device while it scans; a listener on `app.topology` (zigpy `add_listener`, cheap: it only resets a
timer) records once no event has come for 60 s and the scan task is done (follow mode `events`). The record is dated
with the end of the scan, not with the read. Never mid-scan: zigpy replaces the stored tables router by router while
it scans, so the integration reads the topology's scan task state (`_scan_task`, internal; 300 s of quiet instead and
`scan_state: unknown` in the info if the attribute is missing), waits for the task to end, drops a Zigbee read during
which a scan began, and postpones a record due within 10 minutes of the last one to last + 10 minutes instead of
dropping it; a scan that is still not over after twice ZHA's period writes nothing for it (Zigbee's problem). Every ZHA
(re)load builds a new topology: the listener moves to it when ZHA's config entry changes and on each Zigbee timer tick.
The Zigbee timer runs at ZHA's period and is restarted when that changes: ZHA comes up or reloads with another period,
or is gone (no running gateway: back to 240 min, zigpy's default; a running ZHA that names no period keeps the last); it reads Zigbee only where no listener can be attached (internals changed, said in Zigbee's problem), ZHA's
scan is off or ZHA is not running (`timer`), dated with the read and guarded the same way. Thread has no events: its
own timer reads only Thread every 4 hours, independent of ZHA (owner 2026-11-08, #15, until #12/#14 bring their own
schedule), and a snapshot is dated with the Matter server's
`collected_at`, which is the time of Meshroute's request (3.2); a Thread record therefore means what the Matter server
held when Meshroute read it, and the rule "skipped when not newer than the last one" does not fire in practice (it
still catches a clock step back). One Thread read follows 30 s after Home Assistant has started or
the entry was reloaded (in timer mode also Zigbee; in events mode Zigbee is not read then, since zigpy restores its last
scan from its database and it would be dated as new). Recording off keeps only a 6-hour expiry timer. The values come from the
registered handlers of `zha/devices` and `matter/network_topology`
(`refresh: false`) are called in-process (`hass.data["websocket_api"][command]`, exactly these two). Zigbee adds zigpy's
route records (`zigpy_routes.read_routes`, in memory). Fragile parts: that registry layout and handler calling convention
(core-internal) and the zigpy reader; any mismatch is logged once per change, kept as the problem of its source (`zha`
or `thread`; a read of one source never clears the other's) and shown by `history/info`, and
writes nothing for that source (a failed route-record read still writes the rest). A read that has not answered blocks
the next one of that command (no piling up). The Thread side mirrors the panel's node, duplicate and "measured" rules
(`from-matter.js`): unknown strength and link quality 0 without RSSI are no values. Expiry runs even when a source fails,
and a delete wins over a read still under way. Unavailable devices' tables are skipped
(stale). A network without table entries and routes is not recorded.

- **Files:** `/config/.storage/meshroute_topology_explorer_history/<network id, URL-quoted>.<UTC day>.jsonl`, append only,
  one file per network and day; writing and reading run in the executor. Lines: `{"k":[keys]}` extends the file's key
  table; `{"t":epoch,"e":[[receiver,sender,lqi(,rssi)]],"r":[[holder,destination,next hop,status]],"l":[[device,[relays]]],"p":[[child,parent]]}`
  is a record (`r`, `l`, `p` left out when empty); `{"t":epoch}` alone repeats the previous record. The first record of a file is
  full. Keys: IEEE (Zigbee), the Thread adapter's key (extended address, else `thread:<node id>`); a network address no
  device holds stays text (`0x2B82`). Receiver = the device whose table reports the value (it hears the sender). Status =
  ZHA's route status text. `p` holds the parents of end devices (4.5): a holder's neighbour entry with relationship "Child" and device type
  EndDevice gives [that device, the holder]; a router's own join parent is not one. Available devices only, duplicates
  merged; a child with stale entries can show two parents.
- **Dedupe:** the whole record (neighbours, routes, relays, parents) is compared with the previous one, kept in memory per network
  (restored from today's file after a restart).
- **Retention:** day files that ended more than "Keep for" days ago are deleted (also while recording is off). Removing the
  integration deletes the folder; turning recording off does not.
- **Size:** the owner's Zigbee network (47 devices, 649 neighbour entries, 153 routing entries) is about 10 KB per full
  record (about 7 KB for the neighbour entries, parent links add about 0.3 KB), so at most about 2.4 MB for 30 days at ZHA's default of 240 min with every record changed;
  unchanged records cost a line.
- **Commands (administrators):** `meshroute_topology_explorer/history/series` (`network`, `sender`, `receiver`, `since`
  epoch seconds) returns `{sender_to_receiver, receiver_to_sender}`, lists of `[time, lqi(, rssi)]` (the receiver's table
  value for the sender, and the reverse; a record without the entry gives no point); `history/records` (`network`, `since`,
  optional `until`) returns `{k, records}` in the file format with one key table over the range, the first record full;
  `history/info` returns `{records, first, last, bytes, problems, last_error, record, keep_days, zha_scan_period, zha_scan_enabled, follow_mode, scan_state, last_forced_scan, forced_scan_note}`; `problems` is `{zha, thread}`, each source's last problem or null (the panel's source keys), `last_error` both joined (kept for older readers). The UI (9.5) reads `record`, `keep_days` and `problems` by the shown network's source.

## 11. Settings per network [v1]

*Format goldens:* `tests/fixtures/golden/` holds the on-disk formats as written by the current code (day file, `history/records` answer, `zigpy_routes` answer, store file version 1); a format change keeps the old file there as the sample to migrate from.

Each network keeps its settings under its id (ZHA: config entry id; Thread: `thread-` plus the extended PAN id). The
chosen network (`network`: `zha` or `thread`) is stored under the reserved id `panel` by read-merge-write; the first
load shows Zigbee where it can be shown, else the other network (9.1).

Keys:
- Density: `density` (`dense`, `medium`, `spread`, `custom`; else `medium`) and `densityFactor` (the custom D, a number clamped to 0.6 to 8; else 1.44).
- Communication paths: `paths` (`coordinator`, `table`, `all`; else `coordinator`); `heard` (boolean, "additional
  heard neighbours (best 3)", default false, kept in every view, drawn in `table` only); `returnRoutes` (boolean,
  "include return routes", default false).
- Path display: `pathColors` `{ mode, bad, medium, good }`; `mode` `grey` or `coloured` (else `grey`); each colour
  only as `#rrggbb`, anything else, `null` included, meaning the theme's own.
- Labels: `labels` `{ type, name, haName }`, booleans; a bad or missing value counts as its default: on, on, off.
- Fill: `none`, `role` or `power` (else, including the former `reception`, `none`).
- Details on click: `openDetailsOnSelect` (boolean, else by width).
- Source route: `sourceRoute` `off`, `assume` or `zigpy` (else `assume`, 5.1).
- Pinned positions; later geo positions and map background address (empty by default).

The panel saves one second after the last change, when the page is hidden and on leaving, by read-merge-write: it
reads the stored object and writes back only what it changed (last write wins per key, pins merge per device, unknown
keys are kept). Stored settings are untrusted: pins only under device addresses, coordinates within ±1000 base
lengths. If the stored object cannot be read, settings live in memory, the View tab says
so, and nothing stored is overwritten. After a lost connection they are read again.

## 12. Acceptance [v1]

| Target | Measure |
|---|---|
| Unknown beats wrong | On derived fixtures (sample with one table removed, with three removed, without the coordinator's table, coordinator table only) the findings are a subset of the complete sample's findings plus "data incomplete"; no "no parent", "isolated" or "weak reception" that the complete sample lacks; "parent unknown" only in its hedged form that names the missing tables. |
| Paths | On the sample: up paths complete 41 of 44, down paths 33 of 44, 23 of 33 differ, 2 active routes to unavailable devices. Assumed return paths (source route, 5.1) separately: 8 more devices, 41 of 44 (every available device) with a measured or assumed down path; none without the coordinator's table. Route records from zigpy (synthetic, tests/zigpy-fake.mjs: every complete way up, 2 broken): 6 recorded, 2 assumed, still 41 of 44; 23 records differ from a complete measured down path and are only named. Theoretical paths (5.7): 1640 between the 41 available devices besides the coordinator, all complete, hops 1507 discovery, 603 neighbour, 480 child, 480 parent, 198 table; a click on End device 06 gives 40 out and 40 in (parent 51, child 51, table 4, neighbour 23, discovery 77), on Router 13 (12, 12, 6, 38, 69), on Router 11 (12, 12, 13, 48, 32); the coordinator 41 and 41, all complete. |
| Lanes | On the sample: 656 lanes, 41 up, 52 down measured and 2 more assumed, 29 routes between devices, 457 heard only (458 with source routes off); the overview draws 95 lanes in the stage "coordinator" (93 with source routes off) and the backbone, 570 lanes, in "all" (with or without the option, as it needs a selection): 95 up or down, of the other 475 by their strongest kind 427 neighbour, 29 table, 19 computed only; the coordinator's trees add none; debug mode 583 lanes and 73 glyphs. Heard-only option on a click (effective under the routing table only): Router 13 draws 2 lanes in the coordinator view and 82 in "all" whatever the option says, 6 lanes in the routing table view and 11 with the option. Routing table: 129 entries, 127 usable, overview 99 lanes (101 distinct owner -> next hop, 2 towards an unavailable device have none); Router 13: 5 destinations, all walks complete (Router 24 over Router 17, End device 06 delivered by its parent Router 17); its return routes all complete: the coordinator's by its entry, Router 14, 24, 26 and Router 17 (after End device 06's parent hop) directly to their neighbour Router 13; the coordinator: 30 destinations, 30 return routes complete; an end device: none. All devices' table walks: 127 out (125 complete), 127 back (120 complete), 65 of their hops direct to a neighbour. |
| Candidate hit rate | On the sample the cheapest way (5.7 rule 5) names the real next hop of 11 of the 37 active, non-stale router entries whose next hop is not the destination (14 of 62 with the coordinator's entries); test in tests/model-theoretical.test.mjs. Not shown in the product. |
| Unknown hops | On the sample the complete paths to other devices (5.7) have 174 hops without a reading (87 on the ways out, 87 on the ways back), all neighbour hops on 72 lanes; on the ways out the hearer's table is full for 54, nearly full for 23, with room for 10; all show "–", none "?" (test "a hop whose hearer's table was read ..."). |
| Link evidence | On the sample: 241 pairs measured in both directions, 85 in one (12 of them implied by the parent, none by a route), 2 pairs implied by routes only; capacity 16 for IKEA and 26 for Signify models seen on several devices. |
| Parsing | Tests feed addresses as `0x` and `0X` text, numbers and LQI as text; string comparison fails the suite. |
| Fidelity | Rank correlation between drawn spring length and the reading's LQI over all readings ≤ −0.75 in every density, fixed seed. |
| Click classes | Hops of a click in stage 2 drawn computed, by each lane's strongest class and by the selection's own tree (7.1): Router 13 1 of 82 and 20 of 82; End device 06 2 of 85 and 34 of 85; Router 11 0 of 82 and 9 of 82; the coordinator 0 of 96 (its trees take no discovery). The overview keeps 95 / 570 lanes, 19 computed only. Router 13 -> Router 21 (route discovery over Router 11): Router 11 -> Router 21 is drawn computed, Router 13 -> Router 11 a derived route (dash-dot, not computed), as Router 13 reaches Router 11 itself as a neighbour. |
| Speed | Synthetic network of 300 devices and 3 000 readings settles (largest move < 0.5 px per step) within 5 s in Node, measured as the layout's own CPU time (process.cpuUsage) in a child process started with V8's `--single-threaded` flag (tests/layout-time.mjs), best of three runs of the same deterministic layout; about 0.9–1.2 s (Node 18.19 under WSL). 30 frames per second while panning on a mid-range laptop (debug mode shows the frame rate). A click in stage 2 on the sample stays under 100 ms of model time: process CPU time in a single-threaded child process (tests/click-time.mjs), so compiler and garbage-collector threads do not count, after two warm-up rounds of the four measured clicks, each the best of three fresh networks; slowest click 8–30 ms, median 14 ms of 7 runs (Node 18.19 under WSL). In the test process itself the same clicks read a median of 117 ms (one warm-up click) and up to 110 ms beside the other suites (two warm-up rounds). A click in the routing table takes under 6 ms; the backbone is computed once per network (about 20–70 ms wall on the sample). |
| Calm default | Default view state shows only the elements listed in 9.1. |
| Accessibility | Keyboard path to every device and value; hit areas ≥ 24 px; reduced motion honoured; 3:1 contrast of graphic elements. |
| Tests | No device needed; each suite under a minute; fixtures anonymized. |

## 13. Out of scope

Controlling devices; writing attributes, reporting configuration, binding (ZHA's device page does those); radio
traffic other than a user-started topology request or attribute read; installing anything into other add-ons; a
history database; anything sent outside Home Assistant; claims of compatibility or certification; a Wi-Fi or
Ethernet viewer and a Matter relationship view (Matter is an application layer; a Thread topology delivered through
Matter goes to the Thread engine, 3.2). Later and small: one previous snapshot for "since the last scan: links lost,
parent changed".
