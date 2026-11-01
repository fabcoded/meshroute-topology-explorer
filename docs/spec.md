# Specification

What Meshroute Topology Explorer does, described from the user's side and from Home Assistant's public interfaces.
It fixes behaviour, data rules and measurable acceptance, not code structure: how files and modules are cut is up to
the implementation. Terms in **bold** are defined where they first appear. Release tags: **[v1]** first usable
version (ZHA only), **[v1.1]** route view, **[later]** further sources and views. Status: reviewed draft, 2026-10-31; node view and colour by reception 2026-11-01; menu and labels 2026-11-01;
details in three sub-tabs, cluster details with a user-started attribute read, source routes 2026-11-01; communication
paths per direction in two stages and a heard-only option, compact legend, status line as on the boards 2026-11-01; theoretical paths to every
device and the backbone overview 2026-11-01; source routes read from zigpy 2026-11-01.

## 1. Purpose and principles [v1]

The explorer helps people find and understand problems in the Zigbee and Thread networks Home Assistant runs:
a lamp that drops out, a sensor that reports late, a corner of the garden that hangs on one weak link.

- **Debugging comes first, calmly.** The default view answers "is my network healthy and where is it weak" at a
  glance. Raw values, the reporting side of each value, tables and the scan live one click away (section 9.1).
- **Read only.** The explorer never changes a network or a device. The only radio traffic it may cause is a
  topology request the user starts and confirms (ZHA scan, Thread refresh, Zigbee2MQTT map request) and, on a button
  the user presses in a cluster's details, one read of that cluster's attribute values (9.2; decision by Fabian
  Schwamborn, 2026-11-01). Never automatic, never a write, no reporting, no binding.
- **Unknown beats wrong.** The explorer judges only through **findings** (5.6), and every finding names its
  evidence. Missing data never turns into a verdict.
- **Nothing leaves the house.** No telemetry, no third-party requests. Optional map tiles come only from an address
  the user configured.
- **Ship what you read.** No build step; Home Assistant serves the repository files as they are.

## 2. Users and questions

| Question a user brings | Where the answer lives | Tag |
|---|---|---|
| Which devices are badly connected, and to whom? | quality view, default fill, findings, details | v1 |
| Can I trust this picture right now? | status line, "data incomplete" findings | v1 |
| Which router carries my battery devices? | details, findings | v1 |
| Which way does a packet travel, there and back? | selection (node view), details; route view, playback | v1, v1.1 |
| Which routers relay most traffic; what depends on one? | route view, subtree, relay-load fill | v1.1 |
| Where are my devices physically? | geo view | later |

## 3. Data sources

The panel reads data in the browser through Home Assistant's websocket API. The panel requires an administrator;
`zha/*`, `matter/*`, `thread/*` and `mqtt/subscribe` are admin-only in Home Assistant, the registry commands are
not. Each source is an **adapter** with a declared **capability set** (4.6).

### 3.1 ZHA [v1]

- `zha/devices` returns every device with: IEEE address (colon form), network address (a number), device type
  (`Coordinator`, `Router`, `EndDevice`), availability, last seen, manufacturer, model, default and user-given name,
  area, power source; a **neighbour table** (each entry: IEEE, network address as hex text, LQI as text,
  relationship `Sibling` / `Child` / `Parent` / `PreviousChild` / `NoneOfTheAbove`, depth, device type,
  receiver-on-when-idle, permit-joining) and a **routing table** (destination and next hop as hex text, status,
  many-to-one, route record required, memory constrained).
- Each device also carries its **signature**: the node descriptor, whose MAC capability flags say in bit 3 whether
  the receiver stays on when idle, and its endpoints with profile (Zigbee Home Automation 0x0104, Zigbee Light Link
  0xc05e), device type and input and output clusters. The **kind** of a device (4.2) comes from its endpoints' device
  types, the more specific kind winning when endpoints disagree (a remote with a sensor endpoint is a button); if no
  device type is known, from a server cluster that names one function (lock, cover, thermostat, colour control,
  occupancy, temperature, IAS zone and other measurements); otherwise the kind is unknown. The coordinator is a hub.
  Sleep comes from the MAC capability flags, else from a neighbour entry's receiver-on-when-idle, else it is unknown.
  On the sample every device has a kind and the 12 end devices sleep.
- Names and areas: `config/area_registry/list`, `config/device_registry/list`; ZHA loaded: `config_entries/get`.
- `zha/topology/update` starts a **scan**: the coordinator asks every router for its tables, one after another,
  about a second per table page; on the sample network a scan takes minutes. The command never answers: send it
  without waiting. A new scan cancels a running one. ZHA also scans by itself, by default every 4 hours (the period
  is configurable and can be switched off).
- Tables are stored by ZHA and survive restarts. During a scan each router's table is replaced when it answers;
  until then, or if it never answers, the previous table stays, possibly hours old. A router that joined after the
  last successful scan has no table at all.
- Rules for known traps:
  - Addresses and LQI arrive as text; parse them (hex accepts `0x` and `0X`), never compare as strings. Accept
    numbers as well as text.
  - The device-level `lqi` is the coordinator's reading of the last frame it received from that device, on the last
    hop, whichever router forwarded it: not a property of the device. `rssi` is empty and neighbour `depth` mostly
    15: neither is a measurement.
  - A router's `last_seen` mostly reflects the last scan; availability decides whether a router is up.
  - LQI 0 is ambiguous (unmeasured or very weak): shown as "0 (uncertain)", never used for a rating or finding.
  - Scales differ by reporter: on the sample the coordinator's median is 22 including LQI 0 and 24 without it (the 5.4 pool excludes 0), router medians range from 44 to 167 either way.
  - Neighbour tables are limited by each device's memory (8 to 26 entries observed per router, 31 at the coordinator),
    so a device lists only part of what it hears, and only 85 % of entries have a reverse entry: a missing entry is no evidence of a missing link.
  - Why a link is listed by one side only (measured on the sample: 242 pairs listed by both sides, 85 measured by one
    side only, 1 by an LQI 0 on the other): the table is full (Zigbee r22 leaves the choice of entries to the device;
    tables of one model stop at the same size, e.g. 16 router entries in IKEA devices and 26 in Signify devices), nearly
    full with the link among the weaker ones, the other side is an end device (it has no table), or the table has
    space and the link is weak or aged out. No pair on the sample proves an asymmetric radio link. An active route
    proves a link that was two-way when the route was built (3.6.3.5.2); route age is unknown. The explorer derives the
    per-direction evidence from this (4.3). A neighbour listed twice in one table counts once, with the higher LQI.
  - `Child` and `Parent` entries also occur between routers; they record joining, not routing, and are ignored.
  - For some destinations the coordinator keeps no routing entry (its direct neighbours; source routing whose route
    records Home Assistant does not expose): such paths are unknown, unless the user lets the explorer assume them or
    read the records from zigpy (source route, 5.1).
- **zigpy's route records** (stage "read from zigpy", 5.1; brief a4w, research against Home Assistant core 2026.10.1
  and zigpy 2.4.0): the integration's own command `meshroute_topology_explorer/zigpy_routes` (admin only) reads, in
  memory and without radio traffic, ZHA's zigpy application (`homeassistant/components/zha/helpers.py`
  `get_zha_gateway(hass).application_controller`) and per device its `relays`: None until the coordinator received a
  route record, then the relays from the device towards the coordinator (zigpy's own source route is that list
  reversed). It answers `{ radio, devices: [{ ieee, nwk, relays: [{ nwk, ieee }] }] }` (radio: the radio library, e.g.
  `zigpy_znp`; a relay's ieee is the device holding that address now, or null), or the error `not_supported` with
  "reason: text" (`zha_not_loaded`, `no_gateway`, `internals_changed`, `error`). zigpy keeps no time for a record and
  keeps it across restarts, so its age is unknown; a relay's address may be outdated after a rejoin. Verified for
  zigpy-znp (route-record indication); other radio libraries unverified. The panel calls it once per data load.
  - A routing entry can point at an unavailable device.

### 3.2 Thread through Matter [v1.1 preview, brief a7]

- `matter/network_topology` and `matter/subscribe_network_topology` (Home Assistant 2026.9 or newer). If the Matter
  server is too old, Home Assistant answers `not_supported`; an older Home Assistant answers `unknown_command`. Both
  grey the Thread entry of the network switch (9.1) with "Home Assistant 2026.9 or newer is required"; ZHA stays.
- The panel reads it once per load, only when the Matter integration is loaded (`config_entries/get`, domain
  `matter`), always with `refresh: false`: the Matter server's cached snapshot, no radio traffic. `tools/guard.py`
  refuses a literal `refresh: true` in shipped code; `tools/capture.py --matter` captures the same answer. The ZHA
  scan's re-reads (6) skip it, and zigpy's route records (3.1) are read for the ZHA network only.
- **Direction** (API contract of matter.js server, `packages/ws-client/src/models/model.ts`
  NetworkTopologyConnection, and its websocket schema changelog, schema 13; confirmed by the main session,
  2026-11-01): `source_to_target` is the source's own neighbour-table record of the target, so it is the reading
  "source hears target", received at the source; `target_to_source` the reverse. A missing direction is `null`.
- **Mapping** (`model/thread.js`): device key is the extended address; roles `leader` and `router` are routers (the
  leader with the crown "L", 8), `reed`, `end_device` and `sleepy_end_device` end devices (sleepy or not), kind
  `border_router` the role "border router" (wired, picture hub), anything else unknown. Names come from the device
  registry through `ha_device_id`, else the border router's `host_name` or model, else "Matter node <id>". Availability
  `null` (border routers, found by mDNS) is drawn as available and said in the Details. Readings carry Thread link
  quality 0–3 and RSSI in dBm; strength `none` (seen dead) and `unknown` (no measurement) are not measured and never
  drawn as a dead link; RSSI 127 is no value. An end device's parent is the router-role node it is linked to (the best
  reading at the router if several, the others possibly stale); none: "parent unknown", the device stays listed.
  Readings of an unavailable node are stale: kept for the Details, not drawn. Wi-Fi nodes and links, and nodes of
  another extended PAN id than the largest group, are ignored and counted.
