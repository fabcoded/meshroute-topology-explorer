// SPDX-License-Identifier: MIT
// Names for what a device's signature carries (spec 9.2 "Cluster"): profiles,
// device types and clusters with their names, a sentence on what each common cluster does, and
// the known attributes of the common clusters (id, name, data type, side). Written for this project from the public
// Zigbee Cluster Library specification (07-5123, revision 8), the Zigbee Home Automation and Zigbee Light Link profile
// specifications and the Green Power basic specification; names follow the ZCL's own spelling. Data and lookups only,
// no DOM. Clusters 0xFC00-0xFFFF are manufacturer-specific by definition (ZCL 2.6.1.3): their meaning is the vendor's.
// npm test

/** Profiles by id. Proper names. */
export const PROFILES = Object.freeze({
  0x0104: "Home Automation", 0xc05e: "Light Link", 0xa1e0: "Green Power", 0x0109: "Smart Energy",
});

const HA = 0x0104;
const ZLL = 0xc05e;
const GP = 0xa1e0;
/** Device types per profile: id -> name. The ZLL controller ids are also used under the Home Automation
 *  profile by Zigbee 3.0 remotes, so they are listed under both. */
const DEVICE_TYPES = {
  [HA]: {
    0x0000: "On/Off Switch", 0x0001: "Level Control Switch",
    0x0002: "On/Off Output", 0x0003: "Level Controllable Output",
    0x0004: "Scene Selector", 0x0005: "Configuration Tool",
    0x0006: "Remote Control", 0x0007: "Combined Interface",
    0x0008: "Range Extender", 0x0009: "Mains Power Outlet",
    0x000a: "Door Lock", 0x000b: "Door Lock Controller",
    0x000c: "Simple Sensor", 0x000d: "Consumption Awareness Device",
    0x0050: "Home Gateway", 0x0051: "Smart Plug",
    0x0052: "White Goods", 0x0053: "Meter Interface",
    0x0100: "On/Off Light", 0x0101: "Dimmable Light",
    0x0102: "Color Dimmable Light", 0x0103: "On/Off Light Switch",
    0x0104: "Dimmer Switch", 0x0105: "Color Dimmer Switch",
    0x0106: "Light Sensor", 0x0107: "Occupancy Sensor",
    0x0108: "On/Off Ballast", 0x0109: "Dimmable Ballast",
    0x010a: "On/Off Plug-in Unit", 0x010b: "Dimmable Plug-in Unit",
    0x010c: "Color Temperature Light", 0x010d: "Extended Color Light",
    0x010e: "Light Level Sensor",
    0x0200: "Shade", 0x0201: "Shade Controller",
    0x0202: "Window Covering Device", 0x0203: "Window Covering Controller",
    0x0300: "Heating/Cooling Unit", 0x0301: "Thermostat",
    0x0302: "Temperature Sensor", 0x0303: "Pump",
    0x0304: "Pump Controller", 0x0305: "Pressure Sensor",
    0x0306: "Flow Sensor", 0x0307: "Mini Split AC",
    0x0400: "IAS Control and Indicating Equipment",
    0x0401: "IAS Ancillary Control Equipment", 0x0402: "IAS Zone",
    0x0403: "IAS Warning Device",
    0x0800: "Color Controller", 0x0810: "Color Scene Controller",
    0x0820: "Non-Color Controller",
    0x0830: "Non-Color Scene Controller", 0x0840: "Control Bridge",
    0x0850: "On/Off Sensor",
  },
  [ZLL]: {
    0x0000: "On/Off Light", 0x0010: "On/Off Plug-in Unit",
    0x0100: "Dimmable Light", 0x0110: "Dimmable Plug-in Unit",
    0x0200: "Color Light", 0x0210: "Extended Color Light",
    0x0220: "Color Temperature Light",
    0x0800: "Color Controller", 0x0810: "Color Scene Controller",
    0x0820: "Non-Color Controller",
    0x0830: "Non-Color Scene Controller", 0x0840: "Control Bridge",
    0x0850: "On/Off Sensor",
  },
  [GP]: {
    0x0060: "Proxy", 0x0061: "Proxy Basic", 0x0062: "Target Plus",
    0x0063: "Target", 0x0064: "Commissioning Tool", 0x0065: "Combo",
    0x0066: "Combo Basic",
  },
};

