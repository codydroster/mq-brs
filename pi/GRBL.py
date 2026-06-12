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

import os

PASSWORD_FILE = os.path.join(os.path.dirname(__file__), "password.json")
try:
    with open(PASSWORD_FILE) as f:
        _credentials = json.load(f)
except FileNotFoundError:
    raise SystemExit(f"Missing {PASSWORD_FILE} - copy password.example.json and fill in credentials")

MQTT_BROKER   = _credentials["broker"]
MQTT_PORT     = _credentials.get("port", 1883)
MQTT_USERNAME = _credentials["username"]
MQTT_PASSWORD = _credentials["password"]

SLOTS = 3

# CNC grid geometry (mm)
SLOT_SPACING_X = 115
SLOT_SPACING_Y = 150
OFFSET_X       = 168  # X of first slot (row 1, col 1)
OFFSET_Y       = 47   # Y of first slot (row 1, col 1)
FEED_RATE      = 3000 # mm/min

# Alignment
SENSOR_SPACING  = 60                   # physical distance between sensor 1 and sensor 2 on the carriage (mm)
SLOT_WIDTH      = 80                   # physical slot width (mm)
ALIGN_SCAN_1    = 60                   # phase 1 scan distance (mm)
ALIGN_SCAN_2    = 30                   # phase 2 scan distance (mm)
ALIGN_FEED      = 500                  # feed rate for alignment scan (mm/min)
ALIGN_CENTER_OFFSET_X = 72               # final X offset from sensor-1 trigger point to slot center (mm)

ALIGN_SCAN_Y          = 20  # Y scan distance (mm)
ALIGN_CENTER_OFFSET_Y = 8                  # final Y offset after sensors trigger (mm) - tune after calibration

# Alignment start point - grid positions are the (almost) centered position, so
# the scan must start slightly X-negative and Y-negative of it
ALIGN_START_OFFSET_X = 80                  # mm X-negative of grid position (marker sits ~70mm before grid center - stay clear of it)
ALIGN_START_OFFSET_Y = 20                   # mm Y-negative (above) grid position

# GPIO pins (BCM numbering)
GPIO_SENSOR_1 = 22
GPIO_SENSOR_2 = 23

COMMAND_TOPIC = "bins/command"
UPDATE_TOPIC  = "bins/update"

# /dev page debug topics
DEV_CNC_CMD  = "machine/cnc/command"
DEV_CNC_RESP = "machine/cnc/response"

# Serial ports
CNC_PORT     = "/dev/ttyACM0"   # XY CNC GRBL (USB)
CARPARK_PORT = "/dev/serial0"   # carpark1 sensor board (UART, GPIO 14/15) - baseline calibration
BAUD_RATE    = 115200           # CNC (GRBL standard)
CARPARK_BAUD = 9600             # carpark1 UART link

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
    cnc_serial = serial.Serial(CNC_PORT, BAUD_RATE, timeout=2)
    time.sleep(2)  # wait for GRBL to boot
    cnc_serial.flushInput()
    print(f"Serial port opened: {CNC_PORT}")
    try:
        carpark_serial = serial.Serial(CARPARK_PORT, CARPARK_BAUD, timeout=3)
        carpark_serial.flushInput()
        print(f"Serial port opened: {CARPARK_PORT}")
    except serial.SerialException as e:
        carpark_serial = None
        print(f"Warning: carpark1 UART not available ({e}) - baseline calibration disabled")


def calibrate_sensor_baseline(sensor=None):
    """Tell carpark1 to re-sample its ambient baseline. Takes ~1-2s on the board.
    sensor=None calibrates both, sensor=1 or 2 calibrates that sensor only.
    Returns True if the board acknowledged."""
    if carpark_serial is None:
        print("Baseline calibration skipped - carpark1 UART not open")
        return False
    cmd = {None: b"B\n", 1: b"1\n", 2: b"2\n"}[sensor]
    carpark_serial.flushInput()
    carpark_serial.write(cmd)
    carpark_serial.flush()
    deadline = time.time() + 5
    while time.time() < deadline:
        line = carpark_serial.readline().decode("utf-8", errors="replace").strip()
        if line.startswith("BASELINE"):
            print(f"carpark1: {line}")
            return True
    print("Baseline calibration warning: no response from carpark1")
    return False


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


