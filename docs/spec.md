# Specification

What Meshroute Topology Explorer does, described from the user's side and from Home Assistant's public interfaces.
It fixes behaviour, data rules and measurable acceptance, not code structure: how files and modules are cut is up to
the implementation. Terms in **bold** are defined where they first appear. Release tags: **[v1]** first usable
version (ZHA only), **[v1.1]** route view, **[later]** further sources and views. Status: reviewed draft, 2026-10-31; node view and colour by reception 2026-11-01; menu and labels 2026-11-01;
details in three sub-tabs, cluster details with a user-started attribute read, source routes 2026-11-01.

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
    records Home Assistant does not expose): such paths are unknown, unless the user lets the explorer assume them
    (source route, 5.1).
  - A routing entry can point at an unavailable device.

### 3.2 Thread through Matter [later]

- `matter/network_topology` and `matter/subscribe_network_topology` (Home Assistant 2026.9 or newer). If the Matter
  server is too old, Home Assistant answers `not_supported`; the adapter says so in the status line.
- Nodes carry a kind (Matter device, border router, unknown Thread device, Wi-Fi access point), role, extended
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
| `meshroute_topology_explorer/*` | own settings and observations (10) | v1 |
| `matter/network_topology`, `matter/subscribe_network_topology`, `thread/discover_routers`, `thread/list_datasets` | Thread | later |
| `mqtt/subscribe`, service `mqtt.publish` to `<base>/bridge/request/networkmap` only | Zigbee2MQTT | later |

