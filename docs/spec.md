# Specification

What Meshroute Topology Explorer does, described from the user's side and from Home Assistant's public interfaces.
It fixes behaviour, data rules and measurable acceptance, not code structure: how files and modules are cut is up to
the implementation. Terms in **bold** are defined where they first appear. Release tags: **[v1]** first usable
version (ZHA only), **[v1.1]** route view, **[later]** further sources and views. Status: reviewed draft, 2026-10-31.

## 1. Purpose and principles [v1]

The explorer helps people find and understand problems in the Zigbee and Thread networks Home Assistant runs:
a lamp that drops out, a sensor that reports late, a corner of the garden that hangs on one weak link.

- **Debugging comes first, calmly.** The default view answers "is my network healthy and where is it weak" at a
  glance. Raw values, the reporting side of each value, tables and the scan live one click away (section 9.1).
- **Read only.** The explorer never changes a network or a device. The only radio traffic it may cause is a
  topology request the user starts and confirms (ZHA scan, Thread refresh, Zigbee2MQTT map request).
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
| Which way does a packet travel, there and back? | route view, playback | v1.1 |
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
  - `Child` and `Parent` entries also occur between routers; they record joining, not routing, and are ignored.
  - For some destinations the coordinator keeps no routing entry (its direct neighbours; source routing whose route
    records Home Assistant does not expose): such paths are unknown.
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
| `meshroute_topology_explorer/*` | own settings and observations (10) | v1 |
| `matter/network_topology`, `matter/subscribe_network_topology`, `thread/discover_routers`, `thread/list_datasets` | Thread | later |
| `mqtt/subscribe`, service `mqtt.publish` to `<base>/bridge/request/networkmap` only | Zigbee2MQTT | later |

Anything else, in particular commands that return network keys or change a network (`zha/network/*`, `otbr/*`,
`thread/get_dataset*`, `thread/set_*`, `matter/set_*`, `matter/commission*`, `matter/open_commissioning_window`,
`zha/devices/permit`, `zha/devices/clusters/*`, `zha/devices/bind`, `zha/groups/*`, `zha/configuration/*`), is
forbidden.

## 4. Data model [v1]

One normalized model per network; every value knows where it came from.

### 4.1 Network
Source (adapter), network id (ZHA config entry; Thread extended PAN id), coordinator or border routers, time of the
newest data, completeness (6).

### 4.2 Device
Key: the IEEE / extended address, never a name. Network address, **role** (`coordinator`, `router`, `end device`,
`border router`, `unknown`), power source, vendor, model, display name, area, available, last seen. "Battery
device" in the interface means an end device whose power source is a battery.

### 4.3 Radio link
A directed reading "reporter R hears subject S": quality value, scale (`zigbee-lqi` 0–255, `thread-lqi` 0–3,
`rssi-dbm`), relationship if known. Both directions of a pair are separate readings. Each is a single reading of the
last frame: on the sample the two directions of a pair differ by a median of 8 LQI and by more than 60 in a tenth of
pairs.

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

### 5.1 Paths [v1 computed, v1.1 shown]
- **Up path** (device to coordinator): from the device, follow its parent if it is an end device, else its routing
  entry towards the coordinator, hop by hop.
- **Down path** (coordinator to device): follow the coordinator's routing entry towards the device, then each hop's
  entry. For an end device: if that does not reach the device, take the down path to its parent and append the
  parent link.
- A path that meets a missing table or entry, a loop, or an unavailable hop stops and is **incomplete**; it is
  never guessed, not even for the coordinator's direct neighbours.

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
- **Scan** (debug mode): explains the radio load and asks for confirmation; disabled while a scan of this panel runs;
  sends the command without waiting; then re-reads every 15 seconds for 2 minutes and every 60 seconds up to
  15 minutes, showing "tables changed since the scan started: x of y" with the note that an unchanged table may
  also have been answered; it never claims "finished".

## 7. Views

Two core views, switchable; the choice is stored per network.

### 7.1 Quality view [v1]
Radio readings laid out by a force-directed model (springs along readings, repulsion between all devices, a pull to
the centre).
- Every reading is a spring of rest length L = L0 × D × f(q), with q = LQI / 255 and f(q) = 1 + 5 (1 − q)²; a
  reading of 0 or no value counts as unknown, f = 1.5. A pair with two readings therefore has two springs.
