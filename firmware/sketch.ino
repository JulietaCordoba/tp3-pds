#include <driver/dac.h>

#define ADC_PIN 34
#define DAC_CHANNEL DAC_CHANNEL_1   // GPIO25

hw_timer_t *timer = NULL;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

volatile bool sampling = false;
volatile bool sampleFlag = false;
volatile uint16_t lastSample = 0;

int sampleRateHz = 1000;

void IRAM_ATTR onTimer() {
  portENTER_CRITICAL_ISR(&timerMux);
  if (sampling) {
    lastSample = analogRead(ADC_PIN);
    sampleFlag = true;
  }
  portEXIT_CRITICAL_ISR(&timerMux);
}

void setSampleRate(int hz) {
  if (timer != NULL) timerEnd(timer);
  timer = timerBegin(1000000);
  timerAttachInterrupt(timer, &onTimer);
  timerAlarm(timer, 1000000UL / hz, true, 0);
}

void setup() {
  Serial.begin(115200);
  dac_output_enable(DAC_CHANNEL);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  setSampleRate(sampleRateHz);
  Serial.println("Listo. Enviar 'S' para iniciar, 'P' para detener, 'F<hz>' para cambiar la frecuencia.");
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'S') { sampling = true; Serial.println(">> INICIADO"); }
    if (c == 'P') { sampling = false; Serial.println(">> DETENIDO"); }
    if (c == 'F') {
      int hz = Serial.parseInt();
      if (hz > 0 && hz <= 5000) {
        sampleRateHz = hz;
        setSampleRate(hz);
        Serial.print(">> Frecuencia de muestreo: ");
        Serial.println(hz);
      }
    }
  }

  if (sampleFlag) {
    portENTER_CRITICAL(&timerMux);
    uint16_t sample = lastSample;
    sampleFlag = false;
    portEXIT_CRITICAL(&timerMux);

    uint8_t dacValue = sample >> 4;
    dac_output_voltage(DAC_CHANNEL, dacValue);

    Serial.println(sample);
  }
}