- The snapshot has no next hop per destination: no paths, no stages, no theoretical paths, no path playback and no
  direction switch for Thread (4.6). The map draws parent links solid (both directions) and every measured neighbour
  lane dashed; a click shows the device's own lanes with values and the glyphs of its directions without a reading.
- Limits: the snapshot is what the Matter server last read; it may list removed routers or miss end devices, and
  border routers vanish when Thread diagnostics are off. The explorer reads only `matter/network_topology` and does not
  reconcile it with OTBR data (`otbr/*` returns keys and is forbidden, 3.4).
- Nodes carry a kind (`matter`, `border_router`, `thread_unknown`, `wifi_ap`), role, extended
  address, RLOC16, extended PAN id, vendor, model, last seen, availability; links carry a strength
  (strong / medium / weak / none / unknown; unknown is not drawn as a dead link), LQI and RSSI per direction, whether
  they come from a route table, a path cost; each snapshot has a collection time.
- The snapshot has no next hop per destination: no path playback and no direction switch for Thread.
- `refresh: true` reads every node's tables again and causes radio traffic: only on user request, never on a timer.
- `thread/discover_routers` and `thread/list_datasets` label border routers and mark the preferred one; networks are
  grouped by extended PAN id.

### 3.3 Zigbee2MQTT [later]

Through Home Assistant's MQTT integration: subscribe with `mqtt/subscribe` to `<base>/bridge/response/networkmap`,
then publish `{"type": "raw", "routes": true, "transaction": <id>}` to `<base>/bridge/request/networkmap` with the
`mqtt.publish` service and match the transaction. Instances are found through their retained `<base>/bridge/state`.
The request makes the network less responsive for 10 seconds to 2 minutes: a user action like the ZHA scan. Built
only against a real recorded answer.

### 3.4 Allowed commands [v1]

The panel and the integration call only these Home Assistant commands; `tools/guard.py` enforces the list.

| Command | Purpose | Tag |
|---|---|---|
| `config/area_registry/list`, `config/device_registry/list`, `config_entries/get` | names, areas, ZHA present | v1 |
| `zha/devices` | devices and tables | v1 |
| `zha/topology/update` | user-started scan | v1 |
| `zha/devices/clusters/attributes/value` | user-started read of one attribute, once per button press (9.2) | v1 |
| `meshroute_topology_explorer/*` | own settings and observations (10), zigpy's route records (3.1, read only) | v1 |
| `matter/network_topology` with `refresh: false` | Thread topology, cached snapshot (3.2) | v1.1 preview |
| `matter/subscribe_network_topology`, `thread/discover_routers`, `thread/list_datasets` | Thread | later |
| `mqtt/subscribe`, service `mqtt.publish` to `<base>/bridge/request/networkmap` only | Zigbee2MQTT | later |

Entity states and area names need no command: the panel reads `hass.states` and `hass.areas` of the `hass` object
Home Assistant hands every panel (developers.home-assistant.io, frontend data), and only for the selected device.
Anything else, in particular commands that return network keys or change a network (`zha/network/*`, `otbr/*`,
`thread/get_dataset*`, `thread/set_*`, `matter/set_*`, `matter/commission*`, `matter/open_commissioning_window`,
`zha/devices/permit`, every other `zha/devices/clusters/*` command, `zha/devices/bind`, `zha/devices/unbind`,
`zha/groups/*`, `zha/configuration/*`, and ZHA's services that write attributes, issue cluster commands or bind), is
forbidden. The integration's Python reads of zigpy only each device's IEEE address, network address and relays
(3.1); network settings, keys, their saved copies and every call that sends to the radio stay out of reach
(`tools/guard.py` PY_DENY).

## 4. Data model [v1]

One normalized model per network; every value knows where it came from.

### 4.1 Network
Source (adapter), network id (ZHA config entry; Thread extended PAN id), coordinator or border routers, time of the
newest data, completeness (6).

### 4.2 Device
Key: the IEEE / extended address, never a name. Network address, **role** (`coordinator`, `router`, `end device`,
`border router`, `unknown`), power source, **kind** (light, outlet, relay, button, sensor, motion, temperature,
thermostat, blind, lock, hub or unknown; the picture of its symbol, 8), **sleepy** (receiver off when idle: yes, no or
unknown), vendor, model, display name, the name the integration gave it in Home Assistant's device registry, area,
available, last seen; for the Details (9.2) also the device registry's firmware text (`sw_version`), the area id and
the device's Home Assistant entities. "Battery device" in the interface means an end
device whose power source is a battery.

### 4.3 Radio link
A directed reading "reporter R hears subject S": quality value, scale (`zigbee-lqi` 0–255, `thread-lqi` 0–3,
`rssi-dbm`), relationship if known. Both directions of a pair are separate readings. Each is a single reading of the
last frame: on the sample the two directions of a pair differ by a median of 8 LQI and by more than 60 in a tenth of
pairs.

**Evidence per direction.** For each pair of available devices the explorer states, per direction ("A hears B"), one of:
**measured** (LQI above 0 in A's table); **implied** (no reading, but an active route of A with next hop B or of B with
next hop A, or A is an end device whose parent is B; the source "route" or "parent" is named, since both prove a
two-way link at setup); or **unknown** with a reason: "end device (no table)", "table full (n/cap)", "table nearly
full (n/cap), link probably weak", "table has space, link probably weak or aged out", "lqi 0", "table missing or
stale", "capacity unknown". The capacity of a model is the largest number of router entries (routers and coordinator)
seen in any table of devices with the same manufacturer and model in this network, needing at least two such devices;
a model seen on one device only borrows the largest table of its manufacturer, marked "vendor estimate"; "capacity unknown"
remains only when no other device of the manufacturer has a table;
"full" means that many, "nearly full" two fewer or less. Capacity is information only and never raises a finding.
Pairs whose only evidence is LQI 0 are not pairs; an LQI 0 reading is kept but marked as not measured.

### 4.4 Route
"Owner forwards packets for destination D to next hop H", with status and flags; direct if H equals D. Entries whose
status is not `Active` are kept for the details view but not followed.

### 4.5 Parent
Only end devices have a parent: the router or coordinator that lists the end device as `Child`. If several do, the
entry with the higher LQI wins and the others are shown as "possibly stale". `PreviousChild` is ignored.

### 4.6 Capability set

| Capability | ZHA | Thread/Matter | Zigbee2MQTT |
|---|---|---|---|
| Radio readings per direction | yes (LQI) | yes (LQI, RSSI) | yes (LQI) |
| Routes with next hop | yes | no | partly |
| Parents of end devices | yes | yes (role) | yes |
| Measurement time | no (observed, 6) | yes | per answer |
| User-started refresh | scan | refresh (not built; the panel reads the cache) | map request |
| Reading scale | LQI 0–255 | link quality 0–3 and RSSI dBm | LQI |
| Ratings, "weak reception", "very low reading" | yes | no (Zigbee LQI scale) | yes |

A view, fill or finding that needs a missing capability shows "not available for this network". Thread (brief a7):
the View tab greys "Communication paths" and "Return paths without a table entry" with "Not available for this
network: Thread data has no routes."; findings are offline, parent offline and parent unknown ("The topology lists no
link between this end device and a router."); the network carries `capabilities` and `hasRoutes()` (graph/links.js)
is the one test for it.

## 5. Derived facts

### 5.1 Paths [v1]
- **Up path** (device to coordinator): from the device, follow its parent if it is an end device, else its routing
  entry towards the coordinator, hop by hop.
- **Down path** (coordinator to device): follow the coordinator's routing entry towards the device, then each hop's
  entry. A hop that is the parent of an end-device goal delivers to its child directly: a parent keeps no routing
  entry for its own child, and the child check comes first (Zigbee r22, 3.6.3.3; A4k: before, the walk stopped there
  and hid four down paths on the sample). For an end device whose entries do not lead to its parent: take the down
  path to its parent and append the parent link, but only if the path to the parent is complete; otherwise the
  incomplete path to the parent stays as it is and nothing is appended.
- A path that meets a missing table or entry, a loop, or an unavailable hop stops and is **incomplete**; it is
  never guessed, not even for the coordinator's direct neighbours.
- **Paths of one device** (node view, 7.1; decisions by Fabian Schwamborn, 2026-11-01): "path to coordinator" (the
  view "coordinator" of 7.1) is its up and down path; the view "table" (owner proposal 2026-11-01, Codex 4.4 and 5,
  brief a4z) has only **table walks**: an out walk to every destination of the device's own usable entries (active,
  not from a stale table), each holder forwarding by its own entry for the same destination, a parent delivering to
  its end-device child, an end device sending to its parent; with "include return routes" an in walk from each of
  these destinations back to the device by every hop's entry for the device. A walk stops at a missing entry ("no
  entry"), an inactive one ("entry inactive"), a table not read, a loop or an unavailable device and names where;
  nothing fills the gap (no neighbour, no route discovery, no reversed way out, no source route or route record), and
  a return route not in the tables is no verdict on the link. No up or down path, never more destinations; an end
  device or an unavailable device has none. "all paths" (the view "all") adds an **out path**
  to and an **in path** from every other available device except the coordinator, both **theoretical** (5.7). The way
  with the coordinator is the up and down path, so it does not appear twice; an unavailable device has no theoretical
  paths. The coordinator stands for Home Assistant: in the stage "coordinator" it shows the routes it holds (walked
  like the down path) and the routes of other devices towards it; in "all" its theoretical out and in path
  for every available device, from its own table on, like any device. On the sample every one of these paths is
  complete (12).
