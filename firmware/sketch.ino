#include <driver/dac.h>

#define ADC_PIN 34
#define DAC_CHANNEL DAC_CHANNEL_1

hw_timer_t *timer = NULL;

volatile bool sampling = false;
volatile bool sampleRequest = false;   // la ISR solo prende esta bandera

int sampleRateHz = 800;

void IRAM_ATTR onTimer() {
  if (sampling) {
    sampleRequest = true;   // nada más acá, ni analogRead ni Serial
  }
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

  if (sampleRequest) {
    sampleRequest = false;

    uint16_t sample = analogRead(ADC_PIN);   // la lectura real, ahora en el loop()

    uint8_t dacValue = sample >> 4;
    dac_output_voltage(DAC_CHANNEL, dacValue);

    Serial.println(sample);
  }
}