/** Clusters: id -> [name, what it does]. */
const CLUSTERS = {
  0x0000: ["Basic", "Who the device is: manufacturer, model, versions and power source."],
  0x0001: ["Power Configuration", "Mains and battery: voltage, battery level and battery type."],
  0x0002: ["Device Temperature", "The device's own temperature."],
  0x0003: ["Identify", "Makes the device show itself, for example by blinking."],
  0x0004: ["Groups", "Group membership, so that one command reaches several devices."],
  0x0005: ["Scenes", "Stored scenes that the device recalls on command."],
  0x0006: ["On/Off", "Switches the device on and off."],
  0x0007: ["On/Off Switch Configuration", "How a switch acts when pressed."],
  0x0008: ["Level Control", "Sets a level, such as the brightness of a lamp."],
  0x0009: ["Alarms", "A list of the device's alarms."],
  0x000a: ["Time", "The time of day, for devices that keep a clock."],
  0x000c: ["Analog Input", "A measured value of a kind the vendor defines."],
  0x000f: ["Binary Input", "An input that is on or off."],
  0x0019: ["OTA Upgrade", "Firmware updates over the air: which version runs and what is being loaded."],
  0x0020: ["Poll Control", "How often a sleeping device wakes up to ask for messages."],
  0x0021: ["Green Power", "Relays the messages of battery-free Green Power switches."],
  0x0025: ["Keep-Alive", "Tells a sleeping device how often to check in."],
  0x0101: ["Door Lock", "Locks and unlocks a door."],
  0x0102: ["Window Covering", "Moves blinds, shades and curtains."],
  0x0201: ["Thermostat", "Controls heating and cooling by set points."],
  0x0202: ["Fan Control", "Sets the speed of a fan."],
  0x0300: ["Color Control", "Sets colour and colour temperature of a light."],
  0x0400: ["Illuminance Measurement", "Measures illuminance, on a logarithmic scale."],
  0x0402: ["Temperature Measurement", "Measures temperature, in hundredths of a degree Celsius."],
  0x0403: ["Pressure Measurement", "Measures pressure."],
  0x0405: ["Relative Humidity Measurement", "Measures relative humidity, in hundredths of a percent."],
  0x0406: ["Occupancy Sensing", "Reports whether someone is there (motion or presence)."],
  0x040d: ["Carbon Dioxide Measurement", "Measures the CO₂ concentration."],
  0x042a: ["PM2.5 Measurement", "Measures fine dust (PM2.5)."],
  0x0500: ["IAS Zone", "A security zone: reports alarms such as an open door, water or smoke."],
  0x0501: ["IAS ACE", "A keypad that arms and disarms an alarm system."],
  0x0502: ["IAS WD", "A siren or warning device."],
  0x0702: ["Metering", "Counts energy or another quantity, like a meter."],
  0x0b04: ["Electrical Measurement", "Measures voltage, current and power."],
  0x0b05: ["Diagnostics", "Counters of the radio stack: resets, retries, failures, the last LQI."],
  0x1000: ["Touchlink", "Pairing at close range (Touchlink), mainly for lights and remotes."],
};

/** Known attributes of the common clusters (ZCL r8): [id, name, data type, side]. Side "s" is the
 *  server (the device that offers the cluster), "c" the client; names are spelled as the specification spells them. */
