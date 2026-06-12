# Pi

Python script that bridges MQTT commands from the web app to physical serial devices.

## Setup

```bash
pip install -r requirements.txt
python machine.py
```

## What it does

- Subscribes to `machine/cnc/command` and `machine/crane/command` on the MQTT broker
- Writes received commands to the appropriate serial port
- Reads serial output line-by-line and publishes it back as responses

## MQTT topics

| Topic | Direction | Purpose |
|---|---|---|
| `machine/cnc/command` | broker → pi | Gcode command to send to CNC |
| `machine/cnc/response` | pi → broker | CNC serial output |
| `machine/crane/command` | broker → pi | Motor command to send to crane Arduino |
| `machine/crane/response` | pi → broker | Crane Arduino serial output |

## Serial ports

| Device | Port | Baud |
|---|---|---|
| CNC (USB) | `/dev/ttyACM0` | 115200 |
| Crane Arduino (UART) | `/dev/ttyAMA0` | 115200 |

The script retries on open if a port isn't available at startup — safe to run before devices are connected.

## Dependencies

- `paho-mqtt` — MQTT client
- `pyserial` — serial port access