- The **reception at a hop** (sender to hearer) is the hearer's evidence for that direction (4.3): its LQI of the
  sender, or "Parent" or "Route" where only a parent link or a route implies the hop, or unknown: "–" where the
  hearer's table was read and does not list the sender, "?" where there is no table to ask (the glyph rule of 7.1,
  same on the map and in Details; decision of the main session, 2026-11-01).
- **Source route** (decision by Fabian Schwamborn, 2026-11-01; View tab 9.1, stored 11): a ZHA coordinator reaches
  many devices without a routing entry, along the relay list of the device's own route record, which is its up path
  reversed; Home Assistant does not expose those records. Three stages: **off** (the down path stays unknown);
  **assume** (default): the down path is the up path reversed, marked as **assumed** wherever it shows and never drawn
  or counted as measured; **read from zigpy** (experimental; brief a4w): zigpy's route records (3.1), see below. The
  assumption applies only
  to an available device whose measured down path is incomplete, for which the coordinator's table (present) holds no
  active route, and whose up path is complete; a direct neighbour of the coordinator so gets a one-hop return path. An
  end device for which the coordinator does hold an entry stays unknown: its gap lies elsewhere. On the sample it applies
  to 8 devices (12); every available device then has a measured or assumed down path.
  In the stage "read from zigpy" a route record becomes the down path, drawn and counted as **measured** ("back,
  measured (route record, age unknown)"; no line class of its own), only where all of this holds (unknown beats wrong;
  decisions of the main session, 2026-11-01): the device is available and not the coordinator; its measured down path
  is incomplete; the coordinator's table, if present, holds no active route towards it; its current network address
  equals the one in the record; every relay is a known, available device that holds the recorded address now; no
  device repeats; every hop joins a pair of the model. Every other device gets the assumption as above. A record never
  replaces a complete measured down path; where it takes another way, Details says so in one line ("Route record
  differs: via …"), nothing is drawn. If zigpy cannot be read, the stage assumes as "assume" does and the status line
  says why.

### 5.2 Relay load [v1]
Per router: routes in all available routers' tables that use it as next hop towards another destination; direct
routes do not count.

### 5.3 End-device children [v1]
Per router or coordinator: end devices whose parent it is.

### 5.4 Rating relative to the reporter [v1]
- The **rating** of a reading R hears S is its mid-rank percentile among all non-zero values R reported. Reporters
  with fewer than 10 such values use the pool of all reporters of the same vendor; if that pool has fewer than 10
  values too, the reading keeps its raw value and gets no rating.
- A device's **reception** is the best rating among readings in which it is the subject, LQI 0 excluded.
- A rating is a rank, not a health claim; the interface says "lower / middle / higher reception rank", and Details name the basis of each rank: "rank among the readings of Router 12", or "rank within the IKEA group" (marked "group" in the row) where the reporter has fewer than ten readings of its own.  by construction a tenth of every reporter's readings fall in its lowest
  tenth. The interface says "weakest tenth of what R hears". Differences below 60 LQI between readings are noise and
  never a finding.

### 5.5 Offline [v1]
Unavailable devices show since when (their last seen). Availability decides; `last_seen` of routers is text only.

### 5.6 Findings [v1]
A **finding** is the only form in which the explorer judges. Each finding names its evidence (values, reporters,
tables used) and the tables it would need but lacks. **Expected reporters** of a router are the available routers in
its own neighbour table; of an end device, its parent.

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

No finding is raised from the table of an unavailable device (stale), from LQI 0, or from a missing neighbour entry
alone. One exception: "parent offline" may name the last known
parent from that parent's own stale table, since no other table lists the child, and says so ("last known parent").
Path walks never follow routes or parents from the table of an unavailable device. The coordinator's table counts like a router's for "data incomplete", "parent unknown" / "no parent" and "isolated": without it, none of the three is a verdict. **[v1]** The interface groups
"data incomplete" findings by the missing table.

### 5.7 Theoretical paths [v1]
How a frame from device S would most likely reach device D today (decisions by Fabian Schwamborn, 2026-11-01, board
M11: "its routing table, then the routing table of its next hop, and so on"), after the unicast routing of the Zigbee
specification r22 (05-3474-22, 2017). "Theoretical": computed, not observed; Home Assistant does not show whether two
devices really talk. The walk decides at each holder H of the frame, in this order:
1. H is an end device: to its parent ("parent").
2. D is an end device whose parent is H: delivered to the child ("child"; 3.6.3.3 checks children first).
3. H holds an active, current routing entry for D: to its next hop ("table"); the next holder reads its own table.
   3.6.3.3 also relays on `VALIDATION_UNDERWAY`; this explorer follows `Active` only (4.4), and ZHA's sample has no
   other status. Entries flagged many-to-one point at the coordinator and are its stage-1 ways.
4. D is a router or the coordinator, measured in H's neighbour table: directly ("neighbour"). 3.6.3.3 checks the
   neighbour table first, as an option ("may"); the table comes first here because stacks route around weak
   neighbours: on the sample 35 active entries go via another hop to a destination their owner measures (LQI 1–169).
   An end device is routed by its own address under stochastic addressing (3.6.3.3, `nwkAddrAlloc` 0x02), so a router
   that hears only its parent does not deliver there; it discovers.
5. Otherwise the rest of the way is **one of the cheapest ways by the tables' LQI**, a candidate for what a route discovery from H would take, not a prediction ("discovery"; on the sample it names the real next hop of 11 of the 37 active non-direct entries of routers, 14 of 62 with the coordinator's): the lowest
   **path cost** to D, for an end device to its parent (the parent answers for its child, 3.6.3.5.2), which then
   delivers ("child"). Usable are links between available routers or the coordinator that each side measures (with
   `nwkSymLink` a route request over a neighbour without an outgoing cost is dropped, 3.6.3.5.2). Path cost is the sum
   of link costs (3.6.3.1); a link costs the larger of its two directions ("the maximum of the incoming and outgoing
   costs", 3.6.3.5.2). A direction costs **1 + round(6 × (1 − LQI / 255))**: LQI 255 costs 1, 128 costs 4, 0 costs 7.
   The specification wants a cost of 1 to 7 (3.4.8.3.2) and allows "a table-driven function ... to map average LQI
   values onto C{l}" (3.6.3.1), leaving the estimate to the implementation; its example min(7, round(1 / p⁴)) with p
   read as LQI / 255 saturates at 7 below LQI 160, which on the sample gives 206 of the 241 router pairs measured
   both ways cost 7, so discovery would only count hops (own choice, main session 2026-11-01). Ties: fewer hops, then
   the lower device ids from S on.
- A table not read or an entry that is not active counts as no entry (rules 4 and 5 apply); the hop leaving H says
  so ("table not read", "entry inactive"). A loop (also a discovery that would lead back over a device the walk
  passed), an unavailable device, a holder without any usable link ("no link", or "table not read" when its table is
  missing) and an unknown parent stop the walk: the path is incomplete and says why. Unknown beats wrong.
- The way back D to S is walked separately from D: tables differ per direction.
- On the sample (12): all 1640 paths between the 41 available devices besides the coordinator are complete; their hops
  are 1507 discovery, 603 neighbour, 480 child, 480 parent, 198 table. The coordinator's 82 add no lane. Together they
  use 570 lanes, the **backbone** (7.1).

## 6. Data status and the scan [v1]

- A **status line** is always visible (board M1): source; "Router tables: x/y" (x available routers with a table of y available
  routers; the coordinator is not counted; no completeness percentage, review 1.4c, 2026-11-01); the newest change the panel has observed ("unchanged since …"); on the
  right the source-route stage (5.1; not in the view "routing table", which draws no assumed or recorded return
  path, main session 2026-11-01). Devices missing from every table are named by the findings, and that ZHA reads
  the tables by itself, every 4 hours by default, is an info button beside "Read data again" (9.1; decision by Fabian
  Schwamborn, 2026-11-01).
- **Thread** (brief a7, board Variant A): source "Thread (Matter)"; "Links with both directions: x/y" (pairs measured
  both ways of all linked pairs) instead of router tables; "read {time} ({age})", the snapshot's `collected_at`, with
  the note that it was read from the Matter server's cache; "no border router listed" when the snapshot names none.
  No banner, no "unchanged since" (the snapshot has its own time). On the sample: 3/5.
- **Completeness** (share of available routers with a table) is not shown as a percentage and not used as a gate: each finding decides by
  its own evidence rule (5.6). Below 90 % the map also carries the banner "incomplete".
- **Observations**: ZHA has no scan timestamp and the integration has no public way to read ZHA's tables. The panel
  therefore keeps, per router, a fingerprint of its sorted neighbour and routing tables (with LQI) and the time it
  first saw that fingerprint, and stores them through the integration (10). "Unchanged since" thus means "observed
  unchanged since"; it is accurate only for times a panel was open. The status line shows the board's wording
  ("unchanged since {time}", decision by Fabian Schwamborn, 2026-11-01); the caveat
  "observed, not reported" is its tooltip (and the Details row "Table observed unchanged since").
  The stored object holds `routers: { <ieee>: { fingerprint, firstSeen } }`; saves merge per router (the same
  fingerprint keeps the earlier time, another one the newest view) and keep unknown keys; above 256 KiB the oldest
  entries go first, which debug mode reports. Times are shown in the browser's local time.
- **Scan** (debug mode): explains the radio load and asks for confirmation; disabled while a scan of this panel runs;
  sends the command without waiting; then re-reads every 15 seconds for 2 minutes and every 60 seconds up to
  15 minutes, showing "tables changed since the scan started: x of y" with the note that an unchanged table may
  also have been answered; it never claims "finished".
  "x of y" counts available routers like the status line (coordinator not counted); a router that gains a table
  counts as changed. A re-read reaches the map only when tables or availability changed, so the layout does not
  restart every 15 seconds. The command goes out with the connection's fire-and-forget send; a re-read that fails is
  skipped. Leaving the panel or "stop" ends the following, not the scan, which ZHA cannot cancel. The confirmation
  starts on "Cancel".

## 7. Views

Two core views, switchable; the choice is stored per network.

### 7.1 Quality view [v1]
Radio readings laid out by a force-directed model (springs along readings, repulsion between all devices, a pull to
the centre).
- Every measured reading is a spring of rest length L = L0 × D × f(q), with q = LQI / 255 and f(q) = 1 + 5 (1 − q)²;
  a reading of 0 or without a value (unmeasured or very weak, 3.1) is no spring (decision by Fabian Schwamborn,
  2026-10-31). A pair with two readings therefore has two springs.
- L0 is the base length: node diameter plus the mean label width in the label font, at zoom 1. D is the density:
  0.96 dense, 1.44 medium (default), 2.28 spread (were 0.7 / 1.0 / 1.5, then 0.8 / 1.2 / 1.9; owner, 2026-11-01: all
  further apart, twice; min distance between node centres on the sample at 1280 × 800 after fit: 31.3 / 47.0 / 74.4 px,
  was 26.1 / 39.2 / 62.0 and before that 22.9 / 32.7 / 49.0; phone 11.0 / 16.5 / 26.1 px, was 9.2 / 13.7 / 21.7; labels
  dropped for lack of a free place at 1280 × 800: 3 / 0 / 0, was 6 / 0 / 0; on the phone 0 / 0 / 5, was 0 / 0 / 10). Repulsion scales with (L0 × D)², so the balance of springs and
  repulsion, and with it the meaning of the picture, is the same in every density: the layout is therefore computed
  once with D = 1 and drawn at D times its positions.
- Any standard spring-electrical integrator is acceptable if it is deterministic with a fixed seed and meets the
  fidelity and speed targets (12). On the sample network this curve gave a rank correlation between drawn length
  and LQI of −0.82, against −0.35 for constant springs.
- Links (decision by Fabian Schwamborn, 2026-10-31): each pair (4.3) is two lanes, one per direction from sender to
  hearer, each on the right of its own direction of travel (3 px from the centre line at zoom 1, growing with the
  symbols), ending 1 px outside the symbols' contour (the rounded square, 8) with an arrowhead at the hearer.
- **Classes per direction** (decision by Fabian Schwamborn, 2026-11-01, board M11): a class belongs to a lane, from
  sender S to hearer R, never to a pair, so the way back of an up hop is not up. **Up**: R is the next hop of S on
  S's up path (5.1). **Down**: the lane lies on the coordinator's path to a device, **measured** (the coordinator's
  table and the walk of 5.1, also up to where an incomplete walk stops) or **assumed** (a source route, 5.1, only in
  the stage "assume"). **Route**: on the walk of an active, current route between two devices of which neither is the
  coordinator. **Heard**: a reading, no traffic. A lane can carry several and is drawn as its strongest: up and
  measured down, then assumed down, then route, then heard. On the sample: 656 lanes, 41 up (12 of them to a
  parent), 52 down measured, 2 more down assumed, 29 routes, 457 heard only; 75 lanes carry nothing and have no
  reading (73 unknown, 2 only implied by a route or a parent link).
- Lines carry no colour by default: up and down solid in the foreground, assumed down sparse round dots in the
  foreground, routes between devices dash-dot (6 3 1.5 3) in the foreground, a hop only a computed route discovery
  takes (5.7) the same dash-dot in grey, heard only dashed (6 3) in grey, each with an arrowhead at the hearer; a
  lane's width follows its own reading's rating in three steps. A computed hop must never look like one a table
  proves (main session, 2026-11-01).
- A direction without a reading has no lane but a glyph where its lane's middle would be, wherever the stage draws its
  pair as heard only (and in debug mode): "–" when the hearer's table does not list the sender (table full, nearly
  full or with space), "?" when there is no table to ask (end device, missing or stale table) or it says LQI 0. A lane
  that carries nothing and only a route or a parent link proves shows in debug mode only, thin dotted grey without a
  head.