- L0 is the base length: node diameter plus the mean label width in the label font, at zoom 1. D is the density:
  0.7 dense, 1.0 medium (default), 1.5 spread. Repulsion scales with (L0 × D)², so the balance of springs and
  repulsion, and with it the meaning of the picture, is the same in every density.
- Any standard spring-electrical integrator is acceptable if it is deterministic with a fixed seed and meets the
  fidelity and speed targets (12). On the sample network this curve gave a rank correlation between drawn length
  and LQI of −0.82, against −0.35 for constant springs.
- Pairs are drawn as one line, coloured by the better rating of its readings (5.4). For the selected device, under
  the pointer, and in debug mode a pair splits into two lanes, each right of its direction of travel, with its value.
- By default each device shows the lines of its 3 best pairs (by the pair's better rating), plus all pairs of the
  selection and of the device under the pointer; debug mode shows all, and every reading still shapes the layout
  (decision by Fabian Schwamborn, 2026-10-31).
- The density sets the working scale (decision by Fabian Schwamborn, 2026-10-31): overview and "fit" stay as they are,
  and zooming to a device goes to the scale at which the median distance from each device to its nearest neighbour
  on screen equals D × the mean label width (dense keeps context, medium lets labels fit, spread gives lane values
  room); the stored density (11) applies when the panel loads.
- Devices without readings sit evenly on an ellipse just outside the mesh (the half-axes of the mesh's bounding box
  plus L0 × D / 2), outlined "unknown".
- Dragging a device pins it (pin mark); "release" in the details or a double click unpins it. Pinned positions are
  stored (11).

### 7.2 Route view [v1.1]
The layout comes from routing, so the map sorts itself by paths.
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

- Nodes are grey. **Shape** encodes role (circle router, square coordinator, small circle end device, diamond border
  router); the **outline** encodes state (dashed: unknown; hollow: offline; pin mark: pinned).
- One selectable **fill**: reception (default), role, power source; relay load in v1.1; time since last heard later.
  Areas and vendors are "highlight group" filters (later), not colours.
- Palettes: Okabe–Ito for categories, cividis for sequences; graphic elements reach 3:1 contrast against light and
  dark Home Assistant themes. Colour never carries meaning alone. Lines, lanes and the reception fill share one
  rating scale: the part of cividis that keeps 3:1 against the theme's background.
- Labels are text, never HTML. A label never cuts away the part that distinguishes it from similar names (cut
  shared beginnings at word starts, keep the end); identical names get the network address appended. Below a scale
  tied to the working scale (7.1: devices half a label width from their nearest neighbour) only the coordinator,
  the selection and its neighbours carry labels; a label tries four places around its device before it is left out.
- Markers keep a minimum size in screen pixels. A legend explains the current view and fill.
- Category fills use the four Okabe–Ito colours that come close to 3:1 on both white and near-black, nudged to 3:1
  per theme: role (coordinator vermillion, router bluish green, end device blue, border router reddish purple) and
  power source (mains blue, battery reddish purple, DC bluish green); devices without a category stay grey. ZHA's
  "Battery or Unknown" counts as battery, and the legend says so.

## 9. Interaction [v1]

### 9.1 What is on screen
- **Default:** map, legend, status line, view switch **[v1.1]** (v1 has one view), density, a findings badge with a
  count. Nothing else.
- **One drawer** (side on wide screens; bottom sheet on narrow ones, opened collapsed to one line) with the tabs
  Details, Devices, Findings, Legend, Settings; at most one drawer open; it never covers the selected device (the
  map pans if needed).
- **Debug mode** (menu, not stored): values and reporters on both lanes, hop numbers, raw tables in Details, the
  scan, per-router "observed unchanged since".
- Wide means a panel at least 720 px wide; the side drawer takes 36 % of it within 320–400 px. The expanded sheet
  takes 55 % of the map (at least 240 px, always leaving 120 px of map). Opened by "open details on select" the
  sheet starts collapsed to one line; opened on request (badge, menu, small legend, right-click, long press, the info
  button) it starts expanded, since a list in one line shows nothing.
- The findings badge counts findings without hints ("very low reading") and each missing table once (decision
  2026-10-31). "Data incomplete" and the hedged "parent unknown (tables of … missing)" are consequences of missing
  tables, not verdicts: the Findings tab lists them together by the table they name (a finding that lacks several
  tables under each of them, a table only one device misses flat), and the badge counts them only through that
  table. The unhedged "no parent" is a finding of its own. Hints sit in their own collapsed group.
- The legend on the map is a small summary of the current fill that opens the Legend tab. The header carries the
  menu (devices, legend, settings, debug mode, fit, release all pins, read data again) and, on narrow screens, the
  sidebar button.

### 9.2 Selection and details
- Click or tap selects a device in every view; selection highlights its readings (quality view) or plays its path
  (route view). Clicking the background or Esc clears it.
- **Details** (tab of the drawer): name, vendor, model, addresses, area, role, parent and its availability, LQI at
  the parent, end-device children, relay load, readings in both directions with their reporters and ratings,
  routes, findings with evidence, last seen, link to the Home Assistant device page.
- "Open details on select" defaults to on for wide screens and off for narrow ones. Details also open with
  right-click on a node (captured on nodes only, the browser menu stays elsewhere), long press, an info button or
  the menu key.
- The info button sits in a small chip on the map (name, Details, clear) while a device is selected and the drawer
  is not on Details. "Open details on select" applies to selections on the map: it opens a closed drawer or follows
  on the Details tab, never takes another tab away; selecting from a list (Devices, Findings, a device named in
  Details) zooms to the device and keeps the list.

### 9.3 Gestures and keys
- One gesture model: a press that moves less than 8 px is a tap; more is a drag (node: pin and move; background:
  pan). Long press: 500 ms without moving 8 px. Pinch zooms. Wheel: × 1.2 per notch around the pointer. Zoom range
  0.1 to 8 times the fitted view. Buttons +, −, fit.
- Selecting a device in the list or a finding, double-clicking it or pressing Enter zooms and pans to the working
  scale (7.1; never out past the overview) and keeps the device clear of the drawer (decision by Fabian
  Schwamborn, 2026-10-31).
- Hover previews the selection highlight on pointer devices; nothing depends on hover.
- Keys: arrows and Enter in the device list (the keyboard path to every device; a text filter above it matches
  words in any order in name, model, vendor, area and addresses); Esc clears selection and stops
  playback; Space plays again; Right arrow steps; +, −, 0 zoom. Closing the drawer returns focus to where it was
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

View, direction (v1.1), density, fill, "open details on select", pinned positions; later geo positions and map
background address (empty by default).

The panel saves one second after the last change, when the page is hidden and on leaving, by read-merge-write: it
reads the stored object and writes back only what it changed, so last write wins per key and pins merge per device;
keys it does not know are kept. Stored settings are untrusted input: pins only under device addresses, coordinates
within ±1000 base lengths. If the integration lacks the commands or the stored object cannot be read, the settings
live in memory and the Settings tab says so; nothing stored is then overwritten. After a lost connection the panel
reads them again on reconnect.

## 12. Acceptance [v1]

| Target | Measure |
|---|---|
| Unknown beats wrong | On derived fixtures (sample with one table removed, with three removed, without the coordinator's table, coordinator table only) the findings are a subset of the complete sample's findings plus "data incomplete"; no "no parent", "isolated" or "weak reception" that the complete sample lacks; "parent unknown" only in its hedged form that names the missing tables. |
| Paths | On the sample: up paths complete 41 of 44, down paths 29 of 44, 20 of 29 differ, 2 active routes to unavailable devices. |
| Parsing | Tests feed addresses as `0x` and `0X` text, numbers and LQI as text; string comparison fails the suite. |
| Fidelity | Rank correlation between drawn spring length and the reading's LQI over all readings ≤ −0.75 in every density, fixed seed. |
| Speed | Synthetic network of 300 devices and 3 000 readings settles (largest move < 0.5 px per step) within 5 s in Node; 30 frames per second while panning on a mid-range laptop (debug mode shows the frame rate). |
| Calm default | Default view state shows only the elements listed in 9.1. |
| Accessibility | Keyboard path to every device and value; hit areas ≥ 24 px; reduced motion honoured; 3:1 contrast of graphic elements. |
| Tests | No device needed; each suite under a minute; fixtures anonymized. |

## 13. Out of scope

Controlling devices; writing to a network other than a user-started topology request; installing anything into
other add-ons; a history database; anything sent outside Home Assistant; claims of compatibility or certification.
Later and small: one previous snapshot to show "since the last scan: links lost, parent changed".
