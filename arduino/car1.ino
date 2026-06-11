const int SENSOR_A_PIN = 20;  // A6
const int SENSOR_B_PIN = 21;  // A7
const int OUTPUT_A_PIN = 2;
const int OUTPUT_B_PIN = 3;
const int TRIGGER_THRESHOLD = 3800;
const int BAUD_RATE    = 115200;
const int SAMPLE_MS    = 100;

void setup() {
  Serial.begin(BAUD_RATE);
  analogReadResolution(12);  // 0–4095

  // Pullups keep pin high when phototransistor is off (no reflection)
  pinMode(SENSOR_A_PIN, INPUT_PULLUP);
  pinMode(SENSOR_B_PIN, INPUT_PULLUP);

  pinMode(OUTPUT_A_PIN, OUTPUT);
  pinMode(OUTPUT_B_PIN, OUTPUT);
}

void loop() {
  int rawA = analogRead(SENSOR_A_PIN);
  int rawB = analogRead(SENSOR_B_PIN);

  bool trigA = rawA < TRIGGER_THRESHOLD;
  bool trigB = rawB < TRIGGER_THRESHOLD;

  digitalWrite(OUTPUT_A_PIN, trigA ? HIGH : LOW);
  digitalWrite(OUTPUT_B_PIN, trigB ? HIGH : LOW);

  Serial.print("A: ");
  Serial.print(rawA);
  Serial.print(trigA ? " [TRIGGERED]" : "            ");
  Serial.print("  B: ");
  Serial.print(rawB);
  Serial.println(trigB ? " [TRIGGERED]" : "");

  delay(SAMPLE_MS);
}
