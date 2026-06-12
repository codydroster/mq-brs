const int SENSOR_A_PIN = 20;  // A6
const int SENSOR_B_PIN = 21;  // A7
const int OUTPUT_A_PIN = 2;
const int OUTPUT_B_PIN = 3;
const int BAUD_RATE    = 115200;
const int SAMPLE_MS    = 100;

// Trigger is relative to an ambient baseline instead of a static threshold,
// so changing light conditions don't cause false triggers.
const int   TRIGGER_DELTA   = 300;    // counts below baseline that counts as a trigger
const int   CAL_SAMPLES     = 20;     // samples averaged per baseline calibration
const int   CAL_SAMPLE_MS   = 2;      // delay between calibration samples
const float BASELINE_ALPHA  = 0.01;   // slow drift toward ambient while untriggered

float baselineA, baselineB;

float calibrate(int pin) {
  long sum = 0;
  for (int i = 0; i < CAL_SAMPLES; i++) {
    sum += analogRead(pin);
    delay(CAL_SAMPLE_MS);
  }
  return (float)sum / CAL_SAMPLES;
}

void calibrateBaselines(Stream &port) {
  baselineA = calibrate(SENSOR_A_PIN);
  baselineB = calibrate(SENSOR_B_PIN);
  port.print("BASELINE A: ");
  port.print((int)baselineA);
  port.print(" B: ");
  port.println((int)baselineB);
}

// Commands from the Pi (or USB serial for debugging):
//   B - calibrate both sensors
//   1 - calibrate sensor A only
//   2 - calibrate sensor B only
void handleCommand(Stream &port) {
  char c = port.read();
  if (c == 'B' || c == 'b') {
    baselineA = calibrate(SENSOR_A_PIN);
    baselineB = calibrate(SENSOR_B_PIN);
    // Fresh baseline means untriggered - drop outputs before acknowledging
    digitalWrite(OUTPUT_A_PIN, LOW);
    digitalWrite(OUTPUT_B_PIN, LOW);
    port.print("BASELINE A: ");
    port.print((int)baselineA);
    port.print(" B: ");
    port.println((int)baselineB);
  } else if (c == '1') {
    baselineA = calibrate(SENSOR_A_PIN);
    digitalWrite(OUTPUT_A_PIN, LOW);
    port.print("BASELINE A: ");
    port.println((int)baselineA);
  } else if (c == '2') {
    baselineB = calibrate(SENSOR_B_PIN);
    digitalWrite(OUTPUT_B_PIN, LOW);
    port.print("BASELINE B: ");
    port.println((int)baselineB);
  }
}

void setup() {
  Serial.begin(BAUD_RATE);
  Serial1.begin(9600);  // Pi UART link (RX1/TX1)
  analogReadResolution(12);  // 0-4095

  // Pullups keep pin high when phototransistor is off (no reflection)
  pinMode(SENSOR_A_PIN, INPUT_PULLUP);
  pinMode(SENSOR_B_PIN, INPUT_PULLUP);

  pinMode(OUTPUT_A_PIN, OUTPUT);
  pinMode(OUTPUT_B_PIN, OUTPUT);

  // Initial calibration - nothing should be in front of the sensors at boot
  calibrateBaselines(Serial);
}

void loop() {
  if (Serial.available())  handleCommand(Serial);
  if (Serial1.available()) handleCommand(Serial1);

  int rawA = analogRead(SENSOR_A_PIN);
  int rawB = analogRead(SENSOR_B_PIN);

  bool trigA = rawA < baselineA - TRIGGER_DELTA;
  bool trigB = rawB < baselineB - TRIGGER_DELTA;

  // Track slow ambient changes while untriggered
  if (!trigA) baselineA += BASELINE_ALPHA * (rawA - baselineA);
  if (!trigB) baselineB += BASELINE_ALPHA * (rawB - baselineB);

  digitalWrite(OUTPUT_A_PIN, trigA ? HIGH : LOW);
  digitalWrite(OUTPUT_B_PIN, trigB ? HIGH : LOW);

  Serial.print("A: ");
  Serial.print(rawA);
  Serial.print(" (base ");
  Serial.print((int)baselineA);
  Serial.print(")");
  Serial.print(trigA ? " [TRIGGERED]" : "            ");
  Serial.print("  B: ");
  Serial.print(rawB);
  Serial.print(" (base ");
  Serial.print((int)baselineB);
  Serial.print(")");
  Serial.println(trigB ? " [TRIGGERED]" : "");

  delay(SAMPLE_MS);
}