Entity states and area names need no command: the panel reads `hass.states` and `hass.areas` of the `hass` object
Home Assistant hands every panel (developers.home-assistant.io, frontend data), and only for the selected device.
Anything else, in particular commands that return network keys or change a network (`zha/network/*`, `otbr/*`,
`thread/get_dataset*`, `thread/set_*`, `matter/set_*`, `matter/commission*`, `matter/open_commissioning_window`,
`zha/devices/permit`, every other `zha/devices/clusters/*` command, `zha/devices/bind`, `zha/devices/unbind`,
`zha/groups/*`, `zha/configuration/*`, and ZHA's services that write attributes, issue cluster commands or bind), is
forbidden.

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
| User-started refresh | scan | refresh | map request |

A view, fill or finding that needs a missing capability shows "not available for this network".

## 5. Derived facts

### 5.1 Paths [v1]
- **Up path** (device to coordinator): from the device, follow its parent if it is an end device, else its routing
  entry towards the coordinator, hop by hop.
- **Down path** (coordinator to device): follow the coordinator's routing entry towards the device, then each hop's
  entry. For an end device: if that does not reach the device, take the down path to its parent and append the
  parent link, but only if the path to the parent is complete; otherwise the incomplete path to the parent stays as it
  is and nothing is appended.
- A path that meets a missing table or entry, a loop, or an unavailable hop stops and is **incomplete**; it is
  never guessed, not even for the coordinator's direct neighbours.
- **Paths of one device** (node view, 7.1; request by Fabian Schwamborn, 2026-11-01): "path to coordinator" is its
  up and down path; "all paths" adds an **out path** for each of its own active routes (to that route's destination,
  walked like the down path from the device) and an **in path** for each other available device with an active route
  towards it (walked the same way from that device). The device's route to the coordinator is its up path and the
  coordinator's route to it its down path, so neither appears twice. The coordinator stands for Home Assistant and
  shows all its paths in both modes. On the sample: out paths 98 (82 complete, 14 unknown from a point on, 2 reaching
  an unavailable destination), in paths 97 (85, 10, 2).
- The **reception at a hop** (sender to hearer) is the hearer's evidence for that direction (4.3): its LQI of the
  sender, or "Parent" or "Route" where only a parent link or a route implies the hop, or unknown ("?").
- **Source route** (decision by Fabian Schwamborn, 2026-11-01; View tab 9.1, stored 11): a ZHA coordinator reaches
  many devices without a routing entry, along the relay list of the device's own route record, which is its up path
  reversed; Home Assistant does not expose those records. Three stages: **off** (the down path stays unknown);
  **assume** (default): the down path is the up path reversed, marked as **assumed** wherever it shows and never drawn
  or counted as measured; **read from zigpy** [later], shown disabled with "coming later". The assumption applies only
  to an available device whose measured down path is incomplete, for which the coordinator's table (present) holds no
  active route, and whose up path is complete; a direct neighbour of the coordinator so gets a one-hop return path. An
  end device for which the coordinator does hold an entry stays unknown: its gap lies elsewhere. On the sample it applies
  to 8 devices (12). The coordinator's own node view lists only its routes.

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
- A rating is a rank, not a health claim: by construction a tenth of every reporter's readings fall in its lowest
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

## 6. Data status and the scan [v1]

- A **status line** is always visible: source; "tables x of y" (available routers with a table, coordinator not
  counted); devices in at least one table; the newest change the panel has observed ("unchanged since …"); a hint
  that ZHA scans by itself every 4 hours by default.
- **Completeness** (share of available routers with a table) is shown, not used as a gate: each finding decides by
  its own evidence rule (5.6). Below 90 % the map also carries the banner "incomplete".
- **Observations**: ZHA has no scan timestamp and the integration has no public way to read ZHA's tables. The panel
  therefore keeps, per router, a fingerprint of its sorted neighbour and routing tables (with LQI) and the time it
  first saw that fingerprint, and stores them through the integration (10). "Unchanged since" thus means "observed
  unchanged since"; it is accurate only for times a panel was open, and the status line says so.
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
  0.7 dense, 1.0 medium (default), 1.5 spread. Repulsion scales with (L0 × D)², so the balance of springs and
  repulsion, and with it the meaning of the picture, is the same in every density: the layout is therefore computed
  once with D = 1 and drawn at D times its positions.
- Any standard spring-electrical integrator is acceptable if it is deterministic with a fixed seed and meets the
  fidelity and speed targets (12). On the sample network this curve gave a rank correlation between drawn length
  and LQI of −0.82, against −0.35 for constant springs.
- Links (decision by Fabian Schwamborn, 2026-10-31): each pair (4.3) is two lanes, one per direction from sender to
  hearer, each on the right of its own direction of travel (3 px from the centre line at zoom 1, growing with the
  symbols), ending 1 px outside the symbols' contour (the rounded square, 8) with an arrowhead at the hearer.
- Pairs fall into three classes, drawn without colour by default: up path (a hop of any device's up path, 5.1: solid,
  foreground, strongest), other route (an active, current route's next hop on no up path: round dots, foreground)
  and heard only (readings, no route: dashed, grey); a lane's width follows its own reading's rating in three steps.
- A direction without a reading has no lane but a glyph where its lane's middle would be: "–" when the hearer's
  table does not list the sender (table full, nearly full or with space), "?" when there is no table to ask (end
  device, missing or stale table) or it says LQI 0. A direction only a route or a parent link proves is a thin dotted
  grey lane without a head.
- **Path display** (request by Fabian Schwamborn, 2026-11-01; View tab 9.1, stored 11): grey (default: links carry no
  colour) or **coloured by reception**: every drawn lane with a rated reading takes its rating (5.4, relative to the
  hearer) on a scale from bad over medium to good, red, yellow and green unless the user chose own colours for the
  three (for colour blindness, design 2026-11-01); lanes without a reading or rating keep their class colour. Dash and
  width stay, so the class and the rating still read without colour. Every colour is nudged to 3:1 against the
  background (8).
- By default all up-path and route pairs are drawn, heard-only pairs as each device's 3 best (by the pair's better
  rating), and all pairs of the selection and of the device under the pointer; debug mode draws all. Order: heard
  only, other route, up path on top.
- Switches choose the classes of the overview (decision by Fabian Schwamborn, 2026-11-01; "Communication paths" in the
  View tab, 9.1): Up path, Other routes, Heard only, all on by default. A switched-off class is not drawn, except around the selection and the device under
  the pointer and in debug mode; heard only keeps its 3-best rule when on. The switches only filter the drawing:
  springs, positions and fitting stay as they are, and a class that is off leaves the legend (debug mode keeps it).
- Selecting a device shows its paths in the **node view** (5.1; request by Fabian Schwamborn, 2026-11-01), chosen in
  the View tab under "On click on a device" (9.1): only the communication path with the coordinator (default: its up
  and down path; the coordinator stands for Home Assistant) or all routes to and from other devices. Each hop is drawn on the lane of its direction of travel with an arrowhead at the hearer:
  solid in the foreground (up-path widths by rating) where the hearer measured it, dotted where only a route or a
  parent link proves it. Every hop carries its value (raw LQI at the hearer; "Parent" or "Route" where implied; "?"
  where unknown). Where up and down differ, both are drawn; the up path also as a wide translucent band under its
  hops. An incomplete path ends at the device where its walk stopped with a short dashed stem towards its goal (on
  the right of that direction, about 30 px at zoom 1, at most 45 % of the way), a "?" and "path unknown": unknown
  beats wrong. A hop of an assumed return path (5.1) is sparsely dotted with its arrowhead (sparser than a hop a route
  proves), whatever the hearer measured; its value still shows the hearer's reading. Everything else is dimmed to about 20 %, the selection's own pairs included (they are still drawn
  whatever the switches say); devices on the paths and their goals keep full strength and their labels. Without a
  selection, hover previews the paths of the device under the pointer without the band.
- **Values at the arrows** (decision by Fabian Schwamborn, 2026-11-01): a lane's value sits beside its lane on the
  right of travel, a quarter of the lane before the hearer (three quarters from the sender), as two lines: "RX:" and
  below it the value. On a short lane it moves back just enough to stay beside its own lane; if the place is taken it
  tries 60 % and 88 % of the lane; a value on a path may cover a dimmed device, never a label or another value. No
  room: the details list it. This holds for path hops and for debug mode's values on every lane; the overview shows
  the rating by width only.
- The density changes only the distances between connected devices, never the devices themselves (decision by
  Fabian Schwamborn, 2026-10-31): a change redraws the same layout at D times its positions, symbols and labels
  keep their size, "fit" and the first view fit the medium layout (a dense map sits smaller in the window, a
  spread one reaches past it), the selection or else the centre of the view stays in place, and the stored density
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
  dark Home Assistant themes. Colour never carries meaning alone. Links carry no colour by default: their class shows by dash (solid, dots, dashes)
  and the foreground or grey, their rating by width (7.1). The one exception is the opt-in path display coloured by
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
  tried once. A dimmed device is no obstacle for a path value but is one for a label. Where no place is free the block
  is left out, except for the coordinator and the focus, which take the first place.
- The legend (one place: the Legend tab, 9.1) explains the current view, the fill and the symbols: their signs, the
  pictures present and the states.
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
  (source route)", "Source route off · 8 return paths unknown"; nothing when no device is concerned, 5.1); banners (incomplete data, connection lost, reading) between the top groups, or below
  them where that leaves less than 280 px. View switch **[v1.1]** (v1 has one view). No header bar: the map fills
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
- **View** tab, in this order: **Communication paths** (checkboxes up path, other routes, heard only; 7.1); **Path
  display** (grey or coloured by reception; under it three colour pickers bad, medium, good, prefilled with the
  theme's red, yellow and green, freely choosable, dimmed and inert while grey is chosen (board M2), and while coloured
  a way back to the defaults; 7.1, 8); **On click on a device** (checkbox "Open details", the same setting as the
  switch on the map; the node view: only the communication path with the coordinator, there and back, or all routes
  to and from other devices; 7.1); **Return paths without a table entry (source route)** (off: the return path stays
  "unknown"; assume: the way up reversed, dotted; read from zigpy, "experimental", disabled with "coming later"; 5.1);
  **Node distance (density)** with an
  info button that says the distance comes from field strength and reception quality and the density multiplies it
  (dense, medium, spread; 7.1); **Symbol fill** (none, role, power source); **Labels on the map** (device type above
  the symbol, readable name below, original Home Assistant name; 8). Below a line: debug mode, "Read data again",
  "Release all pins (n)", in debug mode the scan (6), and where the settings are kept (11).
- **Legend** tab: the communication path classes and every other mark the map draws for links, "RX:" (the reception
  at the hearer, a quarter of the lane before it), the colour scale while paths are coloured, the fill while one is
  chosen, the symbols (router frame with gaps and strokes, closed frame for end devices, bed for sleeping, crown "C"
  for the coordinator, plug for wired, arcs for radio) drawn by the map's own code, the pictures present and the
  states (offline, selected, pinned). The links part comes from the graph's own legend entries (7.1).
- **Debug mode** (View tab, not stored): values and reporters on both lanes, hop numbers, raw tables in Details, the
  scan, per-router "observed unchanged since". ZHA's raw value texts (power source, relationship, device type and
  the like) are shown in the user's language everywhere, with the raw text beside them in debug mode.
