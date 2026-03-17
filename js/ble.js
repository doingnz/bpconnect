/**
 * Bluetooth Terminal class.
 */
class BluetoothTerminal {
  /**
   * Create preconfigured Bluetooth Terminal instance.
   * @param {string}           [rate='115200']       - Serial baud rate passed to the BLE module config
   * @param {!(number|string)} [serviceUuid]          - Service UUID
   * @param {!(number|string)} [characteristicUuid]   - RX Characteristic UUID
   * @param {string}           [receiveSeparator='\n']
   * @param {string}           [sendSeparator='\n']
   */
// Uconnect
  constructor(rate = '115200',
              serviceUuid        = '0003abcd-0000-1000-8000-00805f9b0131',
              characteristicUuid = '00031201-0000-1000-8000-00805f9b0130',
              receiveSeparator   = '\n',
              sendSeparator      = '\n') {

/* LM Tech LM068
    constructor(serviceUuid = '00005500-d102-11e1-9b23-00025b00a5a5',
                characteristicUuid = '00005501-d102-11e1-9b23-00025b00a5a5', ...)
*/
/* Adafruit / Nordic UART Service
    constructor(rate = '115200',
                serviceUuid = '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
                characteristicUuid = '6e400003-b5a3-f393-e0a9-e50e24dcca9e', ...)
*/

    this._receiveBuffer = '';
    this._maxCharacteristicValueLength = 20;
    this._device = null;
    this._service = null;
    this._characteristic = null;
    this._txCharacteristic = null;
    this._configCharacteristic = null;
    this._rate = rate;

    this._boundHandleDisconnection = this._handleDisconnection.bind(this);
    this._boundHandleCharacteristicValueChanged =
        this._handleCharacteristicValueChanged.bind(this);

    this.setServiceUuid(serviceUuid);
    this.setCharacteristicUuid(characteristicUuid);
    this.setReceiveSeparator(receiveSeparator);
    this.setSendSeparator(sendSeparator);
  }

  setServiceUuid(uuid) {
    if (!Number.isInteger(uuid) &&
        !(typeof uuid === 'string' || uuid instanceof String)) {
      throw new Error('UUID type is neither a number nor a string');
    }
    if (!uuid) {
      throw new Error('UUID cannot be a null');
    }
    this._serviceUuid = uuid;
  }