def grbl_status():
    """Send '?' and parse GRBL's status report. Returns (state, x, y) or None.
    Accepts MPos or WPos depending on GRBL's $10 setting - alignment math only
    uses relative differences, so either frame works."""
    grbl_send("?")
    deadline = time.time() + 2
    while time.time() < deadline:
        line = cnc_serial.readline().decode("utf-8", errors="replace").strip()
        # GRBL status: <Idle|MPos:0.000,0.000,0.000|...> or <Idle|WPos:...>
        match = re.search(r'<(\w+)[|,].*?[MW]Pos:([-\d.]+),([-\d.]+)', line)
        if match:
            return match.group(1), float(match.group(2)), float(match.group(3))
    return None


def grbl_get_position():
    """Return current (x, y) or None."""
    status = grbl_status()
    return (status[1], status[2]) if status else None


def grbl_wait_idle(timeout=30):
    """Poll status until GRBL reports Idle (all queued motion finished).
    A buffered move takes a moment to start, during which GRBL still reports
    Idle - so delay briefly and require two consecutive Idle reads."""
    time.sleep(0.2)  # let buffered motion actually start
    idle_count = 0
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = grbl_status()
        if status and status[0] == "Idle":
            idle_count += 1
            if idle_count >= 2:
                return True
        else:
            idle_count = 0
        time.sleep(0.05)
    print("GRBL warning: timed out waiting for Idle")
    return False


# --- CNC movement ---

def grid_to_xy(row, col):
    x = OFFSET_X + (col - 1) * SLOT_SPACING_X
    y = OFFSET_Y + (row - 1) * SLOT_SPACING_Y
    return x, y


def move_to(row, col):
    """Move CNC to the alignment start point (slightly X/Y negative of the grid
    position), then align X then Y. Returns (confirmed_x, confirmed_y)."""
    x, y = grid_to_xy(row, col)
    start_x = x - ALIGN_START_OFFSET_X
    start_y = y - ALIGN_START_OFFSET_Y
    print(f"Moving to row={row} col={col} -> scan start X{start_x} Y{start_y} (grid X{x} Y{y})")
    grbl_send_wait("G90")
    grbl_send_wait(f"G1 X{start_x} Y{start_y} F{FEED_RATE}")
    grbl_wait_idle()
    confirmed_x = align_x()
    confirmed_y = align_y()
    return confirmed_x, confirmed_y