- Wide means a panel at least 720 px wide; a side panel takes 36 % of it within 320–400 px. The expanded sheet
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
  (WAI-ARIA tabs, arrows move) with three sub-tabs, each a stack of cards with a small bold heading. The sub-tab stays
  when the selection changes.
  - **Communication:** "Communication path with the coordinator": one line per path with every hop and the reception
    at its hearer, the value in bold ("there: Sensor → Router 17 · RX 103 → Coordinator · RX 51", "back: …", an
    assumed return path "back, assumed (source route): …" with a note, 5.1), "path unknown" where a walk stops, a goal
    that is unavailable named so; in the node view "all" every path ("to X", "from X"), collapsed above 12 lines. Then
    the parent (end devices: its availability, LQI at the parent, receiver when idle, possibly stale parents) or the
    children ("Children (sleeping devices)", each with its model); findings with evidence; "Heard by n · hears m": the
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
  scale, a fixed zoom at which devices of the medium layout sit one mean label width from their nearest neighbour
  (the density is not compensated: spread then shows 1.5, dense 0.7 label widths; never out past the overview), and
  keeps the device clear of the panels (decision by Fabian Schwamborn, 2026-10-31).
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
- Texts in English and German; language from the Home Assistant user's locale, fallback English.

## 11. Settings per network [v1]

