import json
import re
import sys
import serial
import threading
import time
import paho.mqtt.client as mqtt
import RPi.GPIO as GPIO
import locations
from locations import find_bin_at

MQTT_BROKER   = "192.168.1.130"
MQTT_PORT     = 1883
MQTT_USERNAME = "cdroster"
MQTT_PASSWORD = "kka-zutGap"

SLOTS = 3

# CNC grid geometry (mm)
SLOT_SPACING_X = 115
SLOT_SPACING_Y = 150
OFFSET_X       = 0    # tune after calibration
OFFSET_Y       = 0    # tune after calibration
FEED_RATE      = 3000 # mm/min

# Alignment
SENSOR_SPACING  = 60                   # physical distance between GPIO23 and GPIO22 on the carriage (mm)
ALIGN_SCAN_1    = SLOT_SPACING_X / 2   # phase 1 scan distance (mm)
ALIGN_SCAN_2    = SLOT_SPACING_X / 4   # phase 2 scan distance (mm)
ALIGN_FEED      = 500                  # feed rate for alignment scan (mm/min)
ALIGN_CENTER_OFFSET = 20               # final offset to center carriage on slot (mm) — tune after calibration

# GPIO pins (BCM numbering)
GPIO_SENSOR_1 = 23
GPIO_SENSOR_2 = 22

COMMAND_TOPIC = "bins/command"
UPDATE_TOPIC  = "bins/update"

# Serial ports
CNC_PORT     = "/dev/ttyACM0"   # XY CNC GRBL (USB)
CARPARK_PORT = "/dev/ttyAMA0"   # carpark1 Arduino (UART)
BAUD_RATE    = 115200

cnc_serial     = None
carpark_serial = None


# --- GPIO setup ---

