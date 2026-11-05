# Changelog

## Unreleased

- **Path history:** select a device and click the "?" badge at another one to open the pair's window: Timeline (route bands and the weakest hop's rank over time), Route (Metro-Map or Mesh with a time slider, earlier routes as ghosts) and Direct link (both directions of one hop as LQI, Thread with RSSI below); Details' "Heard by · hears" rows get a 48 h sparkline. Thread pairs show their direct link and neighbours. Needs the reception history (administrators).
- **History in one click:** a click on any reception value on the map opens the pair window (the selection stays); Details gets a "History" button next to the device's name (partner: the coordinator, Thread the strongest border router; for those themselves the strongest neighbour) and "history ↗" on the path lines; the window's second name is a partner menu (coordinator, neighbours by reception, search) that keeps tab and range. The window's tab "Lane" is now "Direct link". The weakest hop is marked only on routes of at least 2 hops. Frontend only.
- **Options:** "Configure" on the integration (administrators) offers: show in the sidebar, allow radio actions (off hides
  the scan control and the attribute read in the panel; a panel switch, not a lock), and a reception history. Saving
  reloads the integration, not Home Assistant.
- **Reception history:** records the neighbour-table values (Zigbee LQI; Thread LQI and RSSI), Zigbee routing entries and
  route records and parent links after each of ZHA's own topology scans (a listener on its events; a timer at ZHA's
  period where that is not possible, and for Thread), from what ZHA and the Matter server already hold, never starting
  a scan, in the integration's own day files (kept 30 days, 1 to 90). The options show ZHA's scan period with a note
  how to change it in configuration.yaml (the integration never writes it). New administrator commands
  `history/series`, `history/records`, `history/info`, shown in the pair-history window (below). An optional, default-off "scan once 30 minutes after Home Assistant starts" asks ZHA for one topology scan
  when radio actions are allowed and the last record is older than ZHA's period. English translations only.
- **Status pill:** the status line at the bottom is now a pill floating at the bottom centre of the map: a round arrow
  button, the network's name over its data state ("29/29 router tables · unchanged since 15:50"), and a dot last (green:
  all tables read; amber: something missing or old; red: connection lost). It is the network menu; the menu also holds
  the full data state and a Settings link to Home Assistant's page of the integration (administrators only), repeated at
  the end of the View tab. The map gains the status row's height; on narrow maps only the short name and the dot show.
- **Values in the lane:** a lane's reception value is an upright number in a small pill that interrupts the lane, near the
  arrowhead (a quarter of the lane or 4 symbol diameters back, whichever is less; the middle on short lanes). The "RX:"
  prefix is gone; the legend explains the number once.

## 0.1.1 – Custom spread, direct delivery to neighbours

- **Custom spread:** a fourth node distance "Custom" with its own steps (25 % each, ×0.6 to ×8) in the View tab, a
  Spread button pair above the zoom buttons, keys `[` and `]`. The preset "Spread" is now labelled "Wide"; stored
  settings keep working.
- **Routing table view:** a router without a table entry for a destination in its own neighbour table delivers to it
  directly, as the Zigbee network layer does ("direct to a neighbour (no table entry needed)"). Return walks to the
  coordinator's neighbours no longer end in "?".
- **Drawing:** the selected device's lanes and values are drawn above other devices' symbols, so a device lying on a
  lane no longer hides it.
- **Names:** from medium density on, names are shortened only when longer than 28 characters.
- **Updates:** the panel's files are served under a hash of their content, so browsers load a new version without a
  forced reload.

## 0.1.0 – Zigbee map (ZHA), Thread preview

First public release.

- **Zigbee through ZHA:** a read-only map of the network from the tables ZHA holds. Who hears whom and how well,
  each reading ranked among what the receiving device reports; the paths the tables support, to the coordinator and
  back, along the routing table, or to all devices; line style states the evidence (read from a table, assumed,
  computed, heard only), the same in every view.
- **Data status first:** the status line says how many router tables were read and when; a device without data is
  marked unknown, never weak. Findings name the table entries they rest on.
- **Thread through Matter (preview):** neighbours and parents from the Matter server's cached topology, device
  pictures from the devices' Home Assistant entities.
- **Radio actions only on request:** a topology scan and a one-time read of a cluster's attribute values, both
  started by the user.
- Requirements: Home Assistant 2026.9 or newer with ZHA set up; the panel is for administrators. English only.
- Known limits: route records come from an internal zigpy interface and may report "not supported" after a Home
  Assistant update; no Zigbee2MQTT yet.
- Provenance: built from a written specification with AI assistance, commit by commit (see `docs/provenance.md`);
  a structure comparison against the force-graph and d3 packages, ha-zigbee-map 2.11.0 and Home Assistant's network
  map found no shared code above the threshold.