- **Path display** (request by Fabian Schwamborn, 2026-11-01; View tab 9.1, stored 11): grey (default: links carry no
  colour) or **coloured by reception**: every drawn lane with a rated reading takes its rating (5.4, relative to the
  hearer) on a scale of reception rank from lower over middle to higher (never worded as bad or good: a rank is relative, 5.4), red, yellow and green unless the user chose own colours for the
  three (for colour blindness, design 2026-11-01); lanes without a reading or rating, computed hops and assumed return paths keep
  their class colour. Dash and width stay, so the class and the rating still read without colour. Every colour is
  nudged to 3:1 against the background (8).
- **Communication paths** (decision by Fabian Schwamborn, 2026-11-01, boards M2, M11; View tab 9.1, stored 11): three
  views, each its own basis (none contains another, so no "+" in their names; owner proposal 2026-11-01 via feedback
  contribution 5, Codex recommendation 5, brief a4z), and two options decide what is drawn; they only filter the
  drawing, springs, positions and fitting stay. The heard option was a third stage until A4l (decision by Fabian
  Schwamborn, 2026-11-01: checkbox instead of a third stage). "Stage 1/2" below means the views 1 and 3.
  - **With the coordinator, there and back** (default): the overview draws the up and down lanes of all devices, each
    only in its own direction, nothing else. A click turns everything else off: only the device's up and down path
    (its **node view**, 5.1; the coordinator stands for Home Assistant and shows the routes it holds and the routes
    towards it), every hop with its value; the other lanes are not drawn, the other devices dimmed to about 20 %.
  - **Routing table** (owner proposal 2026-11-01; Codex 4.4, 5): the overview draws the lane of every usable routing
    entry of every device (owner -> next hop) as a route, and nothing else: no up or down lane, no band. A click
    shows the device's table walks (5.1) as routes, every hop with its value, a gap as the dashed stem with "?" at
    the device where the walk stopped; a device without usable entries (an end device) shows nothing. The option
    **"include return routes"** (checkbox under this view only, default off, greyed in the other views, which hold
    both directions already) adds each destination's walk back. zigpy's route records and assumed return paths are
    another basis and stay out (Details says so).
  - **Paths to all devices (theoretical)** (decisions by Fabian Schwamborn, 2026-11-01): the overview adds the
    **backbone**, every lane any theoretical path (5.7) between two available devices uses, the coordinator's
    included, as a route where it is not up or down and lighter where only a computed route discovery takes it; it is
    computed once per network, not per frame. A click shows the device's trees, its theoretical way to every other
    device and back (5.1), and turns the rest off as in the first stage. "Theoretical": computed, not observed.
  - **Option "additional heard neighbours (best 3)"** (checkbox, works in every view, default off; "heard only (best
    3)" until A4z): without a selection it changes nothing; a click adds the device's 3 best partners, both
    directions, as measurement lines with values and the glyph of a direction without a reading, never as routes and
    never as destinations. A **partner** is a device that has a reading with the selected device and
    no lane drawn between the two in either direction in the active view (decision of the main session, 2026-11-01):
    in the first view no up, down or route lane (route walks, classes above); in the third view additionally no lane
    of the selection's theoretical paths (5.7); in the routing table no lane of its table walks (up and down lanes are
    not drawn there, so a pair carrying one can be a partner, its measured lanes drawn as heard). Ranked by the best rating at the hearer of the pair's heard lanes,
    then LQI. A partner is a whole pair, not a single lane without traffic: counted per lane, the best would mostly be
    the ways back of up hops. On the sample the second stage leaves almost no partner (12), because the theoretical
    paths take every measured neighbour lane (rule 4). Decision by Fabian Schwamborn, 2026-11-01: the
    checkbox stays active in every view; in the third an info button beside it explains this ("This view already
    draws every measured neighbour as a possible direct way, so the checkbox rarely adds a partner here").
  - A lane keeps its **strongest class** in the overview and in stage 1 (main session, 2026-11-01): up and measured
    down, then assumed down, then a route (a route walk, or the backbone by a table, neighbour or parent link), then
    computed only, then heard. **On a click or hover in stage 2 the selection's own tree decides** (main session,
    2026-11-01, board M11 rule 5): each hop has the strongest class of the selection's own ways (its up and down
    lanes, table, neighbour, parent and child, else computed); the backbone's network-wide classes do not reach into
    the focus, or a computed hop would look proven because somebody else's lane covers it (7.1: a computed hop never
    looks like one a table proves). Only the selection's stage-1 lanes (its up and down paths) override.
  - **Hover** previews the device under the pointer: its lanes of the stage that the overview draws anyway lie on
    top with their values, everything else is dimmed; it never adds lanes the stage hides. From stage 2 on the
    backbone carries the device's trees, so they show; heard-only partners (the option) wait for the click. **Debug mode** draws
    every lane of every class, the glyphs and lanes without traffic, with values on both lanes; a selection's lanes
    lie on top.
  - Order within the drawing: lanes without class (debug), heard only, computed, routes, down, up on top. On the
    sample the overview draws 95 lanes in the first stage (41 up, 54 down, 2 of them assumed; 93 with source routes
    off) and the backbone of 570 lanes in the second, with or without the option (95 up or down, 456 routes, 19 computed only; with
    source routes off the 2 assumed lanes count as routes).
