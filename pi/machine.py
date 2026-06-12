import serial
import paho.mqtt.client as mqtt
import threading
import time

MQTT_BROKER = "192.168.1.118"
MQTT_PORT   = 1883

CNC_PORT   = "/dev/ttyACM0"
CRANE_PORT = "/dev/ttyAMA0"
BAUD_RATE  = 115200

CNC_COMMAND_TOPIC   = "machine/cnc/command"
CNC_RESPONSE_TOPIC  = "machine/cnc/response"
CRANE_COMMAND_TOPIC = "machine/crane/command"
CRANE_RESPONSE_TOPIC = "machine/crane/response"


def open_serial(port, baud):
    while True:
        try:
            s = serial.Serial(port, baud, timeout=1)
            print(f"Opened {port} at {baud} baud")
            return s
        except serial.SerialException as e:
            print(f"Waiting for {port}: {e}")
            time.sleep(2)


def read_loop(ser, topic, client):
    """Continuously read lines from a serial port and publish them."""
    while True:
        try:
            line = ser.readline().decode("utf-8", errors="replace").strip()
            if line:
                print(f"[{topic}] << {line}")
                client.publish(topic, line)
        except serial.SerialException as e:
            print(f"Serial read error on {ser.port}: {e}")
            time.sleep(1)


def send_command(ser, command):
    ser.write((command + "\n").encode("utf-8"))
    ser.flush()


cnc_ser   = None
crane_ser = None


def on_connect(client, userdata, flags, rc):
    print(f"MQTT connected (rc={rc})")
    client.subscribe(CNC_COMMAND_TOPIC)
    client.subscribe(CRANE_COMMAND_TOPIC)


def on_message(client, userdata, msg):
    payload = msg.payload.decode("utf-8", errors="replace").strip()
    topic   = msg.topic

    print(f"[{topic}] >> {payload}")

    if topic == CNC_COMMAND_TOPIC:
        if cnc_ser and cnc_ser.is_open:
            send_command(cnc_ser, payload)
        else:
            client.publish(CNC_RESPONSE_TOPIC, "ERROR: CNC serial port not available")

    elif topic == CRANE_COMMAND_TOPIC:
        if crane_ser and crane_ser.is_open:
            send_command(crane_ser, payload)
        else:
            client.publish(CRANE_RESPONSE_TOPIC, "ERROR: Crane serial port not available")


def main():
    global cnc_ser, crane_ser

    cnc_ser   = open_serial(CNC_PORT,   BAUD_RATE)
    crane_ser = open_serial(CRANE_PORT, BAUD_RATE)

    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, MQTT_PORT)

    threading.Thread(target=read_loop, args=(cnc_ser,   CNC_RESPONSE_TOPIC,   client), daemon=True).start()
    threading.Thread(target=read_loop, args=(crane_ser, CRANE_RESPONSE_TOPIC, client), daemon=True).start()

    print("Running — listening for MQTT commands and serial responses")
    client.loop_forever()


if __name__ == "__main__":
    main()