  setCharacteristicUuid(uuid) {
    if (!Number.isInteger(uuid) &&
        !(typeof uuid === 'string' || uuid instanceof String)) {
      throw new Error('UUID type is neither a number nor a string');
    }
    if (!uuid) {
      throw new Error('UUID cannot be a null');
    }
    this._rxCharacteristicUuid     = uuid;
    // uConnect TX and config characteristics
    this._txCharacteristicUuid     = '00031202-0000-1000-8000-00805f9b0130';
    this._configCharacteristicUuid = '00031203-0000-1000-8000-00805f9b0130';
    // Adafruit / Nordic UART TX (reference):
    // this._txCharacteristicUuid = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  }

  setReceiveSeparator(separator) {
    if (!(typeof separator === 'string' || separator instanceof String)) {
      throw new Error('Separator type is not a string');
    }
    if (separator.length !== 1) {
      throw new Error('Separator length must be equal to one character');
    }
    this._receiveSeparator = ''; // todo separator;
  }

  setSendSeparator(separator) {
    if (!(typeof separator === 'string' || separator instanceof String)) {
      throw new Error('Separator type is not a string');
    }
    if (separator.length !== 1) {
      throw new Error('Separator length must be equal to one character');
    }
    this._sendSeparator = ''; // todo separator;
  }

  connect() {
    return this._connectToDevice(this._device);
  }

  /**
   * Called when the device is fully connected AND the BLE module serial port
   * is completely configured (baud rate + flow control).
   * Override to be notified when the device is actually ready for commands.
   */
  connected() {
  }

  disconnect() {
    this._disconnectFromDevice(this._device);

    if (this._characteristic) {
      this._characteristic.removeEventListener('characteristicvaluechanged',
          this._boundHandleCharacteristicValueChanged);
      this._characteristic = null;
      this._txCharacteristic = null;
    }

    this._device = null;
  }

  receive(data) {
    // Override to handle incoming data.
  }

  send(data) {
    data = String(data || '');

    if (!data) {
      return Promise.reject(new Error('Data must be not empty'));
    }

    data += this._sendSeparator;

    tracelog('TX', data);

    const chunks = this.constructor._splitByLength(data,
        this._maxCharacteristicValueLength);

    if (!this._txCharacteristic) {
      return Promise.reject(new Error('There is no connected device'));
    }

    let promise = this._writeToCharacteristic(this._txCharacteristic, chunks[0]);

    for (let i = 1; i < chunks.length; i++) {
      promise = promise.then(() => new Promise((resolve, reject) => {
        if (!this._txCharacteristic) {
          reject(new Error('Device has been disconnected'));
        }
        this._writeToCharacteristic(this._txCharacteristic, chunks[i]).
            then(resolve).
            catch(reject);
      }));
    }

    return promise;
  }

  getDeviceName() {
    if (!this._device) {
      return '';
    }
    return this._device.name;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * Build the 4-byte serial-port config word for the uConnect BLE module.
   *
   * Byte layout:  [0xAA, baudCode, 0x00, 0x02]
   *   baudCode  0x04=19200  0x05=38400  0x06=57600  0x07=115200
   *
   * NOTE: byte[2] is fixed at 0x00.  Setting it to 0x01 (attempted as a
   * hardware RTS/CTS flag) causes the config characteristic write to be
   * rejected by the BLE module, preventing connection entirely.  Testing
   * confirmed that 0x00 works correctly even when the BP+ device has
   * hardware flow control enabled — the BLE module handles the serial
   * flow-control signalling to the BP+ transparently without needing to
   * be told about it via this characteristic.
   *
   * @param {string} rate - Baud rate string ('115200', '57600', …)
   * @return {Uint8Array}
   * @private
   */
  _buildConfigBytes(rate) {
    let baudCode = 0x07; // default 115200
    switch (rate) {
      case '115200': baudCode = 0x07; break;
      case '57600':  baudCode = 0x06; break;
      case '38400':  baudCode = 0x05; break;
      case '19200':  baudCode = 0x04; break;
    }
    return new Uint8Array([0xAA, baudCode, 0x00, 0x02]);
  }

  /**
   * Connect, discover characteristics, start notifications, then negotiate the
   * baud rate with the BP+ and configure the BLE module serial port.
   *
   * FIX 1: connected() is now called AFTER the complete config sequence so the
   *         caller cannot send commands until the BLE module is fully ready.
   *
   * FIX 2: the 'b <rate>' TX write now has return so sleep(5000) correctly
   *         waits for the write to complete before starting the timer.
   *
   * FIX 3: both config writes now use _buildConfigBytes() which includes the
   *         hardware flow control byte — this is what caused the BP+ to be
   *         unable to send responses back when hardware FC was enabled on the
   *         device but not configured on the BLE module serial port.
   *
   * @param {Object} device
   * @return {Promise}
   * @private
   */
  _connectToDevice(device) {
    return (device ? Promise.resolve(device) : this._requestBluetoothDevice()).
        then((device) => this._connectDeviceAndCacheCharacteristic(device)).
        then((characteristic) => this._startNotifications(characteristic)).

        // Step 1 — put the BLE module into 115200 + configured flow control
        //          so we can talk to the BP+ at its startup rate.
        then(() => {
          const data = this._buildConfigBytes('115200');
          debuglog('BLE config step 1 [115200]:', data);
          tracelog('CFG', data);
          return this._writeToCharacteristicByteArray(this._configCharacteristic, data);
        }).

        // Step 2 — tell the BP+ to switch to the desired baud rate.
        then(() => {
          const cmd = 'b ' + this._rate + '\r\n';
          debuglog('BLE rate cmd:', cmd.trim());
          return this._writeToCharacteristic(this._txCharacteristic, cmd); // FIX 2: return was missing
        }).

        // Step 3 — wait for the BP+ to complete its baud-rate switch.
        then(() => {
          debuglog('BLE waiting for BP+ rate switch (5 s)…');
          return sleep(5000);
        }).

        // Step 4 — reconfigure the BLE module to the new rate + flow control.
        then(() => {
          const data = this._buildConfigBytes(this._rate);
          debuglog('BLE config step 4 [rate=' + this._rate + ']:', data);
          tracelog('CFG', data);
          return this._writeToCharacteristicByteArray(this._configCharacteristic, data);
        }).

        // Step 5 — configuration complete: signal ready.
        // FIX 1: connected() is here, not before step 1.
        then(() => {
          debuglog('BLE fully configured — signalling connected');
          this.connected();
        }).

        catch((error) => {
          this._log(error);
          return Promise.reject(error);
        });
  }

  _disconnectFromDevice(device) {
    if (!device) {
      return;
    }
    this._log('Disconnecting from "' + device.name + '" bluetooth device...');

    device.removeEventListener('gattserverdisconnected',
        this._boundHandleDisconnection);

    if (!device.gatt.connected) {
      this._log('"' + device.name + '" bluetooth device is already disconnected');
      return;
    }

    device.gatt.disconnect();
    this._log('"' + device.name + '" bluetooth device disconnected');
  }

  _requestBluetoothDevice() {
    this._log('Requesting bluetooth device...');

    return navigator.bluetooth.requestDevice({
      filters: [{services: [this._serviceUuid]}],
      optionalServices: [this._serviceUuid]
    }).then((device) => {
      this._log('"' + device.name + '" bluetooth device selected');

      this._device = device;
      this._device.addEventListener('gattserverdisconnected',
          this._boundHandleDisconnection);

      return this._device;
    });
  }

  _connectDeviceAndCacheCharacteristic(device) {
    if (device.gatt.connected && this._characteristic) {
      return Promise.resolve(this._characteristic);
    }

    this._log('Connecting to GATT server...');

    return device.gatt.connect().
        then((server) => {
          this._log('GATT server connected — getting service...');
          return server.getPrimaryService(this._serviceUuid);
        }).
        then((service) => {
          this._log('Service found — getting config characteristic...');
          this._service = service;
          return service.getCharacteristic(this._configCharacteristicUuid);
        }).
        then((characteristic) => {
          this._log('Config characteristic found');
          this._configCharacteristic = characteristic;
        }).
        then(() => {
          this._log('Getting TX characteristic...');
          return this._service.getCharacteristic(this._txCharacteristicUuid);
        }).
        then((characteristic) => {
          this._log('TX characteristic found');
          this._txCharacteristic = characteristic;
        }).
        then(() => {
          this._log('Getting RX characteristic...');
          return this._service.getCharacteristic(this._rxCharacteristicUuid);
        }).
        then((characteristic) => {
          this._log('RX characteristic found');
          this._characteristic = characteristic;
          return this._characteristic;
        });
  }

  _startNotifications(characteristic) {
    this._log('Starting notifications...');
    return characteristic.startNotifications().
        then(() => {
          this._log('Notifications started');
          characteristic.addEventListener('characteristicvaluechanged',
              this._boundHandleCharacteristicValueChanged);
        });
  }

  _stopNotifications(characteristic) {
    this._log('Stopping notifications...');
    return characteristic.stopNotifications().
        then(() => {
          this._log('Notifications stopped');
          characteristic.removeEventListener('characteristicvaluechanged',
              this._boundHandleCharacteristicValueChanged);
        });
  }

  _handleDisconnection(event) {
    const device = event.target;
    this._log('"' + device.name + '" disconnected — trying to reconnect...');

    this._connectDeviceAndCacheCharacteristic(device).
        then((characteristic) => this._startNotifications(characteristic)).
        then(() => this.connected()).
        catch((error) => this._log(error));
  }

  _handleCharacteristicValueChanged(event) {
    const data = event.target.value;
    tracelog('RX', data);
    this.receive(data);
  }

  _writeToCharacteristic(characteristic, data) {
    return characteristic.writeValue(new TextEncoder().encode(data));
  }

  _writeToCharacteristicByteArray(characteristic, data) {
    return characteristic.writeValue(data);
  }

  _readFromCharacteristic(characteristic) {
    return characteristic.readValue();
  }

  _log(...messages) {
    console.log(...messages);
  }

  static _splitByLength(string, length) {
    return string.match(new RegExp('(.|[\r\n]){1,' + length + '}', 'g'));
  }
}

/* istanbul ignore next */
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = BluetoothTerminal;
}