- **Known limit** (Codex review round 2, 3.6): at dense hubs values and neighbour labels overlap; the selected device's
  label stays readable (A4s); the written paths in Details are the reference.
- **UI texts stay short** (Codex review round 2, 2026-11-01, 3.3/3.4): the Details notes and legend rows for computed and
  assumed paths and for RX state only what a reader needs ("Possible paths from the available tables; actual traffic may
  differ.", "Return path assumed: the outbound path reversed. The actual return path is not available in these data.");
  the rules behind them (table priority, direct neighbour, cheapest ways by the tables' LQI, path cost 1 to 7 per link,
  source-route background) are specified in 5.1 and 5.7, not repeated in the UI. The short warning on missing values
  ("–", "?") stays in the legend.
- **The node view on the map**: each hop on the lane of its direction of travel with an arrowhead at the hearer, in
  the style of its class (a hop of the device's own up or down path solid, an assumed return path sparsely dotted
  whatever the hearer measured, a path to or from another device dash-dot, a hop only a computed route discovery
  takes dash-dot in grey; each lane in its strongest class), its width by the hearer's rating where
  it measured the hop. Every hop carries its value (raw LQI at the hearer; "Parent" or "Route" where implied; where unknown "–" or "?" by the glyph rule above). An incomplete path ends at the device where its walk stopped with a short dashed stem towards its
  goal (on the right of that direction, about 30 px at zoom 1, at most 45 % of the way), a "?" and "path unknown":
  unknown beats wrong. The up path also lies as a wide translucent band under its hops (on a click, not on hover): in
  the stage "all" it tells the way to the coordinator apart from the other paths (main session,
  2026-11-01). Devices on the paths, their goals and the heard partners keep full strength and their labels.
- **Values at the arrows** (decision by Fabian Schwamborn, 2026-11-01): a lane's value sits beside its lane on the
  right of travel, a quarter of the lane before the hearer (three quarters from the sender), as two lines: "RX:" and
  below it the value. On a short lane it moves back just enough to stay beside its own lane. **Values of the focus's
  lanes (click and hover) are never dropped** and stay at that place even where it covers another value, a label or a
  symbol (board M11 rule 8, "every value at its place, overlap accepted"; owner decision 2026-11-01), with one
  exception: the label of the selected or hovered device (type line and name, on a light plate) is never covered; a
  value that would sit on it takes the next place along its own lane, else the same places on the lane's other side,
  else the one covering least (Codex review 1.6, main session decision 2026-11-01); a lane too short for the two lines still shows its value, at its middle beside the lane. In the debug
  overview, values on every lane look for a free place (60 % and 88 % of the lane next), and a lane too short or
  without room shows none; the details list every value. The values of the way up and down take their places first, then routes, then computed hops, then heard
  only. This holds for path hops and for debug mode's values on every lane; the overview shows the rating by width
  only.
- The density changes only the distances between connected devices, never the devices themselves (decision by
  Fabian Schwamborn, 2026-10-31): a change redraws the same layout at D times its positions, symbols and labels
  keep their size, "fit" and the first view fit the base layout, D = 1 (owner decision 2026-11-01, replacing "fit refers to
  medium"): dense 0.96 sits slightly smaller in the window, medium 1.44 reaches about 44 % and spread 2.28 about 128 % past it, the selection or else the centre of the view stays in place, and the stored density
  (11) applies when the panel loads.
- Devices without readings sit evenly on an ellipse just outside the mesh (the half-axes of the mesh's bounding box
  plus L0 / 2, in the layout before D is applied); the ring and the details ("No readings") say so, the symbol does
  not change (8).
- Dragging a device pins it (pin mark); "release" in the details or a double click unpins it. Pinned positions are
  stored (11).

### 7.2 Route view [v1.1]
The layout comes from routing, so the map sorts itself by paths. The paths of a selected device with the reception
at every hop and the unknown ends are shown in v1 already, in the quality view (node view, 7.1); the route view adds
the radial layout, the direction switch, playback with the packet marker, the subtree and the relay-load fill.
- A radial tree from the up paths, used in both directions: coordinator in the centre; a device's tree parent is
  the next hop of its up path; one ring per hop, ring spacing L0 × D; a subtree's angle is proportional to its
  number of devices; siblings sorted by subtree size, then address. Devices with an incomplete up path sit on an
  outer ring "path unknown".
- A switch selects the direction: **receive** (up path) or **send** (down path). It changes which path is played
  and labelled, not the layout; a device whose path in the chosen direction is unknown keeps its place and shows a
  dashed stem "path unknown".
- Selecting a device plays the path of the chosen direction: a packet marker travels hop by hop (0.6 s per hop),
  hop number and the reading of each hop appear in turn; afterwards the other direction is drawn statically in its
  own colour. Buttons "again" and "step"; selecting elsewhere or Esc cancels; with reduced motion the path appears
  at once.
- Selecting a router also highlights its **subtree**, the devices whose known up path runs through it, with the
  count in the details ("7 devices route through this router").
- Fill "relay load" becomes available. Thread networks offer parents and neighbours only and say so.

### 7.3 Geo view [later]
Devices at stored positions on a flat map, later possibly 3D with floors. Positions stored by the integration,
imported from GeoJSON points (properties `ieee`, optional `name`, `entity_id`) or placed by hand. Background: a
user-supplied image, or map tiles from an address the user configured.

## 8. Visual language [v1]

- **Device symbols** (design by Fabian Schwamborn, 2026-10-31): every device is one symbol, a rounded square on a
  24-unit grid (outer edge 0.7, corner radius 5.05, frame 1.1) that holds everything about the device; nothing sticks
  out of it. Inside, scaled 0.92 about the centre: the device's **picture** (its kind, 4.2; the coordinator a hub,
  "unknown" a question mark), radio arcs above it for radio devices, a cable (plug and bend) below it for wired or also
  wired devices (the coordinator, border routers); on the right a bed for a sleepy end device, or a crown with "C"
  (coordinator) or "L" (Thread leader), and then picture, arcs and cable move 3 units left together. Unknown sleep
  shows no bed.
- **Role:** a router's frame (coordinators and border routers are routers too) is open at 8 places, two per side at 8
  and 16, gaps 2.6 wide, each with a short stroke from the outer edge inwards to 2.75; its fill reaches the outer
  edge, so the outline stays closed and links end at one contour. The strokes mean the role, not a neighbour count.
  Every other role, unknown included, has a closed frame.
- **State:** offline has no fill (the map's background), selected a frame of 2.2 grown inwards (the outer edge
  stays), pinned a small pin inside at the top left. Hover changes only the highlighting (7.1). A dashed outline
  means nothing: beside the gapped router frame it would be ambiguous; devices without readings show it by their
  place on the ring (7.1).
- **Size:** one size for every device, 32 px at zoom 1, growing with the zoom up to 1.5 times (48 px), never below a
  minimum on screen of 20 px (provisional: the minimum is not decided yet). Symbols never change with the density.
- The symbol's background carries the fill. Default **none**: every symbol is neutral grey (`#c5c8cb` on light themes,
  `#5c6166` on dark ones) with lines in the theme's foreground; reception is not a fill but is shown at the arrows
  (decision by Fabian Schwamborn, 2026-11-01). Under role and power the lines take the theme's foreground or
  background, whichever contrasts more with that fill (at least 3:1 on every fill the map uses). A device without a value under the current fill
  (not rated, no category) is grey with a slash across its background; per theme the grey lies beyond the rating
  scale's lightness, on the background's side, at least 15 ΔE from the scale and from the background.
- One selectable **fill**: none (default), role, power source; relay load in v1.1; time since last heard later.
  Areas and vendors are "highlight group" filters (later), not colours.