def setup_gpio():
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(GPIO_SENSOR_1, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
    GPIO.setup(GPIO_SENSOR_2, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)


# --- GRBL serial ---

def open_serial_ports():
    global cnc_serial, carpark_serial
    cnc_serial     = serial.Serial(CNC_PORT,     BAUD_RATE, timeout=2)
    carpark_serial = serial.Serial(CARPARK_PORT, BAUD_RATE, timeout=2)
    time.sleep(2)  # wait for GRBL to boot
    cnc_serial.flushInput()
    print(f"Serial ports opened: {CNC_PORT}, {CARPARK_PORT}")


def grbl_send(cmd):
    cnc_serial.write((cmd.strip() + "\n").encode())
    cnc_serial.flush()


def grbl_send_wait(cmd):
    """Send a gcode command and wait for GRBL to acknowledge with 'ok'."""
    grbl_send(cmd)
    while True:
        line = cnc_serial.readline().decode("utf-8", errors="replace").strip()
        if line == "ok":
            return
        if line.startswith("error"):
            print(f"GRBL error: {line}")
            return


def grbl_get_position():
    """Send '?' and parse the current X,Y position from GRBL status report."""
    grbl_send("?")
    deadline = time.time() + 2
    while time.time() < deadline:
        line = cnc_serial.readline().decode("utf-8", errors="replace").strip()
        # GRBL status: <Idle|MPos:0.000,0.000,0.000|...>
        match = re.search(r'MPos:([-\d.]+),([-\d.]+)', line)
        if match:
            x = float(match.group(1))
            y = float(match.group(2))
            return x, y
    return None


# --- CNC movement ---

def grid_to_xy(row, col):
    x = OFFSET_X + (col - 1) * SLOT_SPACING_X
    y = OFFSET_Y + (row - 1) * SLOT_SPACING_Y
    return x, y


def move_to(row, col):
    """Move CNC to grid position and run alignment scan. Returns confirmed X position or None."""
    x, y = grid_to_xy(row, col)
    print(f"Moving to row={row} col={col} → X{x} Y{y}")
    grbl_send_wait(f"G1 X{x} Y{y} F{FEED_RATE}")
    return align(x)


def align(start_x):
    """
    Two-phase scan:
    Phase 1 — move right ALIGN_SCAN, poll only GPIO23.
    Phase 2 — move right ALIGN_SCAN again, poll only GPIO22 (avoids false reads from obstacles).
    Returns (pos23, pos22) — either may be None if sensor didn't trigger.
    """
    pos23 = None
    pos22 = None

    # Phase 1: move SLOT_SPACING_X/2, poll GPIO23 only
    grbl_send(f"G1 X{start_x + ALIGN_SCAN_1} F{ALIGN_FEED}")
    deadline = time.time() + 15
    while time.time() < deadline:
        if GPIO.input(GPIO_SENSOR_1) == GPIO.HIGH:
            pos = grbl_get_position()
            if pos:
                pos23 = pos[0]
                print(f"GPIO23 triggered at X{pos23:.3f}")
            break
        time.sleep(0.005)
    grbl_send_wait("")

    if pos23 is None:
        print("Alignment warning: GPIO23 did not trigger")

    # Phase 2: move SLOT_SPACING_X/4, poll GPIO22 only (safe from obstacles now)
    grbl_send(f"G1 X{start_x + ALIGN_SCAN_1 + ALIGN_SCAN_2} F{ALIGN_FEED}")
    deadline = time.time() + 15
    while time.time() < deadline:
        if GPIO.input(GPIO_SENSOR_2) == GPIO.HIGH:
            pos = grbl_get_position()
            if pos:
                pos22 = pos[0]
                print(f"GPIO22 triggered at X{pos22:.3f}")
            break
        time.sleep(0.005)
    grbl_send_wait("")

    if pos22 is None:
        print("Alignment warning: GPIO22 did not trigger")

    confirmed_x = None
    if pos23 is not None and pos22 is not None:
        gap = abs(pos22 - pos23)
        print(f"Sensor gap: {gap:.3f}mm (expected {SENSOR_SPACING}mm)")
        confirmed_x = (pos23 + (pos22 - SENSOR_SPACING)) / 2
        print(f"Confirmed slot X: {confirmed_x:.3f}mm")
    elif pos23 is not None:
        confirmed_x = pos23
    elif pos22 is not None:
        confirmed_x = pos22 - SENSOR_SPACING

    if confirmed_x is not None:
        center_x = confirmed_x + ALIGN_CENTER_OFFSET
        print(f"Centering carriage at X{center_x:.3f}")
        grbl_send_wait(f"G1 X{center_x:.3f} F{ALIGN_FEED}")

    return confirmed_x


# --- MQTT ---

def on_connect(client, userdata, flags, rc):
    print(f"Connected to MQTT broker (rc={rc})")
    client.subscribe(COMMAND_TOPIC)
    print(f"Subscribed to {COMMAND_TOPIC}")


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except json.JSONDecodeError:
        print(f"Invalid JSON: {msg.payload}")
        return

    barcode  = payload.get("barcode")
    cmd_type = payload.get("type")
    print(f"Command received — type: {cmd_type}, barcode: {barcode}")

    if cmd_type == "retrieve":
        handle_retrieve(barcode, client)
    elif cmd_type == "store":
        handle_store(barcode, client)
    else:
        print(f"Unknown command type: {cmd_type}")


# --- Command handlers ---

def handle_retrieve(barcode, client):
    location = locations.find_bin(barcode)
    if location is None:
        print(f"Retrieve failed — barcode {barcode} not found in grid")
        return
    row, col, slot = location
    print(f"Retrieving bin {barcode} from row={row} col={col} slot={slot}")

    # Slots are back-to-front: slot 1 = back, slot 3 = front
    # To reach slot N, any bins in front (slots N+1 to 3) must be temporarily removed first
    blocking = []
    for s in range(slot + 1, SLOTS + 1):
        blocker = find_bin_at(row, col, s)
        if blocker:
            blocking.append((s, blocker))

    # Pull blocking bins out front-to-back (slot 3 first)
    for s, blocker_barcode in reversed(blocking):
        print(f"  Moving blocker {blocker_barcode} (slot {s}) out temporarily")
        move_to(row, col)
        publish_update(client, blocker_barcode, "out-pending")
        # TODO: send carpark1 command to retrieve slot s

    # Retrieve the target bin
    move_to(row, col)
    publish_update(client, barcode, "out-pending")
    # TODO: send carpark1 command to retrieve slot

    # Return blockers to empty slots (back-to-front so slot 3 goes in last)
    for s, blocker_barcode in blocking:
        empty = locations.find_empty_slot()
        if empty:
            print(f"  Returning blocker {blocker_barcode} to {empty}")
            move_to(*empty[:2])
            # TODO: send carpark1 command to store
            locations.place_bin(blocker_barcode, *empty)
            publish_update(client, blocker_barcode, "in")


def handle_store(barcode, client):
    location = locations.find_empty_slot()
    if location is None:
        print(f"Store failed — no empty slots available")
        return
    row, col, slot = location
    print(f"Storing bin {barcode} at row={row} col={col} slot={slot}")
    move_to(row, col)
    # TODO: send carpark1 command to store into slot
    # TODO: call locations.place_bin(barcode, row, col, slot) after confirmed


def publish_update(client, barcode, status):
    payload = json.dumps({"barcode": barcode, "status": status})
    client.publish(UPDATE_TOPIC, payload)
    print(f"Published update — barcode: {barcode}, status: {status}")


# --- Debug shell ---

def debug_shell():
    print("Debug mode — type 'help' for commands")
    while True:
        try:
            line = input("debug> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not line:
            continue

        parts = line.split()
        cmd   = parts[0].lower()

        if cmd == "help":
            print("  move <row> <col>                  — move CNC to grid position and align")
            print("  align                             — run alignment at current position")
            print("  gcode <command>                   — send raw gcode to GRBL")
            print("  grid                              — print the full bin grid")
            print("  find <barcode>                    — find a bin's location")
            print("  place <barcode> <row> <col> <slot>— manually place a bin in the grid")
            print("  remove <barcode>                  — remove a bin from the grid")
            print("  retrieve <barcode>                — simulate a retrieve command")
            print("  store <barcode>                   — simulate a store command")
            print("  exit                              — quit")

        elif cmd == "move" and len(parts) == 3:
            row, col = int(parts[1]), int(parts[2])
            confirmed_x = move_to(row, col)
            print(f"Aligned at X={confirmed_x}")

        elif cmd == "align":
            x, _ = grbl_get_position() or (0, 0)
            confirmed_x = align(x)
            print(f"Aligned at X={confirmed_x}")

        elif cmd == "gcode" and len(parts) >= 2:
            gcode = " ".join(parts[1:])
            print(f"Sending: {gcode}")
            grbl_send_wait(gcode)

        elif cmd == "grid":
            locations.print_grid()

        elif cmd == "find" and len(parts) == 2:
            loc = locations.find_bin(parts[1])
            print(f"{parts[1]} → {loc}" if loc else f"{parts[1]} not found")

        elif cmd == "place" and len(parts) == 5:
            barcode, row, col, slot = parts[1], int(parts[2]), int(parts[3]), int(parts[4])
            try:
                locations.place_bin(barcode, row, col, slot)
                print(f"Placed {barcode} at ({row},{col},{slot})")
            except ValueError as e:
                print(f"Error: {e}")

        elif cmd == "remove" and len(parts) == 2:
            loc = locations.remove_bin(parts[1])
            print(f"Removed {parts[1]} from {loc}" if loc else f"{parts[1]} not found")

        elif cmd == "retrieve" and len(parts) == 2:
            handle_retrieve(parts[1], None)

        elif cmd == "store" and len(parts) == 2:
            handle_store(parts[1], None)

        elif cmd == "exit":
            break

        else:
            print(f"Unknown command: {line} — type 'help'")


# --- Main ---

def main():
    setup_gpio()
    locations.load_or_init()
    open_serial_ports()
    print("Grid loaded.")

    if "--debug" in sys.argv:
        try:
            debug_shell()
        finally:
            GPIO.cleanup()
        return

    client = mqtt.Client()
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.on_connect = on_connect
    client.on_message = on_message

    print(f"Connecting to {MQTT_BROKER}:{MQTT_PORT}...")
    client.connect(MQTT_BROKER, MQTT_PORT)

    try:
        client.loop_forever()
    finally:
        GPIO.cleanup()


if __name__ == "__main__":
    main()