View, direction (v1.1), density, link class switches (`links`: `{ up, route, heard }`, booleans, a bad or missing
value counts as on), node view (`nodeView`: `coordinator` or `all`; anything else counts as `coordinator`), path display
(`pathColors`: `{ mode, bad, medium, good }`; `mode` `grey` or `coloured`, anything else `grey`; each colour only as
`#rrggbb`, anything else, `null` included, means the theme's own), labels (`labels`: `{ type, name, haName }`,
booleans, a bad or missing value counts as its default: on, on, off), fill (`none`, `role` or `power`; anything else,
including the former `reception`, counts as `none`), Details on click (`openDetailsOnSelect`: a boolean, else by
width), source route (`sourceRoute`: `off` or `assume`; anything else, a later `zigpy` included, counts as `assume`,
5.1), pinned positions; later geo positions and map background address (empty by default). Before 2026-11-01 the
panel stored `receptionColors` (colour by reception) and `legendOpen` (the legend pill): `receptionColors: true` without
a valid `pathColors` reads as coloured with the theme's colours; the next save leaves both keys out.

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
| Paths | On the sample: up paths complete 41 of 44, down paths 29 of 44, 20 of 29 differ, 2 active routes to unavailable devices. Assumed return paths (source route, 5.1) separately: 8 more devices, 37 of 44 with a measured or assumed down path; none without the coordinator's table. |
| Link evidence | On the sample: 241 pairs measured in both directions, 85 in one (12 of them implied by the parent, none by a route), 2 pairs implied by routes only; capacity 16 for IKEA and 26 for Signify models seen on several devices. |
| Parsing | Tests feed addresses as `0x` and `0X` text, numbers and LQI as text; string comparison fails the suite. |
| Fidelity | Rank correlation between drawn spring length and the reading's LQI over all readings ≤ −0.75 in every density, fixed seed. |
| Speed | Synthetic network of 300 devices and 3 000 readings settles (largest move < 0.5 px per step) within 5 s in Node; 30 frames per second while panning on a mid-range laptop (debug mode shows the frame rate). |
| Calm default | Default view state shows only the elements listed in 9.1. |
| Accessibility | Keyboard path to every device and value; hit areas ≥ 24 px; reduced motion honoured; 3:1 contrast of graphic elements. |
| Tests | No device needed; each suite under a minute; fixtures anonymized. |

## 13. Out of scope

Controlling devices; writing attributes, reporting configuration, binding (ZHA's device page does those); any radio
traffic other than a user-started topology request or a user-started read of a cluster's attribute values; installing
anything into other add-ons; a history database; anything sent outside Home Assistant; claims of compatibility or certification.
Later and small: one previous snapshot to show "since the last scan: links lost, parent changed".