- Palettes: Okabe–Ito for categories, cividis for sequences; graphic elements reach 3:1 contrast against light and
  dark Home Assistant themes. Colour never carries meaning alone. Links carry no colour by default: their class shows by
  dash (solid, dots,
  dash-dot, dashes) and the foreground or grey, their rating by width (7.1). The one exception is the opt-in path
  display coloured by
  reception (7.1): by default red, yellow and green per theme (light #d93a26, #b58300, #1d6f31; dark #f2604d,
  #f2c230, #3fbd5c), CIELAB lightness at least 8 apart, so the three stay apart without hue; the user may replace
  each of the three for both themes. The scale is interpolated between the three and nudged to 3:1 against the
  theme's background; the numbers and widths say the same.
- **Labels** (design by Fabian Schwamborn, 2026-11-01): a device's label is a block of up to three lines, each
  switchable (View tab, stored 11): its **type** above the symbol in grey (its kind, 4.2, in the user's language,
  "Light", "Lampe"; none for an unknown kind, whose symbol already shows "?"; on by default), its readable name below
  the symbol (the user's name, else the model; on) and the original Home Assistant name (the device registry's name
  the integration gave it) in a smaller grey line below that, only where it differs from the readable name (off). The
  type line shows only from the working scale (9.3) up, so the overview stays calm (A4h review, 2026-11-01).
  Labels are text, never HTML. A name never loses the part that distinguishes it from similar names (cut shared
  beginnings at word starts, keep the end); identical readable names get the network address appended. Below a scale
  measured on screen (devices half a label width from their nearest neighbour, so a spread map is labelled from a
  smaller zoom) only the coordinator, the selection and its neighbours carry labels. A block tries five places around
  its device, as a whole and in this order, every line free of other devices and texts: (1) split, type 3 px above the
  symbol and names 3 px below it, each line centred; (2) the whole block 3 px below, centred; (3) the whole block 3 px
  above, centred; (4) right of the symbol, 4 px from its edge, lines aligned left and the block centred vertically on
  the device; (5) the same on the left, aligned right. Places that come out the same (the name alone: 1 and 2) are
  tried once. Where no place is free the block
  is left out, except for the coordinator, the focus and every device on the focus's paths, which take the first place
  (a hub such as Router 17 under End device 06 would otherwise lose its label to the lane values; overlap is accepted).
- The legend (one place: the Legend tab, 9.1) explains every class of lines, the fill while one is chosen, the
  symbols (each sign on a device of the network, with its own picture) and the states.
- Category fills use the four Okabe–Ito colours that come close to 3:1 on both white and near-black, nudged to 3:1
  per theme: role (coordinator vermillion, router bluish green, end device blue, border router reddish purple) and
  power source (mains blue, battery reddish purple, DC bluish green); devices without a category are grey with a
  slash. ZHA's
  "Battery or Unknown" counts as battery, and the legend says so.

## 9. Interaction [v1]

### 9.1 What is on screen
One place per thing (design by Fabian Schwamborn, 2026-11-01): nothing appears twice.
- **On the map, only:** top left a button **Devices** with the findings count as a badge, and directly below it a
  slide switch **Details on click** (a real switch, `role="switch"`), shown only while the left panel is closed; top
  right a button **View** and directly below it a button **Legend**; bottom right the zoom group (+, −, fit); the
  status line below the map, with the source-route stage apart on its right ("Return paths assumed for 8 devices
  (source route)", "Source route off · 8 return paths unknown", "Source route from zigpy · 6 recorded, 2 assumed",
  "zigpy not available · 8 assumed" with the reason as its description; nothing when no device is concerned or in
  the view "routing table", 5.1; ZHA
  only, never for Thread); banners (incomplete data, connection lost, reading) between the top groups, or below
  them where that leaves less than 280 px. View switch **[v1.1]** (v1 has one view). **Network switch** (brief a7;
  board "Variant A", draft not yet approved by the owner; one function, `sourcePart` in ui/network-switch.js): with
  two or more networks the status line's "Source: …" is a chip with a caret that opens a small menu upward (WAI-ARIA
  menu button, `menuitemradio`, Esc closes); with one network it stays plain text. A network that cannot be read is
  a greyed entry with its reason. Switching clears the selection, keeps the panels on their tab and refits the map;
  the first load shows Zigbee. No header bar: the map fills
  the panel; on narrow screens Home Assistant's sidebar button joins the top left. Controls are rounded, on the
  theme's surface with a light shadow, targets of at least 44 px.
- **Two panels.** The **left panel** has the tabs Devices, Findings (with its count) and Details; the button Devices
  opens it on Devices. The **right panel** has the tabs View and Legend; the buttons open it on their tab. A button
  pressed while its tab is in view closes the panel. On wide screens they are side panels on their own side (both may
  be open) and hide the buttons of their corner; on narrow ones the same panels are bottom sheets, one at a time
  (opening one closes the other). A panel never covers the selected device (the map pans). Closing a panel (its ×,
  Esc) returns focus to where it was opened.
- **Devices:** a search field ("Name, model, area, address") and the list (9.3); a line says what a click does; a count
  only while a search filters the list. Rows (board M3): the coordinator first, then by name; the name in bold, below
  it one grey line: type · role ("sleeps" instead for a sleepy end device) · "direct to the coordinator" (an end device
  whose parent is the coordinator, a router whose up path is the one hop) or "via <parent>" for other end devices ·
  area (Home Assistant's name, `hass.areas` before the registry's) · "unavailable" when it is down; the reception rank
  lives in Details. With Details on click on, a click on a device in the list or on the map opens its Details; while
  the left panel shows Findings, a click does not switch it. **Findings:** as below. **Details:** 9.2.
- **View** tab (board M2), in this order: **Communication paths** (one radio group of the three views of 7.1, each
  with a one-line hint; the routing table's hint "Each router's table names the next hop to a destination. This view
  follows those entries until the destination or a gap." (Codex 6.2), under it, indented, the checkbox "include return
  routes" with "Follow each destination's route back, using the routing table at every hop.", greyed in the other
  views; below the group the checkbox "additional heard neighbours (best 3)" with its hint "needs a selection: adds the
  device's 3 best partners with a reading and no drawn lane, in any view" (in the third view with an info button for
  the note above), then "Each view has its own basis. Debug shows everything."); **Path
  display** (grey or coloured by reception, with an info button: "Colour shows the relative reception rank, not connection reliability."; under it three colour pickers lower, middle, higher reception rank, prefilled with the
  theme's red, yellow and green, freely choosable, dimmed and inert while grey is chosen (board M2), and while coloured
  a way back to the defaults; 7.1, 8); **On click on a device** (checkbox "Open details", the same setting as the
  switch on the map; what the map shows on a click follows the communication paths); **Return paths without a table
  entry (source route)** (an info button: "The return path is assumed to follow the outbound path in reverse. It has not been verified."; off: the return path stays
  "unknown"; assume: the way up reversed, dotted; read from zigpy, tagged "experimental"; 5.1);
  **Node distance (density)** with an
  info button ("Spacing helps arrange the network. It does not show physical distance.")
  (dense, medium, spread; option words in lower case as on the board; 7.1); **Symbol fill** (none, role, power
  source); **Labels on the map** (device type above the symbol, readable name below, original Home Assistant name;
  8). Below a line: debug mode, "Read data again" with an info button ("ZHA reads the tables by itself, every 4 hours
  by default", and that it reloads the tables ZHA holds and starts no radio scan, 6), "Release all pins (n)", in debug mode the scan (6), and a note on where the settings are kept only
  when they are not kept in Home Assistant (11). Group titles 13 px bold; rows 32 px with a fine pointer, 44 px with a
  coarse one.
- **Legend** for Thread (brief a7): parent link, neighbour (measured, from the neighbour table; no route data), the
  glyphs "–" and "?", and "RX" as RSSI in dBm, link quality 0–3 where no RSSI was reported (`THREAD_VALUE`).
- **Legend** tab (board M7), compact, in sections: **Communication paths**: every path class whatever the stage
  (decision by Fabian Schwamborn, 2026-11-01): there and back with the coordinator, the assumed return path, paths to
  other devices "(views 2 and 3)", there and back and the assumed return path "(views 1 and 3)" (A4z), the computed path, "a possible path computed from the available tables (one of the cheapest by LQI)", that actual traffic may take another path, "(computed, view 3)", heard only "(option "additional heard neighbours", needs a selection)"; the
  band, the glyphs "–" and "?" where the option draws them (option on, and debug)
  (an addition to M7: the legend explains every glyph the map can show), in debug mode also the lane without traffic,
  the width steps and the unknown end, "RX:" (the reception as reported by the receiver at the arrowhead, a quarter of the lane before it; values of different receivers may use different scales) and the
  colour bar while paths are coloured; the fill while one is chosen; **Symbols**: one row per sign, each drawn at
  40 px by the map's own code on a device of the network with its picture (router frame with gaps and strokes;
  closed frame with a bed for a sleeping end device; crown "C" and plug for the coordinator; plug without arcs for a
  wired-only device, where there is one); **States** (offline, selected, pinned). The longer explanations stay in
  this specification. The links part comes from the graph's own legend entries (7.1).
- **Debug mode** (View tab, not stored): values and reporters on both lanes, hop numbers, raw tables in Details, the
  scan, per-router "observed unchanged since". ZHA's raw value texts (power source, relationship, device type and
  the like) are shown in the user's language everywhere, with the raw text beside them in debug mode.
- Wide means a panel at least 720 px wide; a side panel takes 36 % of it within 320–384 px. The expanded sheet
  takes 55 % of the map (at least 240 px, always leaving 120 px of map). Opened by Details on click from the map the
  sheet starts collapsed to one line; opened on request (a button, right-click, long press, the menu key) it starts
  expanded, since a list in one line shows nothing.
- The findings badge counts findings without hints ("very low reading") and each missing table once (decision
  2026-10-31). "Data incomplete" and the hedged "parent unknown (tables of … missing)" are consequences of missing
  tables, not verdicts: the Findings tab lists them together by the table they name (a finding that lacks several
  tables under each of them, a table only one device misses flat), and the badge counts them only through that
  table. The unhedged "no parent" is a finding of its own. Hints sit in their own collapsed group.

### 9.2 Selection and details
- Click or tap selects a device in every view; selection shows its paths in the node view (quality view, 7.1) or
  plays its path (route view). Clicking the background or Esc clears it.