const ATTRIBUTES = {
  0x0000: [[0x0000, "ZCLVersion", "uint8", "s"], [0x0001, "ApplicationVersion", "uint8", "s"],
    [0x0002, "StackVersion", "uint8", "s"], [0x0003, "HWVersion", "uint8", "s"],
    [0x0004, "ManufacturerName", "string", "s"], [0x0005, "ModelIdentifier", "string", "s"],
    [0x0006, "DateCode", "string", "s"], [0x0007, "PowerSource", "enum8", "s"],
    [0x0008, "GenericDevice-Class", "enum8", "s"], [0x0009, "GenericDevice-Type", "enum8", "s"],
    [0x000a, "ProductCode", "octstr", "s"], [0x000b, "ProductURL", "string", "s"],
    [0x000c, "ManufacturerVersionDetails", "string", "s"], [0x000d, "SerialNumber", "string", "s"],
    [0x000e, "ProductLabel", "string", "s"], [0x0010, "LocationDescription", "string", "s"],
    [0x0011, "PhysicalEnvironment", "enum8", "s"], [0x0012, "DeviceEnabled", "bool", "s"],
    [0x0013, "AlarmMask", "map8", "s"], [0x0014, "DisableLocalConfig", "map8", "s"],
    [0x4000, "SWBuildID", "string", "s"]],
  0x0001: [[0x0000, "MainsVoltage", "uint16", "s"], [0x0001, "MainsFrequency", "uint8", "s"],
    [0x0010, "MainsAlarmMask", "map8", "s"], [0x0011, "MainsVoltageMinThreshold", "uint16", "s"],
    [0x0012, "MainsVoltageMaxThreshold", "uint16", "s"], [0x0013, "MainsVoltageDwellTripPoint", "uint16", "s"],
    [0x0020, "BatteryVoltage", "uint8", "s"],
    [0x0021, "BatteryPercentageRemaining", "uint8", "s"],
    [0x0030, "BatteryManufacturer", "string", "s"], [0x0031, "BatterySize", "enum8", "s"],
    [0x0032, "BatteryAHrRating", "uint16", "s"], [0x0033, "BatteryQuantity", "uint8", "s"],
    [0x0034, "BatteryRatedVoltage", "uint8", "s"], [0x0035, "BatteryAlarmMask", "map8", "s"],
    [0x0036, "BatteryVoltageMinThreshold", "uint8", "s"], [0x003e, "BatteryAlarmState", "map32", "s"]],
  0x0003: [[0x0000, "IdentifyTime", "uint16", "s"]],
  0x0004: [[0x0000, "NameSupport", "map8", "s"]],
  0x0005: [[0x0000, "SceneCount", "uint8", "s"], [0x0001, "CurrentScene", "uint8", "s"],
    [0x0002, "CurrentGroup", "uint16", "s"], [0x0003, "SceneValid", "bool", "s"],
    [0x0004, "NameSupport", "map8", "s"], [0x0005, "LastConfiguredBy", "EUI64", "s"]],
  0x0006: [[0x0000, "OnOff", "bool", "s"], [0x4000, "GlobalSceneControl", "bool", "s"],
    [0x4001, "OnTime", "uint16", "s"], [0x4002, "OffWaitTime", "uint16", "s"],
    [0x4003, "StartUpOnOff", "enum8", "s"]],
  0x0008: [[0x0000, "CurrentLevel", "uint8", "s"], [0x0001, "RemainingTime", "uint16", "s"],
    [0x0002, "MinLevel", "uint8", "s"], [0x0003, "MaxLevel", "uint8", "s"],
    [0x000f, "Options", "map8", "s"], [0x0010, "OnOffTransitionTime", "uint16", "s"],
    [0x0011, "OnLevel", "uint8", "s"], [0x0012, "OnTransitionTime", "uint16", "s"],
    [0x0013, "OffTransitionTime", "uint16", "s"], [0x0014, "DefaultMoveRate", "uint8", "s"],
    [0x4000, "StartUpCurrentLevel", "uint8", "s"]],
  0x0019: [[0x0000, "UpgradeServerID", "EUI64", "c"], [0x0001, "FileOffset", "uint32", "c"],
    [0x0002, "CurrentFileVersion", "uint32", "c"], [0x0003, "CurrentZigBeeStackVersion", "uint16", "c"],
    [0x0004, "DownloadedFileVersion", "uint32", "c"],
    [0x0005, "DownloadedZigBeeStackVersion", "uint16", "c"], [0x0006, "ImageUpgradeStatus", "enum8", "c"],
    [0x0007, "ManufacturerID", "uint16", "c"], [0x0008, "ImageTypeID", "uint16", "c"],
    [0x0009, "MinimumBlockPeriod", "uint16", "c"], [0x000a, "ImageStamp", "uint32", "c"]],
  0x0020: [[0x0000, "Check-inInterval", "uint32", "s"],
    [0x0001, "LongPollInterval", "uint32", "s"],
    [0x0002, "ShortPollInterval", "uint16", "s"],
    [0x0003, "FastPollTimeout", "uint16", "s"], [0x0004, "Check-inIntervalMin", "uint32", "s"],
    [0x0005, "LongPollIntervalMin", "uint32", "s"], [0x0006, "FastPollTimeoutMax", "uint16", "s"]],
  0x0300: [[0x0000, "CurrentHue", "uint8", "s"], [0x0001, "CurrentSaturation", "uint8", "s"],
    [0x0002, "RemainingTime", "uint16", "s"], [0x0003, "CurrentX", "uint16", "s"],
    [0x0004, "CurrentY", "uint16", "s"], [0x0005, "DriftCompensation", "enum8", "s"],
    [0x0006, "CompensationText", "string", "s"], [0x0007, "ColorTemperatureMireds", "uint16", "s"],
    [0x0008, "ColorMode", "enum8", "s"], [0x000f, "Options", "map8", "s"],
    [0x0010, "NumberOfPrimaries", "uint8", "s"], [0x4000, "EnhancedCurrentHue", "uint16", "s"],
    [0x4001, "EnhancedColorMode", "enum8", "s"], [0x4002, "ColorLoopActive", "uint8", "s"],
    [0x4003, "ColorLoopDirection", "uint8", "s"], [0x4004, "ColorLoopTime", "uint16", "s"],
    [0x4005, "ColorLoopStartEnhancedHue", "uint16", "s"], [0x4006, "ColorLoopStoredEnhancedHue", "uint16", "s"],
    [0x400a, "ColorCapabilities", "map16", "s"],
    [0x400b, "ColorTempPhysicalMinMireds", "uint16", "s"],
    [0x400c, "ColorTempPhysicalMaxMireds", "uint16", "s"],
    [0x400d, "CoupleColorTempToLevelMinMireds", "uint16", "s"],
    [0x4010, "StartUpColorTemperatureMireds", "uint16", "s"]],
  0x0400: [[0x0000, "MeasuredValue", "uint16", "s"], [0x0001, "MinMeasuredValue", "uint16", "s"],
    [0x0002, "MaxMeasuredValue", "uint16", "s"], [0x0003, "Tolerance", "uint16", "s"],
    [0x0004, "LightSensorType", "enum8", "s"]],
  0x0402: [[0x0000, "MeasuredValue", "int16", "s"], [0x0001, "MinMeasuredValue", "int16", "s"],
    [0x0002, "MaxMeasuredValue", "int16", "s"], [0x0003, "Tolerance", "uint16", "s"]],
  0x0405: [[0x0000, "MeasuredValue", "uint16", "s"], [0x0001, "MinMeasuredValue", "uint16", "s"],
    [0x0002, "MaxMeasuredValue", "uint16", "s"], [0x0003, "Tolerance", "uint16", "s"]],
  0x0406: [[0x0000, "Occupancy", "map8", "s"], [0x0001, "OccupancySensorType", "enum8", "s"],
    [0x0002, "OccupancySensorTypeBitmap", "map8", "s"],
    [0x0010, "PIROccupiedToUnoccupiedDelay", "uint16", "s"],
    [0x0011, "PIRUnoccupiedToOccupiedDelay", "uint16", "s"], [0x0012, "PIRUnoccupiedToOccupiedThreshold", "uint8", "s"]],
  0x0500: [[0x0000, "ZoneState", "enum8", "s"], [0x0001, "ZoneType", "enum16", "s"],
    [0x0002, "ZoneStatus", "map16", "s"], [0x0010, "IAS_CIE_Address", "EUI64", "s"],
    [0x0011, "ZoneID", "uint8", "s"], [0x0012, "NumberOfZoneSensitivityLevelsSupported", "uint8", "s"],
    [0x0013, "CurrentZoneSensitivityLevel", "uint8", "s"]],
  0x0702: [[0x0000, "CurrentSummationDelivered", "uint48", "s"],
    [0x0001, "CurrentSummationReceived", "uint48", "s"], [0x0200, "Status", "map8", "s"],
    [0x0300, "UnitofMeasure", "enum8", "s"], [0x0301, "Multiplier", "uint24", "s"],
    [0x0302, "Divisor", "uint24", "s"], [0x0303, "SummationFormatting", "map8", "s"],
    [0x0306, "MeteringDeviceType", "map8", "s"], [0x0400, "InstantaneousDemand", "int24", "s"]],
  0x0b04: [[0x0000, "MeasurementType", "map32", "s"], [0x0300, "ACFrequency", "uint16", "s"],
    [0x0505, "RMSVoltage", "uint16", "s"], [0x0508, "RMSCurrent", "uint16", "s"],
    [0x050b, "ActivePower", "int16", "s"], [0x050e, "ReactivePower", "int16", "s"],
    [0x050f, "ApparentPower", "uint16", "s"], [0x0510, "PowerFactor", "int8", "s"],
    [0x0600, "ACVoltageMultiplier", "uint16", "s"], [0x0601, "ACVoltageDivisor", "uint16", "s"],
    [0x0602, "ACCurrentMultiplier", "uint16", "s"], [0x0603, "ACCurrentDivisor", "uint16", "s"],
    [0x0604, "ACPowerMultiplier", "uint16", "s"], [0x0605, "ACPowerDivisor", "uint16", "s"]],
  0x0b05: [[0x0000, "NumberOfResets", "uint16", "s"], [0x0001, "PersistentMemoryWrites", "uint16", "s"],
    [0x0100, "MacRxBcast", "uint32", "s"], [0x0101, "MacTxBcast", "uint32", "s"], [0x0102, "MacRxUcast", "uint32", "s"],
    [0x0103, "MacTxUcast", "uint32", "s"], [0x0104, "MacTxUcastRetry", "uint16", "s"],
    [0x0105, "MacTxUcastFail", "uint16", "s"], [0x0106, "APSRxBcast", "uint16", "s"],
    [0x0107, "APSTxBcast", "uint16", "s"], [0x0108, "APSRxUcast", "uint16", "s"],
    [0x0109, "APSTxUcastSuccess", "uint16", "s"], [0x010a, "APSTxUcastRetry", "uint16", "s"],
    [0x010b, "APSTxUcastFail", "uint16", "s"], [0x010c, "RouteDiscInitiated", "uint16", "s"],
    [0x010d, "NeighborAdded", "uint16", "s"], [0x010e, "NeighborRemoved", "uint16", "s"],
    [0x010f, "NeighborStale", "uint16", "s"], [0x0110, "JoinIndication", "uint16", "s"],
    [0x0111, "ChildMoved", "uint16", "s"], [0x0112, "NWKFCFailure", "uint16", "s"], [0x0113, "APSFCFailure", "uint16", "s"],
    [0x0114, "APSUnauthorizedKey", "uint16", "s"], [0x0115, "NWKDecryptFailures", "uint16", "s"],
    [0x0116, "APSDecryptFailures", "uint16", "s"], [0x0117, "PacketBufferAllocateFailures", "uint16", "s"],
    [0x0118, "RelayedUcast", "uint16", "s"],
    [0x0119, "PhyToMACQueueLimitReached", "uint16", "s"], [0x011a, "PacketValidateDropCount", "uint16", "s"],
    [0x011b, "AverageMACRetryPerAPSMessageSent", "uint16", "s"],
    [0x011c, "LastMessageLQI", "uint8", "s"],
    [0x011d, "LastMessageRSSI", "int8", "s"]],
  // Touchlink (ZLL commissioning) defines commands only, no attributes: an empty list is knowledge, not a gap.
  0x1000: [],
};

