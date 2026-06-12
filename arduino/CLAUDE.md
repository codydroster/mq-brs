# Arduino

This directory contains firmware for the physical bin-sorting vehicle.

## Files

- `car1.ino` — Reads two reflective photosensors (A6/A7) and drives two output pins based on a threshold. Used for position/line detection on the car.
- `crane1.ino` — Controls three TB6612-style motors (drive, lift 1, lift 2) via Serial or Serial2 commands. Accepts commands from USB serial (debug) or a Raspberry Pi on Serial2 (pins 7/8 at 115200 baud).

## Hardware targets

Both sketches target boards with 12-bit ADC resolution (e.g. Teensy or Arduino Due/Zero). Do not assume 10-bit ADC defaults.

## Serial command protocol (crane1)

Commands are single-character motor selectors followed by a command and optional speed value:

| Command | Action |
|---|---|
| `A/B/C + F<0-255>` | Forward at speed |
| `A/B/C + R<0-255>` | Reverse at speed |
| `A/B/C + B` | Brake |
| `A/B/C + S` | Stop (coast, no ramp) |
| `A/B/C + C<ms>` | Ramp coast to stop (step delay in ms) |
| `X` | Toggle RPR sensor stream |
| `?` | Print help |

Motors: A = drive, B = lift 1, C = lift 2. B and C share STBY pin 3.

## Conventions

- All pin assignments are defined as named constants or `#define`s at the top of each file — never use bare numbers in logic.
- `Serial` is for USB/debug. `Serial2` is the Pi UART link (crane1 only).
- Do not add blocking `delay()` calls to `crane1.ino` outside of `motorCoast()` — the loop must stay responsive to incoming commands.
