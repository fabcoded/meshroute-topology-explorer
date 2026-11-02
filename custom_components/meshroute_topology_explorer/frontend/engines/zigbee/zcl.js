// SPDX-License-Identifier: MIT
// Names for what a device's signature carries (spec 9.2 "Cluster"; design by Fabian Schwamborn, 2026-11-01): profiles,
// device types and clusters with their names in English and German, a sentence on what each common cluster does, and
// the known attributes of the common clusters (id, name, data type, side). Written for this project from the public
// Zigbee Cluster Library specification (07-5123, revision 8), the Zigbee Home Automation and Zigbee Light Link profile
// specifications and the Green Power basic specification; names follow the ZCL's own spelling. Data and lookups only,
// no DOM. Clusters 0xFC00-0xFFFF are manufacturer-specific by definition (ZCL 2.6.1.3): their meaning is the vendor's.
// npm test

/** Profiles by id. Proper names, the same in every language. */
export const PROFILES = Object.freeze({
  0x0104: "Home Automation", 0xc05e: "Light Link", 0xa1e0: "Green Power", 0x0109: "Smart Energy",
});

const HA = 0x0104;
const ZLL = 0xc05e;
const GP = 0xa1e0;
/** Device types per profile: id -> "English|German" (one string per pair; it also keeps tools/guard.py from reading a
 *  name such as On/Off as a websocket command). The ZLL controller ids are also used under the Home Automation
 *  profile by Zigbee 3.0 remotes, so they are listed under both. */
const DEVICE_TYPES = {
  [HA]: {
    0x0000: "On/Off Switch|Ein/Aus-Schalter", 0x0001: "Level Control Switch|Dimmschalter",
    0x0002: "On/Off Output|Ein/Aus-Ausgang", 0x0003: "Level Controllable Output|Dimmbarer Ausgang",
    0x0004: "Scene Selector|Szenenwähler", 0x0005: "Configuration Tool|Konfigurationswerkzeug",
    0x0006: "Remote Control|Fernbedienung", 0x0007: "Combined Interface|Kombinierte Schnittstelle",
    0x0008: "Range Extender|Reichweitenverstärker", 0x0009: "Mains Power Outlet|Steckdose",
    0x000a: "Door Lock|Türschloss", 0x000b: "Door Lock Controller|Türschloss-Steuerung",
    0x000c: "Simple Sensor|Einfacher Sensor", 0x000d: "Consumption Awareness Device|Verbrauchsanzeige",
    0x0050: "Home Gateway|Heim-Gateway", 0x0051: "Smart Plug|Zwischenstecker",
    0x0052: "White Goods|Haushaltsgerät", 0x0053: "Meter Interface|Zählerschnittstelle",
    0x0100: "On/Off Light|Ein/Aus-Lampe", 0x0101: "Dimmable Light|Dimmbare Lampe",
    0x0102: "Color Dimmable Light|Farbige dimmbare Lampe", 0x0103: "On/Off Light Switch|Lichtschalter",
    0x0104: "Dimmer Switch|Dimmschalter", 0x0105: "Color Dimmer Switch|Farbdimmer",
    0x0106: "Light Sensor|Lichtsensor", 0x0107: "Occupancy Sensor|Anwesenheitssensor",
    0x0108: "On/Off Ballast|Ein/Aus-Vorschaltgerät", 0x0109: "Dimmable Ballast|Dimmbares Vorschaltgerät",
    0x010a: "On/Off Plug-in Unit|Ein/Aus-Steckdose", 0x010b: "Dimmable Plug-in Unit|Dimmbare Steckdose",
    0x010c: "Color Temperature Light|Farbtemperatur-Lampe", 0x010d: "Extended Color Light|Farblampe",
    0x010e: "Light Level Sensor|Helligkeitssensor",
    0x0200: "Shade|Beschattung", 0x0201: "Shade Controller|Beschattungssteuerung",
    0x0202: "Window Covering Device|Fensterbehang", 0x0203: "Window Covering Controller|Fensterbehang-Steuerung",
    0x0300: "Heating/Cooling Unit|Heiz-/Kühlgerät", 0x0301: "Thermostat|Thermostat",
    0x0302: "Temperature Sensor|Temperatursensor", 0x0303: "Pump|Pumpe",
    0x0304: "Pump Controller|Pumpensteuerung", 0x0305: "Pressure Sensor|Drucksensor",
    0x0306: "Flow Sensor|Durchflusssensor", 0x0307: "Mini Split AC|Split-Klimagerät",
    0x0400: "IAS Control and Indicating Equipment|IAS-Zentrale",
    0x0401: "IAS Ancillary Control Equipment|IAS-Bedienteil", 0x0402: "IAS Zone|IAS-Zone",
    0x0403: "IAS Warning Device|IAS-Warngerät",
    0x0800: "Color Controller|Farbfernbedienung", 0x0810: "Color Scene Controller|Farb-Szenenfernbedienung",
    0x0820: "Non-Color Controller|Fernbedienung ohne Farbe",
    0x0830: "Non-Color Scene Controller|Szenenfernbedienung ohne Farbe", 0x0840: "Control Bridge|Steuerbrücke",
    0x0850: "On/Off Sensor|Ein/Aus-Sensor",
  },
  [ZLL]: {
    0x0000: "On/Off Light|Ein/Aus-Lampe", 0x0010: "On/Off Plug-in Unit|Ein/Aus-Steckdose",
    0x0100: "Dimmable Light|Dimmbare Lampe", 0x0110: "Dimmable Plug-in Unit|Dimmbare Steckdose",
    0x0200: "Color Light|Farbige Lampe", 0x0210: "Extended Color Light|Farblampe",
    0x0220: "Color Temperature Light|Farbtemperatur-Lampe",
    0x0800: "Color Controller|Farbfernbedienung", 0x0810: "Color Scene Controller|Farb-Szenenfernbedienung",
    0x0820: "Non-Color Controller|Fernbedienung ohne Farbe",
    0x0830: "Non-Color Scene Controller|Szenenfernbedienung ohne Farbe", 0x0840: "Control Bridge|Steuerbrücke",
    0x0850: "On/Off Sensor|Ein/Aus-Sensor",
  },
  [GP]: {
    0x0060: "Proxy|Proxy", 0x0061: "Proxy Basic|Proxy Basic", 0x0062: "Target Plus|Target Plus",
    0x0063: "Target|Target", 0x0064: "Commissioning Tool|Inbetriebnahme-Werkzeug", 0x0065: "Combo|Combo",
    0x0066: "Combo Basic|Combo Basic",
  },
};