/** Whether a cluster id lies in the manufacturer-specific range (ZCL: 0xFC00-0xFFFF). */
export function isManufacturerSpecific(id) {
  return Number.isInteger(id) && id >= 0xfc00 && id <= 0xffff;
}

/** The name of a cluster, or null when it is not in the list. */
export function clusterName(id) {
  return Object.hasOwn(CLUSTERS, id) ? CLUSTERS[id][0] : null;
}

/** One sentence on what a cluster does, or null. */
export function clusterAbout(id) {
  return Object.hasOwn(CLUSTERS, id) ? CLUSTERS[id][1] : null;
}

export function profileName(id) {
  return Object.hasOwn(PROFILES, id) ? PROFILES[id] : null;
}

/** The name of a device type within its profile, or null. */
export function deviceTypeName(profile, id) {
  const list = Object.hasOwn(DEVICE_TYPES, profile) ? DEVICE_TYPES[profile] : null;
  return list && Object.hasOwn(list, id) ? list[id] : null;
}

/** Known attributes of a cluster: [{ id, name, type, side: "server" | "client" }], or null when
 *  the cluster has no list here (the interface then says "no attribute list known"). */
export function clusterAttributes(id) {
  if (!Object.hasOwn(ATTRIBUTES, id)) return null;
  return ATTRIBUTES[id].map(([aid, name, type, side]) => ({ id: aid, name, type,
    side: side === "c" ? "client" : "server" }));
}

/** The attributes ZHA can read on the device's side of a cluster: a server (input) cluster holds the server
 *  attributes, a client (output) cluster the client ones (ZCL 2.2.1). */
export function readableAttributes(id, direction) {
  const all = clusterAttributes(id) || [];
  const side = direction === "out" ? "client" : "server";
  return all.filter((a) => a.side === side);
}

/** Cluster ids with an attribute list, for tests and the docs. */
export const CATALOGUED = Object.freeze(Object.keys(ATTRIBUTES).map(Number));
/** Every cluster with a name, for tests. */
export const NAMED = Object.freeze(Object.keys(CLUSTERS).map(Number));