- **Details** (tab of the left panel; design by Fabian Schwamborn, 2026-11-01, boards M4, M8, M9): the name in bold
  and one line "type · role · vendor model" ("unavailable since …" below when it is down), then a segmented control
  (WAI-ARIA tabs, arrows move) with three sub-tabs, each a stack of cards with a small bold heading; at the narrowest
  side panel it takes less padding and type, never an ellipsis. The sub-tab stays when the selection changes.
  - **Communication:** "Communication path with the coordinator": one line per path with every hop and the reception
    at its hearer, the value in bold ("there: Sensor → Router 17 · RX 103 → Coordinator · RX 51", "back: …", an
    assumed return path "back, assumed (source route): …" with a note, a recorded one "back, measured (route record,
    age unknown): …" with a note naming the radio library and that zigpy keeps no time for it, and "Route record
    differs: via …" under a complete measured one that the record contradicts, 5.1), "path unknown" where a walk stops, a goal
    that is unavailable named so; for the coordinator in the first stage its routes ("to X", "from X"), collapsed
    above 12 lines. In the stage "all" the card **"Paths to other devices (theoretical)"** (5.7; brief
    a4k), collapsed above 12 rows: a row per other device, the shortest way there first, with the number of hops there (→) and
    back (←) (no "weakest RX" summary: it would mix a missing value with a low one and compare receivers on different scales, review 1.4b); a row opens to both ways,
    every hop with its RX (a "–" hop names its basis: "Basis: Router 05 hears Router 13 with 48; Router 13's table is full (16/16)", and where the table has room "Link probably one-sided or aged") and how it is taken ("routing table entry", "direct neighbour (from the neighbour table)", "route discovery (computed)", "parent", "child";
    "table not read" or "entry inactive" where the holder had no entry), a discovery with its path cost, a stopped way
    with its reason; the note (computed, not observed, and how) stands at the top of the card, rows of equal hop
    count sort by name in natural order (Router 2 before Router 10), and the cost of the whole path stands at the
    end of its row, apart from the last hop. In the view "table" (brief a4z) the card **"Routing table · n"** follows
    the one with the coordinator (for the coordinator itself it is the only path card: its view-1 list would repeat
    the same routes, main session 2026-11-01), collapsed above 12 rows: a row per destination of the device's usable entries by
    name, with the hops there (→) and, with "include return routes", back (←), "?" for a walk that stops; a row opens
    to the walks, every hop with its RX and how it is taken ("routing table entry", "child", "parent"), a gap as "path
    unknown beyond X (no entry | entry inactive | table not read | loop | unavailable)"; notes: what the view
    follows, that return routes are off or that a missing one is no verdict on the link, and that zigpy's route
    records and assumed return paths are another basis and not part of the view. Without rows it says why: "No usable
    routing-table entries on this device.", "End devices keep no routing table; their parent routes for them.", or
    that the unavailable device's table is stale. Then the parent (end devices: its availability, LQI at the parent, receiver when idle, possibly stale
    parents) or the children ("Children (end devices)", each with its model: not every end-device child sleeps); the
    findings with evidence only when the device has some, with "Show in Findings", nothing when it has none; "Heard by n
    · hears m": the
    reception, the 5 best readings of the device as rows of name, RX and rank relative to the reporter, the rest and
    what the device hears behind "… all with RX and rank relative to the reporter"; "Tables and load": neighbour table
    against the model's capacity, routing table, relay load, the routing entries. Debug mode adds the raw tables.
  - **Entity:** the node card: badges for logical type, power source, receiver ("always listening" / "sleeps when
    idle", MAC capability flags bit 3), frequency band (node descriptor) and stack revision ("Zigbee PRO r22", server
    mask bits 9-15; 0 is "before r21"), then IEEE, network address in hex and decimal, manufacturer with its code,
    model, firmware (device registry `sw_version`, else "unknown"), quirk (only an applied one), buffer and transfer
    sizes, last heard. Then "Open in Home Assistant": device page, ZHA's Zigbee info (`/config/zha/device/<ieee>/
    signature`, ZHA devices only), the area page, logbook and history filtered to the device's entities (`entity_id`
    list), the entity list filtered to the device (`/config/entities?device=<id>`); links stay in the app. Then the
    device's entities; a click opens Home Assistant's more-info dialog (event `hass-more-info`).
  - **Cluster:** a table of every cluster of the signature (name, id as `0x0006`, direction In or Out), grouped by
    endpoint with profile and device type names and ids; manufacturer-specific clusters (0xFC00-0xFFFF) carry the
    vendor's name and a "manufacturer-specific" tag. A note says In is the server side (the device offers the
    function), Out the client side (it uses it at others). A row (or its button) opens the cluster's details.
- **Cluster details** (board M10): a modal dialog (focus kept inside, Esc, close button, focus back to the row): name and
  id; device · endpoint · direction · profile; one sentence on what the cluster does and what In or Out means; the
  attributes the public ZCL specification lists for it (id, name, type, side; [v1] catalogue: Basic, Power
  Configuration, Identify, Groups, Scenes, On/Off, Level Control, Color Control, OTA, Poll Control, Temperature,
  Humidity, Occupancy and Illuminance measurement, IAS Zone, Metering, Electrical Measurement, Diagnostics, Touchlink),
  else "no attribute list known"; a **current value** where Home Assistant already knows it as the state of the
  device's one obvious entity (On/Off → the light or switch state, current level → brightness, colour temperature →
  `color_temp_kelvin`, the measurement clusters and battery percentage → the sensor of that device class), else "—";
  the button **"Read values from the device"**, which reads the attributes of the device's side once, one after
  another (`zha/devices/clusters/attributes/value`, 3.4), shows each result ("from the device", "no value", "no
  answer", an error), stops at the first timeout (15 s) or error and sends nothing after the dialog closes; a hint for
  sleepy devices; "Manage in ZHA" (`/config/zha/device/<ieee>/clusters`) and the note "The map is read-only: writing,
  reporting and binding are done in ZHA's device management."
- **Details of a Thread device** (brief a7): no sub-tabs (no signature, no clusters): the head (name, role, "Thread
  leader" where it applies), "Neighbours (Thread)" with both directions per neighbour ("hears X: −75 dBm · LQI 3",
  "heard by X: …", the parent first), the device's findings, and the Thread facts (role, extended address, RLOC16,
  Matter node id; "not reported" where missing).
- **Details on click** defaults to on for wide screens and off for narrow ones. It applies to a click on the map and
  in the Devices list: it opens the left panel on Details (a closed one, or one on Devices, or following on Details),
  never takes Findings away and on narrow screens never pushes the right sheet away; selecting from Findings or a
  device named in Details zooms to the device and keeps the list. Clearing the selection on the map closes a panel
  that Details on click opened and that still shows Details. Details also open with right-click on a node (captured
  on nodes only, the browser menu stays elsewhere), long press or the menu key, whatever the switch says.

### 9.3 Gestures and keys
- One gesture model: a press that moves less than 8 px is a tap; more is a drag (node: pin and move; background:
  pan). Long press: 500 ms without moving 8 px. Pinch zooms. Wheel: × 1.2 per notch around the pointer. Zoom range
  0.1 to 8 times the fitted view. Buttons +, −, fit.
- Selecting a device in the list or a finding, double-clicking it or pressing Enter zooms and pans to the working
  scale, a fixed zoom at which devices of the base layout (D = 1) sit one mean label width from their nearest neighbour
  (the density is not compensated: spread then shows 2.28, medium 1.44, dense 0.96 label widths; never out past the overview), and
  keeps the device clear of the panels (decision by Fabian Schwamborn, 2026-10-31).
- A tap on a device on the map zooms the same way, but only when the shortest lane of the selection's paths (stage 1
  or 2, `shortestFocusLane` in graph/renderer.js) would be shorter than 24 px on screen at the current zoom
  (`TAP_ZOOM_MIN_LANE`; laneGeometry drops lanes under 4 px, so a phone at fit zoom would skip hops and stack RX
  values). In open areas the view only pans clear of the edge and the panels. The shortest lane decides, not a
  percentile, because one skipped hop breaks a path. Hover never zooms (decision by Fabian Schwamborn, 2026-11-01).
- Hover previews the selection highlight on pointer devices; nothing depends on hover.
- A value on a lane sits on the right of its lane, a quarter of the lane before the hearer, "RX:" above it, with a
  halo, so the two values of a pair never share a side (7.1).
- Keys: arrows and Enter in the device list (the keyboard path to every device; a text filter above it matches
  words in any order in name, model, vendor, area and addresses); Esc clears selection and stops
  playback; Space plays again; Right arrow steps; +, −, 0 zoom. Closing a panel returns focus to where it was
  opened. Hit areas are at least 24 px on screen.
- Every value on the canvas also exists as text; the canvas is described by the status line; playback is announced
  in a live region ("path: 3 hops, LQI 120 / 89 / 45").

### 9.4 Errors and empty states
Clear messages for: ZHA not loaded; user not an administrator; connection lost (retry automatically); Home
Assistant too old for a source; no devices yet; scan running. A connection lost while the map is shown keeps the last
picture under a banner and reads again when the connection is back.

## 10. Integration [v1]

- Custom integration with a config flow; manifest `name` "Meshroute Topology Explorer", domain
  `meshroute_topology_explorer`, version, documentation, issue tracker, code owners, `brand/icon.png`, `hacs.json`;
  hassfest and HACS checks in CI. No Python dependencies beyond Home Assistant.
- Registers one admin panel (URL path `meshroute-topology`, custom element `meshroute-topology-explorer`); removes it
  on unload.
- Own websocket commands, each checking admin rights itself, validating input and rejecting payloads above 256 KiB:
  `meshroute_topology_explorer/settings/get` and `/settings/set`, `meshroute_topology_explorer/observations/get`
  and `/observations/set`. Data is per network, shared by all administrators, kept in a Home Assistant store.
  Requests carry `network` (1–64 characters of `A-Za-z0-9_.:-`, today the ZHA config entry id) and, for `set`, the
  field `settings` or `observations` (a JSON object, at most 256 KiB compact UTF-8; it replaces the stored one).
  Results: `get` → `{settings: object|null}` or `{observations: object|null}` (null = never set), `set` → `{}`.
  Errors: `unauthorized` (not an administrator), `invalid_format` (bad `network`, field missing or not an object),
  `payload_too_large`, `storage_unavailable` (the stored file cannot be read; nothing is written then).
  Registered once per run on entry setup; they keep answering after unload.
  A corrupt store file is moved aside by Home Assistant itself and counts as never set; `storage_unavailable` appears
  only for a newer store version or I/O errors. Payload validity is checked with Home Assistant's JSON writer, so
  anything the store could not write (for example nesting deeper than 254 levels) is `invalid_format`. Removing the
  integration deletes the store file.
- Serves the panel files from a path that contains the version, so caching is safe; registers the path once.
- The panel defines its custom element only if it is free, compares its version with the integration's and asks
  for a reload when they differ; it does not reload data when Home Assistant pushes a new state object; it
  unsubscribes and stops drawing when hidden.
- Texts in English only (owner decision 2026-11-01). The German table stays in `ui/i18n.js`, dormant and no longer
  maintained; German is switched on again by adding it to `ACTIVE_LANGUAGES` and translating the keys added since.
  Dates and numbers follow the Home Assistant user's locale, independent of the text language.

## 11. Settings per network [v1]

Each network keeps its own settings under its id (ZHA: the config entry id; Thread: `thread-` plus the extended PAN
id). The chosen network (`network`: `zha` or `thread`) is stored under the reserved id `panel` by read-merge-write;
the first load shows Zigbee (brief a7).

View, direction (v1.1), density, communication paths (`paths`: `coordinator`, `table` or `all`; anything else counts
as `coordinator`; `heard`: boolean, the checkbox "additional heard neighbours (best 3)", default false; `returnRoutes`:
boolean, "include return routes" of the view `table`, default false, absent in older stores; a stored `paths: "heard"`
of A4j/A4k reads as `paths: "all"` with `heard: true`; 7.1), path display
(`pathColors`: `{ mode, bad, medium, good }`; `mode` `grey` or `coloured`, anything else `grey`; each colour only as
`#rrggbb`, anything else, `null` included, means the theme's own), labels (`labels`: `{ type, name, haName }`,
booleans, a bad or missing value counts as its default: on, on, off), fill (`none`, `role` or `power`; anything else,
including the former `reception`, counts as `none`), Details on click (`openDetailsOnSelect`: a boolean, else by
width), source route (`sourceRoute`: `off`, `assume` or `zigpy`; anything else counts as `assume`, 5.1), pinned positions; later geo positions and map background address (empty by default). Before 2026-11-01 the
panel stored `receptionColors` (colour by reception) and `legendOpen` (the legend pill): `receptionColors: true` without
a valid `pathColors` reads as coloured with the theme's colours; the next save leaves both keys out. Before A4j
(2026-11-01) it stored class switches (`links`) and the node view (`nodeView`): without a valid `paths`,
`nodeView: "all"` reads as `all` and anything else as `coordinator`; the next save leaves both keys out.

