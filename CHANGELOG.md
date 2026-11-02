# Changelog

## Unreleased

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