def align_x():
    """
    Two-phase X scan using relative (G91) moves so the work/machine coordinate
    frames don't matter:
    Phase 1 - move right ALIGN_SCAN_1, poll only sensor 1.
    Phase 2 - move right ALIGN_SCAN_2, poll only sensor 2 (avoids false reads from obstacles).
    Averages the two readings (MPos frame), centers the carriage, and returns confirmed X (or None).
    """
    pos23 = None
    pos22 = None

    calibrate_sensor_baseline()  # both sensor baselines for the X scan

    grbl_send_wait("G91")

    # Phase 1: move SLOT_WIDTH/2 relative, poll sensor 1 only
    grbl_send(f"G1 X{ALIGN_SCAN_1} F{ALIGN_FEED}")
    deadline = time.time() + 15
    while time.time() < deadline:
        if GPIO.input(GPIO_SENSOR_1) == GPIO.HIGH:
            pos = grbl_get_position()
            if pos:
                pos23 = pos[0]
                print(f"Sensor 1 triggered at X{pos23:.3f}")
            break
    grbl_wait_idle()

    if pos23 is None:
        print("Alignment warning: sensor 1 did not trigger")

    # Re-zero sensor 2 against ambient at this position before trusting it
    calibrate_sensor_baseline(2)

    # Phase 2: poll sensor 2 only (safe from obstacles now). Sensor 2 trails
    # sensor 1 by SENSOR_SPACING, so it reaches the marker when the carriage is
    # SENSOR_SPACING past sensor 1's trigger point - compute the remaining
    # distance from there, with margin.
    if pos23 is not None:
        current = grbl_get_position()
        phase2_dist = (pos23 + SENSOR_SPACING) - current[0] + 10 if current else ALIGN_SCAN_2
    else:
        phase2_dist = ALIGN_SCAN_2
    print(f"Phase 2 scan distance: {phase2_dist:.1f}mm")
    grbl_send(f"G1 X{phase2_dist:.3f} F{ALIGN_FEED}")
    deadline = time.time() + 15
    while time.time() < deadline:
        if GPIO.input(GPIO_SENSOR_2) == GPIO.HIGH:
            pos = grbl_get_position()
            if pos:
                pos22 = pos[0]
                print(f"Sensor 2 triggered at X{pos22:.3f}")
            break
    grbl_wait_idle()

    if pos22 is None:
        print("Alignment warning: sensor 2 did not trigger")

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
        # Center by moving the remaining relative distance (both values are MPos frame)
        current = grbl_get_position()
        if current:
            delta = (confirmed_x + ALIGN_CENTER_OFFSET_X) - current[0]
            # Sanity check: the marker can only be behind us by less than the scan distance
            max_back = ALIGN_SCAN_1 + ALIGN_SCAN_2
            if delta > ALIGN_CENTER_OFFSET_X + 5 or delta < -max_back:
                print(f"Alignment ABORTED: centering delta X{delta:+.3f} out of range - not moving")
                grbl_send_wait("G90")
                return None
            print(f"Centering carriage: moving X{delta:+.3f}")
            grbl_send_wait(f"G1 X{delta:.3f} F{ALIGN_FEED}")
            grbl_wait_idle()

    grbl_send_wait("G90")  # restore absolute mode
    return confirmed_x


def align_y():
    """
    Y alignment - run after X is aligned. Travel Y positive (relative move) while
    polling both sensors; they sit on the same plane so they trigger at (nearly)
    the same time. Average the two trigger positions, then travel positive
    ALIGN_CENTER_OFFSET_Y. Returns confirmed Y or None if neither sensor triggered.
    """
    y23 = None
    y22 = None

    calibrate_sensor_baseline()  # re-zero sensors for current ambient light

    grbl_send_wait("G91")
    grbl_send(f"G1 Y{ALIGN_SCAN_Y} F{ALIGN_FEED}")
    deadline = time.time() + 15
    while time.time() < deadline:
        if y23 is None and GPIO.input(GPIO_SENSOR_1) == GPIO.HIGH:
            pos = grbl_get_position()
            if pos:
                y23 = pos[1]
                print(f"Sensor 1 triggered at Y{y23:.3f}")
        if y22 is None and GPIO.input(GPIO_SENSOR_2) == GPIO.HIGH:
            pos = grbl_get_position()
            if pos:
                y22 = pos[1]
                print(f"Sensor 2 triggered at Y{y22:.3f}")
        if y23 is not None and y22 is not None:
            break
    grbl_wait_idle()

    if y23 is None and y22 is None:
        print("Alignment warning: neither sensor triggered during Y scan")
        grbl_send_wait("G90")
        return None
    if y23 is None or y22 is None:
        print("Alignment warning: only one sensor triggered during Y scan")

    triggered = [y for y in (y23, y22) if y is not None]
    confirmed_y = sum(triggered) / len(triggered)
    print(f"Confirmed slot Y: {confirmed_y:.3f}mm")

    # Center by moving the remaining relative distance (both values are MPos frame)
    current = grbl_get_position()
    if current:
        delta = (confirmed_y + ALIGN_CENTER_OFFSET_Y) - current[1]
        if delta > ALIGN_CENTER_OFFSET_Y + 5 or delta < -ALIGN_SCAN_Y:
            print(f"Alignment ABORTED: centering delta Y{delta:+.3f} out of range - not moving")
            grbl_send_wait("G90")
            return None
        print(f"Centering carriage: moving Y{delta:+.3f}")
        grbl_send_wait(f"G1 Y{delta:.3f} F{ALIGN_FEED}")
        grbl_wait_idle()

    grbl_send_wait("G90")  # restore absolute mode
    return confirmed_y