/** Clusters: id -> ["English|German" name, what it does (English), what it does (German)]. */
const CLUSTERS = {
  0x0000: ["Basic|Basic", "Who the device is: manufacturer, model, versions and power source.",
    "Wer das Gerät ist: Hersteller, Modell, Versionen und Stromquelle."],
  0x0001: ["Power Configuration|Stromversorgung", "Mains and battery: voltage, battery level and battery type.",
    "Netz und Batterie: Spannung, Ladestand und Batterietyp."],
  0x0002: ["Device Temperature|Gerätetemperatur", "The device's own temperature.", "Die eigene Temperatur des Geräts."],
  0x0003: ["Identify|Identify", "Makes the device show itself, for example by blinking.",
    "Lässt das Gerät sich zeigen, etwa durch Blinken."],
  0x0004: ["Groups|Gruppen", "Group membership, so that one command reaches several devices.",
    "Gruppenmitgliedschaft: Ein Befehl erreicht mehrere Geräte."],
  0x0005: ["Scenes|Szenen", "Stored scenes that the device recalls on command.",
    "Gespeicherte Szenen, die das Gerät auf Befehl abruft."],
  0x0006: ["On/Off|Ein/Aus", "Switches the device on and off.", "Schaltet das Gerät ein und aus."],
  0x0007: ["On/Off Switch Configuration|Schalterkonfiguration", "How a switch acts when pressed.",
    "Wie ein Schalter beim Drücken wirkt."],
  0x0008: ["Level Control|Helligkeit", "Sets a level, such as the brightness of a lamp.",
    "Stellt eine Stufe ein, etwa die Helligkeit einer Lampe."],
  0x0009: ["Alarms|Alarme", "A list of the device's alarms.", "Eine Liste der Alarme des Geräts."],
  0x000a: ["Time|Zeit", "The time of day, for devices that keep a clock.", "Die Uhrzeit, für Geräte mit eigener Uhr."],
  0x000c: ["Analog Input|Analogeingang", "A measured value of a kind the vendor defines.",
    "Ein Messwert einer Art, die der Hersteller festlegt."],
  0x000f: ["Binary Input|Binäreingang", "An input that is on or off.", "Ein Eingang, der an oder aus ist."],
  0x0019: ["OTA Upgrade|OTA-Update", "Firmware updates over the air: which version runs and what is being loaded.",
    "Firmware-Updates per Funk: welche Version läuft und was gerade geladen wird."],
  0x0020: ["Poll Control|Poll Control", "How often a sleeping device wakes up to ask for messages.",
    "Wie oft ein schlafendes Gerät aufwacht, um nach Nachrichten zu fragen."],
  0x0021: ["Green Power|Green Power", "Relays the messages of battery-free Green Power switches.",
    "Leitet die Nachrichten batterieloser Green-Power-Schalter weiter."],
  0x0025: ["Keep-Alive|Keep-Alive", "Tells a sleeping device how often to check in.",
    "Sagt einem schlafenden Gerät, wie oft es sich melden soll."],
  0x0101: ["Door Lock|Türschloss", "Locks and unlocks a door.", "Verriegelt und entriegelt eine Tür."],
  0x0102: ["Window Covering|Beschattung", "Moves blinds, shades and curtains.",
    "Bewegt Rollläden, Jalousien und Vorhänge."],
  0x0201: ["Thermostat|Thermostat", "Controls heating and cooling by set points.",
    "Regelt Heizen und Kühlen über Sollwerte."],
  0x0202: ["Fan Control|Lüfter", "Sets the speed of a fan.", "Stellt die Drehzahl eines Lüfters ein."],
  0x0300: ["Color Control|Farbe", "Sets colour and colour temperature of a light.",
    "Stellt Farbe und Farbtemperatur einer Lampe ein."],
  0x0400: ["Illuminance Measurement|Helligkeitsmessung", "Measures illuminance, on a logarithmic scale.",
    "Misst die Beleuchtungsstärke, auf einer logarithmischen Skala."],
  0x0402: ["Temperature Measurement|Temperaturmessung", "Measures temperature, in hundredths of a degree Celsius.",
    "Misst die Temperatur, in Hundertstel Grad Celsius."],
  0x0403: ["Pressure Measurement|Luftdruckmessung", "Measures pressure.", "Misst den Druck."],
  0x0405: ["Relative Humidity Measurement|Luftfeuchtemessung",
    "Measures relative humidity, in hundredths of a percent.", "Misst die relative Luftfeuchte, in Hundertstel Prozent."],
  0x0406: ["Occupancy Sensing|Anwesenheit", "Reports whether someone is there (motion or presence).",
    "Meldet, ob jemand da ist (Bewegung oder Anwesenheit)."],
  0x040d: ["Carbon Dioxide Measurement|CO₂-Messung", "Measures the CO₂ concentration.", "Misst den CO₂-Gehalt."],
  0x042a: ["PM2.5 Measurement|Feinstaubmessung", "Measures fine dust (PM2.5).", "Misst Feinstaub (PM2,5)."],
  0x0500: ["IAS Zone|IAS-Zone", "A security zone: reports alarms such as an open door, water or smoke.",
    "Eine Sicherheitszone: meldet Alarme wie offene Tür, Wasser oder Rauch."],
  0x0501: ["IAS ACE|IAS-Bedienteil", "A keypad that arms and disarms an alarm system.",
    "Ein Bedienteil, das eine Alarmanlage scharf und unscharf schaltet."],
  0x0502: ["IAS WD|IAS-Warngerät", "A siren or warning device.", "Eine Sirene oder ein Warngerät."],
  0x0702: ["Metering|Zähler", "Counts energy or another quantity, like a meter.",
    "Zählt Energie oder eine andere Menge, wie ein Zähler."],
  0x0b04: ["Electrical Measurement|Elektrische Messung", "Measures voltage, current and power.",
    "Misst Spannung, Strom und Leistung."],
  0x0b05: ["Diagnostics|Diagnose", "Counters of the radio stack: resets, retries, failures, the last LQI.",
    "Zähler des Funkstacks: Neustarts, Wiederholungen, Fehler, der letzte LQI."],
  0x1000: ["Touchlink|Touchlink", "Pairing at close range (Touchlink), mainly for lights and remotes.",
    "Koppeln aus der Nähe (Touchlink), vor allem für Lampen und Fernbedienungen."],
};

