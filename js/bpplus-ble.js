/**
 * BpPlusBle — auto-detecting BLE UART connection for BP+
 *
 * Mirrors the MAUI BleProfileDetector / BpPlusBleClient approach:
 *   1. requestDevice with filters covering all known UART adapter profiles
 *   2. After GATT connect, probe each profile's service UUID in priority order
 *   3. Set up TX / notify characteristics for the matched profile
 *   4. For adapters that need serial-port config (S2B5232I), write the config byte
 *
 * Supported profiles (same set as MAUI WellKnownBleProfiles):
 *   - Nordic NUS (ESP32 BleUartBridge, Adafruit)
 *   - uConnect S2B5232I
 *   - Microchip RN4870
 *   - HM-10 / JDY
 *   - HM-10 clone (FFF0)
 *
 * Device-picker filters strategy
 * ───────────────────────────────
 * Web Bluetooth on Chrome/Windows (WinRT stack) does NOT perform active
 * scanning, so 128-bit service UUIDs in a scan response are invisible to a
 * services filter. The Nordic NUS Bridge puts its UUID in the scan response
 * to keep the ADV PDU short. To handle both:
 *   • services filters  — catch adapters that advertise UUIDs in the ADV PDU
 *   • name filter       — catch "NUS Bridge" via the name in the ADV PDU
 * All service UUIDs are listed in optionalServices so the browser permits
 * access to them regardless of which filter matched.
 */
class BpPlusBle {

  // ── Known GATT profiles (probed in this order after connection) ────────────
  //
  // writeUuid:   client writes to device (UART TX direction)
  // notifyUuid:  device notifies client (UART RX direction); may equal writeUuid
  //              for bidirectional adapters (HM-10)
  // configUuid:  optional serial-port config characteristic (S2B5232I only)
  // writeNoRsp:  use writeValueWithoutResponse — lower latency, no ACK round-trip
  // chunkSize:   max bytes per write operation
  // buildConfig: returns a Uint8Array to write to configUuid, or null if none
  //
  static PROFILES = [
    {
      name:        'Nordic NUS',
      serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
      writeUuid:   '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
      notifyUuid:  '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
      configUuid:  null,
      writeNoRsp:  true,
      chunkSize:   128,
      buildConfig: null,
    },
    {
      // uConnect S2B5232I BLE-to-RS232 adapter
      // Requires a 4-byte config write to set baud rate and flow control
      //   Byte 0: 0xAA  product model (RS-232)
      //   Byte 1: 0x07  baud rate 115200
      //   Byte 2: 0x00  reserved
      //   Byte 3: 0x02  RTS/CTS enabled  |  0x00 = disabled
      name:        'S2B5232I',
      serviceUuid: '0003abcd-0000-1000-8000-00805f9b0131',
      writeUuid:   '00031202-0000-1000-8000-00805f9b0130',
      notifyUuid:  '00031201-0000-1000-8000-00805f9b0130',
      configUuid:  '00031203-0000-1000-8000-00805f9b0131',
      writeNoRsp:  false,
      chunkSize:   20,
      buildConfig: (fc) => new Uint8Array([0xAA, 0x07, 0x00, fc ? 0x02 : 0x00]),
    },
    {
      name:        'RN4870',
      serviceUuid: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
      writeUuid:   '49535343-1e4d-4bd9-ba61-23c647249616',
      notifyUuid:  '49535343-8841-43f4-a8d4-ecbe34729bb3',
      configUuid:  null,
      writeNoRsp:  false,
      chunkSize:   20,
      buildConfig: null,
    },
    {
      name:        'HM-10',
      serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
      writeUuid:   '0000ffe1-0000-1000-8000-00805f9b34fb',
      notifyUuid:  '0000ffe1-0000-1000-8000-00805f9b34fb', // bidirectional
      configUuid:  null,
      writeNoRsp:  false,
      chunkSize:   20,
      buildConfig: null,
    },
    {
      name:        'HM-10 clone',
      serviceUuid: '0000fff0-0000-1000-8000-00805f9b34fb',
      writeUuid:   '0000fff1-0000-1000-8000-00805f9b34fb',
      notifyUuid:  '0000fff1-0000-1000-8000-00805f9b34fb', // bidirectional
      configUuid:  null,
      writeNoRsp:  false,
      chunkSize:   20,
      buildConfig: null,
    },
  ];

  constructor(flowControl = true) {
    this._flowControl = flowControl;
    this._event       = new Emitter();
    this._status      = 'disconnected';
    this._device      = null;
    this._profile     = null;
    this._writeChar   = null;
    this._chunkSize   = 20;
    this._boundOnDisconnect = this._onDisconnect.bind(this);
  }

