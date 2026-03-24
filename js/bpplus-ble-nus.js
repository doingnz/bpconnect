/**
 * BpPlusBleNus — connects to the BP+ Bridge via Nordic UART Service (NUS)
 *
 * NUS UUIDs:
 *   Service  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   Write    6E400002-B5A3-F393-E0A9-E50E24DCCA9E  (client → device, UART TX)
 *   Notify   6E400003-B5A3-F393-E0A9-E50E24DCCA9E  (device → client, UART RX)
 *
 * No serial-port configuration step is needed — baud rate and flow control
 * are compiled into the ESP32 firmware (115200, hardware RTS/CTS).
 *
 * Same public interface as BpPlusBle so bpplus.js can use either interchangeably.
 */
class BpPlusBleNus {

  static SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  static WRITE_UUID   = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // client → device
  static NOTIFY_UUID  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // device → client

  constructor() {
    this._event  = new Emitter();
    this._status = 'disconnected';
    this._device    = null;
    this._writeChar = null;
    this._boundOnDisconnect = this._onDisconnect.bind(this);
  }

  status()           { return this._status; }
  register(type, fn) { this._event.on(type, fn); }

  connect() {
    navigator.bluetooth.requestDevice({
      filters: [{ services: [BpPlusBleNus.SERVICE_UUID] }]
    })
    .then(device => {
      this._device = device;
      device.addEventListener('gattserverdisconnected', this._boundOnDisconnect);
      debuglog('BLE NUS: device selected — ' + device.name);
      return device.gatt.connect();
    })
    .then(server => {
      debuglog('BLE NUS: GATT connected');
      return server.getPrimaryService(BpPlusBleNus.SERVICE_UUID);
    })
    .then(service => Promise.all([
      service.getCharacteristic(BpPlusBleNus.WRITE_UUID),
      service.getCharacteristic(BpPlusBleNus.NOTIFY_UUID)
    ]))
    .then(([writeChar, notifyChar]) => {
      this._writeChar = writeChar;
      debuglog('BLE NUS: characteristics found — starting notifications');
      return notifyChar.startNotifications().then(() => {
        notifyChar.addEventListener('characteristicvaluechanged', e => {
          const data = new Uint8Array(e.target.value.buffer);
          tracelog('RX', data);
          this._event.emit('receive', data);
        });
      });
    })
    .then(() => {
      debuglog('BLE NUS: ready');
      this._status = 'connected';
      this._event.emit('connect', true);
    })
    .catch(err => console.error('BLE NUS connect error:', err));
  }

  disconnect() {
    if (this._device) {
      this._device.removeEventListener('gattserverdisconnected', this._boundOnDisconnect);
      if (this._device.gatt.connected) this._device.gatt.disconnect();
    }
    this._device    = null;
    this._writeChar = null;
    this._status    = 'disconnected';
    this._event.emit('connect', false);
  }

  async start() {
    this._status = 'running';
    await this._send('d 4\r\n');
    await this._send('s\r\n');
  }

  cancel() { this._send('c\r\n'); }

  stop() {
    this._status = 'connected';
    this._event.emit('stop', true);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _onDisconnect() {
    debuglog('BLE NUS: disconnected');
    this._writeChar = null;
    this._status    = 'disconnected';
    this._event.emit('connect', false);
  }

  _send(str) {
    if (!this._writeChar) return Promise.reject(new Error('BLE NUS: not connected'));
    tracelog('TX', str);
    return this._writeChar.writeValueWithoutResponse(new TextEncoder().encode(str));
  }
}