/** Known attributes of the common clusters (ZCL r8): [id, name, data type, side, German gloss]. Side "s" is the
 *  server (the device that offers the cluster), "c" the client; a gloss explains the ZCL name where German readers
 *  need it (the names themselves stay as the specification spells them). */
const ATTRIBUTES = {
  0x0000: [[0x0000, "ZCLVersion", "uint8", "s", "ZCL-Version"], [0x0001, "ApplicationVersion", "uint8", "s", "Anwendungsversion"],
    [0x0002, "StackVersion", "uint8", "s", "Stack-Version"], [0x0003, "HWVersion", "uint8", "s", "Hardware-Version"],
    [0x0004, "ManufacturerName", "string", "s", "Hersteller"], [0x0005, "ModelIdentifier", "string", "s", "Modell"],
    [0x0006, "DateCode", "string", "s", "Datumscode"], [0x0007, "PowerSource", "enum8", "s", "Stromquelle"],
    [0x0008, "GenericDevice-Class", "enum8", "s"], [0x0009, "GenericDevice-Type", "enum8", "s"],
    [0x000a, "ProductCode", "octstr", "s"], [0x000b, "ProductURL", "string", "s"],
    [0x000c, "ManufacturerVersionDetails", "string", "s"], [0x000d, "SerialNumber", "string", "s", "Seriennummer"],
    [0x000e, "ProductLabel", "string", "s"], [0x0010, "LocationDescription", "string", "s", "Ortsbeschreibung"],
    [0x0011, "PhysicalEnvironment", "enum8", "s"], [0x0012, "DeviceEnabled", "bool", "s", "Gerät aktiv"],
    [0x0013, "AlarmMask", "map8", "s"], [0x0014, "DisableLocalConfig", "map8", "s"],
    [0x4000, "SWBuildID", "string", "s", "Software-Build"]],
  0x0001: [[0x0000, "MainsVoltage", "uint16", "s", "Netzspannung"], [0x0001, "MainsFrequency", "uint8", "s", "Netzfrequenz"],
    [0x0010, "MainsAlarmMask", "map8", "s"], [0x0011, "MainsVoltageMinThreshold", "uint16", "s"],
    [0x0012, "MainsVoltageMaxThreshold", "uint16", "s"], [0x0013, "MainsVoltageDwellTripPoint", "uint16", "s"],
    [0x0020, "BatteryVoltage", "uint8", "s", "Batteriespannung"],
    [0x0021, "BatteryPercentageRemaining", "uint8", "s", "Batterie verbleibend"],
    [0x0030, "BatteryManufacturer", "string", "s"], [0x0031, "BatterySize", "enum8", "s", "Batteriegröße"],
    [0x0032, "BatteryAHrRating", "uint16", "s"], [0x0033, "BatteryQuantity", "uint8", "s", "Anzahl Batterien"],
    [0x0034, "BatteryRatedVoltage", "uint8", "s"], [0x0035, "BatteryAlarmMask", "map8", "s"],
    [0x0036, "BatteryVoltageMinThreshold", "uint8", "s"], [0x003e, "BatteryAlarmState", "map32", "s"]],
  0x0003: [[0x0000, "IdentifyTime", "uint16", "s", "Identifizierdauer"]],
  0x0004: [[0x0000, "NameSupport", "map8", "s", "Namen unterstützt"]],
  0x0005: [[0x0000, "SceneCount", "uint8", "s", "Anzahl Szenen"], [0x0001, "CurrentScene", "uint8", "s", "aktuelle Szene"],
    [0x0002, "CurrentGroup", "uint16", "s", "aktuelle Gruppe"], [0x0003, "SceneValid", "bool", "s", "Szene gültig"],
    [0x0004, "NameSupport", "map8", "s", "Namen unterstützt"], [0x0005, "LastConfiguredBy", "EUI64", "s"]],
  0x0006: [[0x0000, "OnOff", "bool", "s", "an / aus"], [0x4000, "GlobalSceneControl", "bool", "s"],
    [0x4001, "OnTime", "uint16", "s", "Einschaltdauer"], [0x4002, "OffWaitTime", "uint16", "s", "Ausschaltsperre"],
    [0x4003, "StartUpOnOff", "enum8", "s", "nach Stromausfall"]],
  0x0008: [[0x0000, "CurrentLevel", "uint8", "s", "aktuelle Stufe"], [0x0001, "RemainingTime", "uint16", "s", "Restzeit"],
    [0x0002, "MinLevel", "uint8", "s", "kleinste Stufe"], [0x0003, "MaxLevel", "uint8", "s", "größte Stufe"],
    [0x000f, "Options", "map8", "s"], [0x0010, "OnOffTransitionTime", "uint16", "s", "Übergangszeit"],
    [0x0011, "OnLevel", "uint8", "s", "Einschaltstufe"], [0x0012, "OnTransitionTime", "uint16", "s"],
    [0x0013, "OffTransitionTime", "uint16", "s"], [0x0014, "DefaultMoveRate", "uint8", "s"],
    [0x4000, "StartUpCurrentLevel", "uint8", "s", "nach Stromausfall"]],
  0x0019: [[0x0000, "UpgradeServerID", "EUI64", "c", "Update-Server"], [0x0001, "FileOffset", "uint32", "c"],
    [0x0002, "CurrentFileVersion", "uint32", "c", "aktuelle Firmware"], [0x0003, "CurrentZigBeeStackVersion", "uint16", "c"],
    [0x0004, "DownloadedFileVersion", "uint32", "c", "geladene Firmware"],
    [0x0005, "DownloadedZigBeeStackVersion", "uint16", "c"], [0x0006, "ImageUpgradeStatus", "enum8", "c", "Update-Status"],
    [0x0007, "ManufacturerID", "uint16", "c", "Herstellercode"], [0x0008, "ImageTypeID", "uint16", "c", "Image-Typ"],
    [0x0009, "MinimumBlockPeriod", "uint16", "c"], [0x000a, "ImageStamp", "uint32", "c"]],
  0x0020: [[0x0000, "Check-inInterval", "uint32", "s", "Meldeintervall"],
    [0x0001, "LongPollInterval", "uint32", "s", "langes Abfrageintervall"],
    [0x0002, "ShortPollInterval", "uint16", "s", "kurzes Abfrageintervall"],
    [0x0003, "FastPollTimeout", "uint16", "s", "Dauer schnelles Abfragen"], [0x0004, "Check-inIntervalMin", "uint32", "s"],
    [0x0005, "LongPollIntervalMin", "uint32", "s"], [0x0006, "FastPollTimeoutMax", "uint16", "s"]],
  0x0300: [[0x0000, "CurrentHue", "uint8", "s", "Farbton"], [0x0001, "CurrentSaturation", "uint8", "s", "Sättigung"],
    [0x0002, "RemainingTime", "uint16", "s", "Restzeit"], [0x0003, "CurrentX", "uint16", "s", "Farbort x"],
    [0x0004, "CurrentY", "uint16", "s", "Farbort y"], [0x0005, "DriftCompensation", "enum8", "s"],
    [0x0006, "CompensationText", "string", "s"], [0x0007, "ColorTemperatureMireds", "uint16", "s", "Farbtemperatur"],
    [0x0008, "ColorMode", "enum8", "s", "Farbmodus"], [0x000f, "Options", "map8", "s"],
    [0x0010, "NumberOfPrimaries", "uint8", "s"], [0x4000, "EnhancedCurrentHue", "uint16", "s"],
    [0x4001, "EnhancedColorMode", "enum8", "s"], [0x4002, "ColorLoopActive", "uint8", "s"],
    [0x4003, "ColorLoopDirection", "uint8", "s"], [0x4004, "ColorLoopTime", "uint16", "s"],
    [0x4005, "ColorLoopStartEnhancedHue", "uint16", "s"], [0x4006, "ColorLoopStoredEnhancedHue", "uint16", "s"],
    [0x400a, "ColorCapabilities", "map16", "s", "Farbfähigkeiten"],
    [0x400b, "ColorTempPhysicalMinMireds", "uint16", "s", "kälteste Farbtemperatur"],
    [0x400c, "ColorTempPhysicalMaxMireds", "uint16", "s", "wärmste Farbtemperatur"],
    [0x400d, "CoupleColorTempToLevelMinMireds", "uint16", "s"],
    [0x4010, "StartUpColorTemperatureMireds", "uint16", "s", "nach Stromausfall"]],
  0x0400: [[0x0000, "MeasuredValue", "uint16", "s", "Messwert"], [0x0001, "MinMeasuredValue", "uint16", "s"],
    [0x0002, "MaxMeasuredValue", "uint16", "s"], [0x0003, "Tolerance", "uint16", "s", "Toleranz"],
    [0x0004, "LightSensorType", "enum8", "s", "Sensortyp"]],
  0x0402: [[0x0000, "MeasuredValue", "int16", "s", "Messwert"], [0x0001, "MinMeasuredValue", "int16", "s"],
    [0x0002, "MaxMeasuredValue", "int16", "s"], [0x0003, "Tolerance", "uint16", "s", "Toleranz"]],
  0x0405: [[0x0000, "MeasuredValue", "uint16", "s", "Messwert"], [0x0001, "MinMeasuredValue", "uint16", "s"],
    [0x0002, "MaxMeasuredValue", "uint16", "s"], [0x0003, "Tolerance", "uint16", "s", "Toleranz"]],
  0x0406: [[0x0000, "Occupancy", "map8", "s", "belegt"], [0x0001, "OccupancySensorType", "enum8", "s", "Sensortyp"],
    [0x0002, "OccupancySensorTypeBitmap", "map8", "s"],
    [0x0010, "PIROccupiedToUnoccupiedDelay", "uint16", "s", "Nachlaufzeit"],
    [0x0011, "PIRUnoccupiedToOccupiedDelay", "uint16", "s"], [0x0012, "PIRUnoccupiedToOccupiedThreshold", "uint8", "s"]],
  0x0500: [[0x0000, "ZoneState", "enum8", "s", "Zonenzustand"], [0x0001, "ZoneType", "enum16", "s", "Zonentyp"],
    [0x0002, "ZoneStatus", "map16", "s", "Zonenstatus"], [0x0010, "IAS_CIE_Address", "EUI64", "s", "Adresse der Zentrale"],
    [0x0011, "ZoneID", "uint8", "s"], [0x0012, "NumberOfZoneSensitivityLevelsSupported", "uint8", "s"],
    [0x0013, "CurrentZoneSensitivityLevel", "uint8", "s", "Empfindlichkeit"]],
  0x0702: [[0x0000, "CurrentSummationDelivered", "uint48", "s", "Zählerstand Bezug"],
    [0x0001, "CurrentSummationReceived", "uint48", "s", "Zählerstand Einspeisung"], [0x0200, "Status", "map8", "s"],
    [0x0300, "UnitofMeasure", "enum8", "s", "Einheit"], [0x0301, "Multiplier", "uint24", "s", "Multiplikator"],
    [0x0302, "Divisor", "uint24", "s", "Divisor"], [0x0303, "SummationFormatting", "map8", "s"],
    [0x0306, "MeteringDeviceType", "map8", "s", "Zählerart"], [0x0400, "InstantaneousDemand", "int24", "s", "Momentanleistung"]],
  0x0b04: [[0x0000, "MeasurementType", "map32", "s", "Messart"], [0x0300, "ACFrequency", "uint16", "s", "Netzfrequenz"],
    [0x0505, "RMSVoltage", "uint16", "s", "Spannung"], [0x0508, "RMSCurrent", "uint16", "s", "Strom"],
    [0x050b, "ActivePower", "int16", "s", "Wirkleistung"], [0x050e, "ReactivePower", "int16", "s", "Blindleistung"],
    [0x050f, "ApparentPower", "uint16", "s", "Scheinleistung"], [0x0510, "PowerFactor", "int8", "s", "Leistungsfaktor"],
    [0x0600, "ACVoltageMultiplier", "uint16", "s"], [0x0601, "ACVoltageDivisor", "uint16", "s"],
    [0x0602, "ACCurrentMultiplier", "uint16", "s"], [0x0603, "ACCurrentDivisor", "uint16", "s"],
    [0x0604, "ACPowerMultiplier", "uint16", "s"], [0x0605, "ACPowerDivisor", "uint16", "s"]],
  0x0b05: [[0x0000, "NumberOfResets", "uint16", "s", "Neustarts"], [0x0001, "PersistentMemoryWrites", "uint16", "s"],
    [0x0100, "MacRxBcast", "uint32", "s"], [0x0101, "MacTxBcast", "uint32", "s"], [0x0102, "MacRxUcast", "uint32", "s"],
    [0x0103, "MacTxUcast", "uint32", "s"], [0x0104, "MacTxUcastRetry", "uint16", "s", "MAC-Wiederholungen"],
    [0x0105, "MacTxUcastFail", "uint16", "s", "MAC-Fehlschläge"], [0x0106, "APSRxBcast", "uint16", "s"],
    [0x0107, "APSTxBcast", "uint16", "s"], [0x0108, "APSRxUcast", "uint16", "s"],
    [0x0109, "APSTxUcastSuccess", "uint16", "s"], [0x010a, "APSTxUcastRetry", "uint16", "s"],
    [0x010b, "APSTxUcastFail", "uint16", "s", "APS-Fehlschläge"], [0x010c, "RouteDiscInitiated", "uint16", "s"],
    [0x010d, "NeighborAdded", "uint16", "s"], [0x010e, "NeighborRemoved", "uint16", "s"],
    [0x010f, "NeighborStale", "uint16", "s"], [0x0110, "JoinIndication", "uint16", "s"],
    [0x0111, "ChildMoved", "uint16", "s"], [0x0112, "NWKFCFailure", "uint16", "s"], [0x0113, "APSFCFailure", "uint16", "s"],
    [0x0114, "APSUnauthorizedKey", "uint16", "s"], [0x0115, "NWKDecryptFailures", "uint16", "s"],
    [0x0116, "APSDecryptFailures", "uint16", "s"], [0x0117, "PacketBufferAllocateFailures", "uint16", "s", "Pufferfehler"],
    [0x0118, "RelayedUcast", "uint16", "s", "weitergeleitete Unicasts"],
    [0x0119, "PhyToMACQueueLimitReached", "uint16", "s"], [0x011a, "PacketValidateDropCount", "uint16", "s"],
    [0x011b, "AverageMACRetryPerAPSMessageSent", "uint16", "s"],
    [0x011c, "LastMessageLQI", "uint8", "s", "LQI der letzten Nachricht"],
    [0x011d, "LastMessageRSSI", "int8", "s", "RSSI der letzten Nachricht"]],
  // Touchlink (ZLL commissioning) defines commands only, no attributes: an empty list is knowledge, not a gap.
  0x1000: [],
};