# --- MQTT ---

def on_connect(client, userdata, flags, rc):
    print(f"Connected to MQTT broker (rc={rc})")
    for topic in (COMMAND_TOPIC, DEV_CNC_CMD):
        client.subscribe(topic)
        print(f"Subscribed to {topic}")


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except json.JSONDecodeError:
        print(f"Invalid JSON: {msg.payload}")
        return

    if msg.topic == DEV_CNC_CMD:
        handle_dev_cnc(payload.get("command", ""), client)
        return
    barcode  = payload.get("barcode")
    cmd_type = payload.get("type")
    print(f"Command received - type: {cmd_type}, barcode: {barcode}")

    if cmd_type == "retrieve":
        handle_retrieve(barcode, client)
    elif cmd_type == "store":
        handle_store(barcode, client)
    else:
        print(f"Unknown command type: {cmd_type}")


def handle_dev_cnc(command, client):
    """Forward a raw gcode line from the /dev page to GRBL and return its responses."""
    if not command:
        return
    print(f"[dev] gcode: {command}")
    grbl_send(command)
    deadline = time.time() + 5
    while time.time() < deadline:
        line = cnc_serial.readline().decode("utf-8", errors="replace").strip()
        if not line:
            continue
        client.publish(DEV_CNC_RESP, json.dumps({"response": line}))
        if line == "ok" or line.startswith("error"):
            break


# --- Command handlers ---

def handle_retrieve(barcode, client):
    location = locations.find_bin(barcode)
    if location is None:
        print(f"Retrieve failed - barcode {barcode} not found in grid")
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

    # Pull blocking bins out front-to-back (slot 3 first), clearing them from the
    # grid as they come out so find_empty_slot sees their slots as free
    for s, blocker_barcode in reversed(blocking):
        print(f"  Moving blocker {blocker_barcode} (slot {s}) out temporarily")
        move_to(row, col)
        # TODO: send carpark1 command to retrieve slot s
        locations.remove_bin(blocker_barcode)
        publish_update(client, blocker_barcode, "out-pending")

    # Retrieve the target bin and clear it from the grid
    move_to(row, col)
    publish_update(client, barcode, "out-pending")
    # TODO: send carpark1 command to retrieve slot
    locations.remove_bin(barcode)
    # TODO: publish "out" once carpark1 confirms delivery to the pickup point
    publish_update(client, barcode, "out")

    # Return blockers to insertable slots (back-to-front so slot 3 goes in last)
    for s, blocker_barcode in blocking:
        empty = locations.find_empty_slot()
        if empty is None:
            print(f"  ERROR: no slot available to return blocker {blocker_barcode}")
            continue
        print(f"  Returning blocker {blocker_barcode} to {empty}")
        move_to(*empty[:2])
        # TODO: send carpark1 command to store
        locations.place_bin(blocker_barcode, *empty)
        publish_update(client, blocker_barcode, "in")


def handle_store(barcode, client):
    location = locations.find_empty_slot()
    if location is None:
        print(f"Store failed - no empty slots available")
        return
    row, col, slot = location
    print(f"Storing bin {barcode} at row={row} col={col} slot={slot}")
    publish_update(client, barcode, "in-pending")
    move_to(row, col)
    # TODO: send carpark1 command to store into slot, and only record/publish below
    # once it confirms - for now we assume the store succeeded
    locations.place_bin(barcode, row, col, slot)
    publish_update(client, barcode, "in")


def publish_update(client, barcode, status):
    print(f"Update - barcode: {barcode}, status: {status}")
    if client is None:  # debug shell runs without MQTT
        return
    payload = json.dumps({"barcode": barcode, "status": status})
    client.publish(UPDATE_TOPIC, payload)


