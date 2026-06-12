# Pi

Python script that receives MQTT commands from the web app and controls the physical bin retrieval system.

## Setup

```bash
pip install -r requirements.txt
python machine.py
```

## Hardware

```
Pi (machine.py)
  ├── Serial (UART /dev/ttyAMA0) → carpark1 Arduino → car1 (retrieval mechanism)
  ├── Serial (USB  /dev/ttyACM0) → CNC XY system (GRBL) → positions car1
  └── GPIO22, GPIO23             → alignment sensors (travel with XY carriage)
```

- **CNC XY (GRBL)** moves car1 to the correct bin location
- **carpark1** controls car1's motors to physically retrieve or store a bin
- **GPIO23 / GPIO22** are two sensors mounted on the carriage, exactly 60mm apart, used to detect slot markers and confirm exact alignment

## Grid layout

- 4 rows × 8 columns × 3 slots deep = 96 total slots
- Slot 1 = back, slot 3 = front
- Origin (row 1, col 1) = top-left corner of the grid at X0, Y0
- Column spacing: 115mm (X axis)
- Row spacing: 150mm (Y axis)
- Coordinate formula: `X = OFFSET_X + (col - 1) * 115`, `Y = OFFSET_Y + (row - 1) * 150`
- `OFFSET_X` and `OFFSET_Y` are calibration constants tuned at runtime

## Alignment procedure

After the CNC moves to the approximate grid position, an alignment scan finds the exact slot location:

1. **Phase 1** — carriage moves right `SLOT_SPACING_X / 2` (57.5mm) at slow feed rate. Only GPIO23 is polled. When GPIO23 triggers, send `?` to GRBL to record position `pos23`.

2. **Phase 2** — carriage moves right another `SLOT_SPACING_X / 4` (28.75mm). Only GPIO22 is polled (GPIO22 is ignored during phase 1 to avoid false reads from obstacles in the way). When GPIO22 triggers, record position `pos22`.

3. **Average** — since both sensors detect the same slot marker and are 60mm apart, the true marker position is estimated as:
   ```
   confirmed_x = (pos23 + (pos22 - 60)) / 2
   ```
   Falls back to a single sensor reading if the other didn't trigger.

4. **Center** — carriage moves to `confirmed_x + ALIGN_CENTER_OFFSET` to sit centered on the slot. `ALIGN_CENTER_OFFSET` is currently 20mm — tune after calibration.

## MQTT topics

| Topic | Direction | Purpose |
|---|---|---|
| `bins/command` | broker → pi | Receive retrieve/store commands from the web app |
| `bins/update` | pi → broker | Publish bin status changes back to the web app |

See `web/MQTT_MESSAGES.md` for full payload spec and lifecycle examples.

## Command flow

**Retrieve:**
1. Look up bin location by barcode in `locations.json`
2. If bins are blocking (in front slots), pull them out first (front-to-back)
3. Move CNC to slot, run alignment procedure
4. Send carpark1 command to retrieve
5. Return any temporarily removed blockers to empty slots
6. Publish `bins/update` status updates throughout

**Store:**
1. Find the first empty slot in `locations.json`
2. Move CNC to slot, run alignment procedure
3. Send carpark1 command to store
4. Record bin location in `locations.json`
5. Publish `bins/update` status updates

## Dependencies

- `paho-mqtt` — MQTT client
- `pyserial` — serial port access (for CNC and carpark1)
- `RPi.GPIO` — GPIO access for alignment sensors