The panel saves one second after the last change, when the page is hidden and on leaving, by read-merge-write: it
reads the stored object and writes back only what it changed, so last write wins per key and pins merge per device;
keys it does not know are kept. Stored settings are untrusted input: pins only under device addresses, coordinates
within ±1000 base lengths. If the integration lacks the commands or the stored object cannot be read, the settings
live in memory and the View tab says so; nothing stored is then overwritten. After a lost connection the panel
reads them again on reconnect.

## 12. Acceptance [v1]

| Target | Measure |
|---|---|
| Unknown beats wrong | On derived fixtures (sample with one table removed, with three removed, without the coordinator's table, coordinator table only) the findings are a subset of the complete sample's findings plus "data incomplete"; no "no parent", "isolated" or "weak reception" that the complete sample lacks; "parent unknown" only in its hedged form that names the missing tables. |
| Paths | On the sample: up paths complete 41 of 44, down paths 33 of 44, 23 of 33 differ, 2 active routes to unavailable devices. Assumed return paths (source route, 5.1) separately: 8 more devices, 41 of 44 (every available device) with a measured or assumed down path; none without the coordinator's table. Route records from zigpy (synthetic, tests/zigpy-fake.mjs: every complete way up, 2 broken): 6 recorded, 2 assumed, still 41 of 44; 23 records differ from a complete measured down path and are only named. Theoretical paths (5.7): 1640 between the 41 available devices besides the coordinator, all complete, hops 1507 discovery, 603 neighbour, 480 child, 480 parent, 198 table; a click on End device 06 gives 40 out and 40 in (parent 51, child 51, table 4, neighbour 23, discovery 77), on Router 13 (12, 12, 6, 38, 69), on Router 11 (12, 12, 13, 48, 32); the coordinator 41 and 41, all complete. |
| Lanes | On the sample: 656 lanes, 41 up, 52 down measured and 2 more assumed, 29 routes between devices, 457 heard only (458 with source routes off); the overview draws 95 lanes in the stage "coordinator" (93 with source routes off) and the backbone, 570 lanes, in "all" (with or without the option, as it needs a selection): 95 up or down, of the other 475 by their strongest kind 427 neighbour, 29 table, 19 computed only; the coordinator's trees add none; debug mode 583 lanes and 73 glyphs. Heard-only option on a click (A4l): partners per stage over the 32 routers: first stage 29 with 3 partners and 3 with none, second stage 31 with none and 1 with one; the 12 end devices none in both; Router 13 draws 2 lanes (first stage), 7 with the option, 82 in the second stage with or without it. Routing table (A4z): 129 entries, 127 usable, overview 99 lanes (101 distinct owner -> next hop, 2 towards an unavailable device have none); Router 13: 5 destinations, all walks complete (Router 24 over Router 17, End device 06 delivered by its parent Router 17); its return routes: the coordinator's complete, the other four stop ("no entry" at Router 14, 24, 26 and at Router 17 after End device 06's parent hop); the coordinator: 30 destinations, 30 return routes complete; an end device: none. |
| Candidate hit rate | On the sample the cheapest way (5.7 rule 5) names the real next hop of 11 of the 37 active, non-stale router entries whose next hop is not the destination (14 of 62 with the coordinator's entries); test in tests/model-theoretical.test.mjs. Not shown in the product. |
| Unknown hops | On the sample the complete paths to other devices (5.7) have 174 hops without a reading (87 on the ways out, 87 on the ways back), all neighbour hops on 72 lanes; on the ways out the hearer's table is full for 54, nearly full for 23, with room for 10; all show "–", none "?" (test "a hop whose hearer's table was read ..."). |
| Link evidence | On the sample: 241 pairs measured in both directions, 85 in one (12 of them implied by the parent, none by a route), 2 pairs implied by routes only; capacity 16 for IKEA and 26 for Signify models seen on several devices. |
| Parsing | Tests feed addresses as `0x` and `0X` text, numbers and LQI as text; string comparison fails the suite. |
| Fidelity | Rank correlation between drawn spring length and the reading's LQI over all readings ≤ −0.75 in every density, fixed seed. |
| Click classes (A4n) | Hops of a click in stage 2 drawn computed, before and after: Router 13 1 of 82 and 20 of 82; End device 06 2 of 85 and 34 of 85; Router 11 0 of 82 and 9 of 82; the coordinator 0 of 96 (its trees take no discovery). The overview keeps 95 / 570 lanes, 19 computed only. Router 13 -> Router 21 (route discovery over Router 11): Router 11 -> Router 21 is drawn computed, Router 13 -> Router 11 a proven route, as Router 13 reaches Router 11 itself as a neighbour. |
| Speed | Synthetic network of 300 devices and 3 000 readings settles (largest move < 0.5 px per step) within 5 s in Node, measured as the layout's own CPU time (process.cpuUsage, about 1.5 s alone), best of up to three runs so that a loaded machine does not decide it; 30 frames per second while panning on a mid-range laptop (debug mode shows the frame rate). A click in stage 2 on the sample stays under 100 ms of model time: process CPU time in a child process started with V8's `--single-threaded` flag (tests/click-time.mjs; main session decision 2026-11-01, A4z), so the compiler's and garbage collector's helper threads are not counted, after two warm-up rounds of the four measured clicks, each the best of three fresh networks; slowest click 8–30 ms, median 14 ms of 7 runs (Node 18.19 under WSL). Measured in the test process itself the same clicks read a median of 117 ms (one warm-up click) and up to 110 ms beside the other suites (two warm-up rounds); a click in the routing table takes under 6 ms; the backbone is computed once per network (about 20–70 ms wall on the sample). |
| Calm default | Default view state shows only the elements listed in 9.1. |
| Accessibility | Keyboard path to every device and value; hit areas ≥ 24 px; reduced motion honoured; 3:1 contrast of graphic elements. |
| Tests | No device needed; each suite under a minute; fixtures anonymized. |

## 13. Out of scope

Controlling devices; writing attributes, reporting configuration, binding (ZHA's device page does those); any radio
traffic other than a user-started topology request or a user-started read of a cluster's attribute values; installing
anything into other add-ons; a history database; anything sent outside Home Assistant; claims of compatibility or certification.
Later and small: one previous snapshot to show "since the last scan: links lost, parent changed".