const pick = (pair, lang) => pair.split("|")[lang === "de" ? 1 : 0];

/** Whether a cluster id lies in the manufacturer-specific range (ZCL: 0xFC00-0xFFFF). */
export function isManufacturerSpecific(id) {
  return Number.isInteger(id) && id >= 0xfc00 && id <= 0xffff;
}

/** The name of a cluster in the language, or null when it is not in the list. */
export function clusterName(id, lang = "en") {
  return Object.hasOwn(CLUSTERS, id) ? pick(CLUSTERS[id][0], lang) : null;
}

/** One sentence on what a cluster does, or null. */
export function clusterAbout(id, lang = "en") {
  if (!Object.hasOwn(CLUSTERS, id)) return null;
  return lang === "de" ? CLUSTERS[id][2] : CLUSTERS[id][1];
}

export function profileName(id) {
  return Object.hasOwn(PROFILES, id) ? PROFILES[id] : null;
}

/** The name of a device type within its profile, or null. */
export function deviceTypeName(profile, id, lang = "en") {
  const list = Object.hasOwn(DEVICE_TYPES, profile) ? DEVICE_TYPES[profile] : null;
  return list && Object.hasOwn(list, id) ? pick(list[id], lang) : null;
}

/** Known attributes of a cluster: [{ id, name, type, side: "server" | "client", gloss: { de } | null }], or null when
 *  the cluster has no list here (the interface then says "no attribute list known"). */
export function clusterAttributes(id) {
  if (!Object.hasOwn(ATTRIBUTES, id)) return null;
  return ATTRIBUTES[id].map(([aid, name, type, side, de]) => ({ id: aid, name, type,
    side: side === "c" ? "client" : "server", gloss: de ? { de } : null }));
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