# --- Debug shell ---

def debug_shell():
    print("Debug mode - type 'help' for commands")
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
            print("  move <row> <col>                  - move CNC to grid position and align X+Y")
            print("  goto <row> <col>                  - move CNC to rough grid position (no alignment)")
            print("  alignx                            - run X alignment at current position")
            print("  sensors                           - print live sensor 1/2 states (ctrl-c to stop)")
            print("  setbaseline                       - recalibrate carpark1 sensor baselines")
            print("  stop                              - feed hold + flush queued motion (emergency stop)")
            print("  aligny                            - run Y alignment at current position")
            print("  gcode <command>                   - send raw gcode to GRBL")
            print("  grid                              - print the full bin grid")
            print("  find <barcode>                    - find a bin's location")
            print("  place <barcode> <row> <col> <slot>- manually place a bin in the grid")
            print("  remove <barcode>                  - remove a bin from the grid")
            print("  retrieve <barcode>                - simulate a retrieve command")
            print("  store <barcode>                   - simulate a store command")
            print("  exit                              - quit")

        elif cmd == "move" and len(parts) == 3:
            row, col = int(parts[1]), int(parts[2])
            confirmed_x, confirmed_y = move_to(row, col)
            print(f"Aligned at X={confirmed_x} Y={confirmed_y}")

        elif cmd == "goto" and len(parts) == 3:
            row, col = int(parts[1]), int(parts[2])
            x, y = grid_to_xy(row, col)
            print(f"Moving to row={row} col={col} -> X{x} Y{y}")
            grbl_send_wait(f"G90")
            grbl_send_wait(f"G1 X{x} Y{y} F{FEED_RATE}")
            grbl_wait_idle()
            print("Done")

        elif cmd == "stop":
            cnc_serial.write(b"!")        # realtime feed hold - decelerates immediately
            cnc_serial.flush()
            time.sleep(0.5)
            cnc_serial.write(b"\x18")     # soft reset - clears all queued motion
            cnc_serial.flush()
            time.sleep(0.5)
            cnc_serial.flushInput()
            grbl_send_wait("G90")          # reset may leave modal state unknown - restore absolute
            status = grbl_status()
            print(f"Stopped. GRBL state: {status[0] if status else 'unknown'}")

        elif cmd == "setbaseline":
            calibrate_sensor_baseline()

        elif cmd == "sensors":
            print("Watching sensors (ctrl-c to stop)...")
            try:
                while True:
                    s1 = GPIO.input(GPIO_SENSOR_1)
                    s2 = GPIO.input(GPIO_SENSOR_2)
                    print(f"\rS1/GPIO{GPIO_SENSOR_1}: {'HIGH' if s1 else 'low '}   S2/GPIO{GPIO_SENSOR_2}: {'HIGH' if s2 else 'low '}", end="", flush=True)
                    time.sleep(0.1)
            except KeyboardInterrupt:
                print()

        elif cmd == "alignx":
            confirmed_x = align_x()
            print(f"Aligned at X={confirmed_x}")

        elif cmd == "aligny":
            confirmed_y = align_y()
            print(f"Aligned at Y={confirmed_y}")

        elif cmd == "gcode" and len(parts) >= 2:
            gcode = " ".join(parts[1:])
            print(f"Sending: {gcode}")
            grbl_send(gcode)
            # Echo every response line; '?' returns a status report with no 'ok',
            # so also stop on the first status line
            deadline = time.time() + 5
            while time.time() < deadline:
                resp = cnc_serial.readline().decode("utf-8", errors="replace").strip()
                if not resp:
                    continue
                print(f"  {resp}")
                if resp == "ok" or resp.startswith("error") or resp.startswith("<"):
                    break

        elif cmd == "grid":
            locations.print_grid()

        elif cmd == "find" and len(parts) == 2:
            loc = locations.find_bin(parts[1])
            print(f"{parts[1]} -> {loc}" if loc else f"{parts[1]} not found")

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
            print(f"Unknown command: {line} - type 'help'")


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