  status()           { return this._status; }
  register(type, fn) { this._event.on(type, fn); }

  connect() {
    const allServiceUuids = BpPlusBle.PROFILES.map(p => p.serviceUuid);

    navigator.bluetooth.requestDevice({
      filters: [
        // Service-UUID filters: work for adapters that include UUID in the ADV PDU
        ...BpPlusBle.PROFILES.map(p => ({ services: [p.serviceUuid] })),
        // Name filters: catch devices whose NUS UUID is only in the scan response
        // (invisible on Chrome/Windows without active scanning). The firmware
        // advertises "BP+ Bridge" (BLE_DEVICE_NAME in main.c); "NUS Bridge" is
        // the ble_nus.c default included as a fallback.
        { name: 'BP+ Bridge' },
        { name: 'NUS Bridge' },
      ],
      // All service UUIDs must be listed here so the browser permits access
      // after connection, regardless of which filter matched the device.
      optionalServices: allServiceUuids,
    })
    .then(device => {
      this._device = device;
      device.addEventListener('gattserverdisconnected', this._boundOnDisconnect);
      debuglog('BLE: device selected — ' + device.name);
      return device.gatt.connect();
    })
    .then(server => {
      debuglog('BLE: GATT connected — detecting profile…');
      return this._detectProfile(server);
    })
    .then(({ profile, service }) => {
      this._profile = profile;
      debuglog('BLE: profile matched — ' + profile.name);
      return this._setupCharacteristics(service, profile);
    })
    .then(() => {
      this._status = 'connected';
      this._event.emit('connect', true);
    })
    .catch(err => {
      debuglog('BLE: connect error — ' + err);
      console.error('BLE connect error:', err);
    });
  }

  disconnect() {
    if (this._device) {
      this._device.removeEventListener('gattserverdisconnected', this._boundOnDisconnect);
      if (this._device.gatt.connected) this._device.gatt.disconnect();
    }
    this._device    = null;
    this._writeChar = null;
    this._profile   = null;
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

  /**
   * Try each known profile's service UUID in priority order.
   * Mirrors MAUI BleProfileDetector.DetectAsync().
   *
   * getPrimaryService() rejects with NotFoundError when the service isn't
   * present — catch and try the next profile.
   */
  async _detectProfile(server) {
    for (const profile of BpPlusBle.PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.serviceUuid);
        return { profile, service };
      } catch (e) {
        // Service not on this device — try next profile
      }
    }
    throw new Error('No known BLE UART profile found on this device.');
  }

  /**
   * Get characteristics, subscribe to notifications, and write adapter config
   * for profiles that require it (S2B5232I baud-rate + flow-control byte).
   */
  async _setupCharacteristics(service, profile) {
    this._writeChar = await service.getCharacteristic(profile.writeUuid);
    this._chunkSize = profile.chunkSize;

    // notifyUuid may equal writeUuid (bidirectional HM-10 adapters)
    const notifyChar = profile.notifyUuid === profile.writeUuid
      ? this._writeChar
      : await service.getCharacteristic(profile.notifyUuid);

    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', e => {
      const data = new Uint8Array(e.target.value.buffer);
      tracelog('RX', data);
      this._event.emit('receive', data);
    });

    // Write serial-port configuration for adapters that need it (S2B5232I)
    if (profile.configUuid && profile.buildConfig) {
      const configChar = await service.getCharacteristic(profile.configUuid);
      const configData = profile.buildConfig(this._flowControl);
      debuglog('BLE: writing adapter config [' + Array.from(configData) + ']');
      tracelog('CFG', configData);
      await configChar.writeValue(configData);
    }

    debuglog('BLE: ' + profile.name + ' setup complete');
  }

  _onDisconnect() {
    debuglog('BLE: disconnected');
    this._writeChar = null;
    this._profile   = null;
    this._status    = 'disconnected';
    this._event.emit('connect', false);
  }

  _send(str) {
    if (!this._writeChar) return Promise.reject(new Error('BLE: not connected'));
    tracelog('TX', str);

    const bytes  = new TextEncoder().encode(str);
    const writeChunk = (this._profile && this._profile.writeNoRsp
      && typeof this._writeChar.writeValueWithoutResponse === 'function')
      ? (buf) => this._writeChar.writeValueWithoutResponse(buf)
      : (buf) => this._writeChar.writeValue(buf);

    let p = Promise.resolve();
    for (let i = 0; i < bytes.length; i += this._chunkSize) {
      const chunk = bytes.slice(i, i + this._chunkSize);
      p = p.then(() => writeChunk(chunk));
    }
    return p;
  }
}
