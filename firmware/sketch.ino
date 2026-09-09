#include <driver/dac.h>

#define ADC_PIN 34
#define DAC_CHANNEL DAC_CHANNEL_1

hw_timer_t *timer = NULL;

volatile bool sampling = false;
volatile bool sampleRequest = false;   // la ISR solo prende esta bandera

int sampleRateHz = 800;

// ---------- Filtro digital ----------
int filterType = 0;      // 0 = ninguno, 1 = pasabajos, 2 = pasaaltos, 3 = pasabanda
float fcLow = 20.0;
float fcHigh = 100.0;

float lpState = 0;
float hpState_y = 0, hpState_xPrev = 0;
float bpHpState_y = 0, bpHpState_xPrev = 0;
float bpLpState = 0;

float lowpassStep(float x, float fc, float &state) {
  float dt = 1.0 / sampleRateHz;
  float RC = 1.0 / (2 * PI * fc);
  float alpha = dt / (RC + dt);
  state = state + alpha * (x - state);
  return state;
}

float highpassStep(float x, float fc, float &stateY, float &stateXPrev) {
  float dt = 1.0 / sampleRateHz;
  float RC = 1.0 / (2 * PI * fc);
  float alpha = RC / (RC + dt);
  float y = alpha * (stateY + x - stateXPrev);
  stateXPrev = x;
  stateY = y;
  return y;
}

float applyFilterSample(float x) {
  if (filterType == 1) {
    return lowpassStep(x, fcLow, lpState);
  } else if (filterType == 2) {
    return highpassStep(x, fcLow, hpState_y, hpState_xPrev);
  } else if (filterType == 3) {
    float hp = highpassStep(x, fcLow, bpHpState_y, bpHpState_xPrev);
    return lowpassStep(hp, fcHigh, bpLpState);
  }
  return x; // sin filtro
}

void resetFilters() {
  lpState = 0;
  hpState_y = 0; hpState_xPrev = 0;
  bpHpState_y = 0; bpHpState_xPrev = 0;
  bpLpState = 0;
}
// ---------- fin filtro ----------

void IRAM_ATTR onTimer() {
  if (sampling) {
    sampleRequest = true;
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
  Serial.println("Listo. 'S' iniciar, 'P' detener, 'F<hz>' frecuencia, 'T<0-3>' tipo de filtro, 'C<hz>' corte (inferior), 'D<hz>' corte superior (pasabanda).");
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'S') { sampling = true; Serial.println(">> INICIADO"); }
    else if (c == 'P') { sampling = false; Serial.println(">> DETENIDO"); }
    else if (c == 'F') {
      int hz = Serial.parseInt();
      if (hz > 0 && hz <= 5000) {
        sampleRateHz = hz;
        setSampleRate(hz);
        Serial.print(">> Frecuencia de muestreo: ");
        Serial.println(hz);
      }
    }
    else if (c == 'T') {
      int t = Serial.parseInt();
      if (t >= 0 && t <= 3) {
        filterType = t;
        resetFilters();
        Serial.print(">> Filtro tipo: ");
        Serial.println(t);
      }
    }
    else if (c == 'C') {
      float hz = Serial.parseFloat();
      if (hz > 0) {
        fcLow = hz;
        resetFilters();
        Serial.print(">> Corte (inferior): ");
        Serial.println(fcLow);
      }
    }
    else if (c == 'D') {
      float hz = Serial.parseFloat();
      if (hz > 0) {
        fcHigh = hz;
        resetFilters();
        Serial.print(">> Corte superior: ");
        Serial.println(fcHigh);
      }
    }
  }

  if (sampleRequest) {
    sampleRequest = false;

    uint16_t sample = analogRead(ADC_PIN);

    float filtered = applyFilterSample((float)sample - 2048.0);
    int recon = (int)(filtered + 2048.0);
    if (recon < 0) recon = 0;
    if (recon > 4095) recon = 4095;

    uint8_t dacValue = recon >> 4;
    dac_output_voltage(DAC_CHANNEL, dacValue);

    Serial.println(sample);
  }
}