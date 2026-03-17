/**
 * Bluetooth Terminal class.
 */
class BluetoothTerminal {
  /**
   * Create preconfigured Bluetooth Terminal instance.
   *
   * uConnect S2B5232I config characteristic byte layout (UUID 00031203-…):
   *   Byte 0: 0xAA  product model identifier (RS-232)
   *   Byte 1: baud  0x04=19200  0x05=38400  0x06=57600  0x07=115200
   *   Byte 2: 0x00  reserved — MUST remain 0x00 (changing it breaks the write)
   *   Byte 3: port  bit 0 = parity (0=none, 1=even)
   *                 bit 1 = hardware flow control (0=disabled, 1=RTS/CTS enabled)
   *
   * So byte 3 = 0x02 enables RTS/CTS; byte 3 = 0x00 disables it.
   *
   * IMPORTANT: hardware flow control must be enabled on BOTH sides:
   *   1. This BLE adapter (byte 3 = 0x02, set via flowControl=true)
   *   2. The BP+ device itself (Menu → Setup → Hardware Flow Control)
   *
   * When both are enabled the adapter deasserts RTS when its serial buffer fills,
   * pausing BP+ until the BLE link drains the buffer. This prevents the data loss
   * seen on Android (XML length mismatch) where BLE is slower than 115200 baud.
   *
   * @param {!(number|string)} [serviceUuid]
   * @param {!(number|string)} [characteristicUuid]
   * @param {string}           [receiveSeparator='\n']
   * @param {string}           [sendSeparator='\n']
   * @param {boolean}          [flowControl=true]  true = byte 3 bit 1 set (RTS/CTS enabled)
   */
// uConnect S2B5232I
  constructor(serviceUuid        = '0003abcd-0000-1000-8000-00805f9b0131',
              characteristicUuid = '00031201-0000-1000-8000-00805f9b0130',
              receiveSeparator   = '\n',
              sendSeparator      = '\n',
              flowControl        = true) {

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
    this._flowControl = flowControl;

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
   * Build the 4-byte serial-port config word for the uConnect S2B5232I.
   *
   * Byte 0: 0xAA   product model (RS-232)
   * Byte 1: 0x07   baud rate 115200 (BP+ only supports 115200)
   * Byte 2: 0x00   reserved — must be 0x00
   * Byte 3: port   0x00 = no parity, no flow control
   *                0x02 = no parity, hardware RTS/CTS enabled  (bit 1)
   *
   * @return {Uint8Array}
   * @private
   */
  _buildConfigBytes() {
    const portSettings = this._flowControl ? 0x02 : 0x00;
    return new Uint8Array([0xAA, 0x07, 0x00, portSettings]);
  }

  /**
   * Connect, discover characteristics, start notifications, configure the
   * BLE module serial port, then signal ready.
   *
   * BP+ only supports 115200 baud so no baud-rate negotiation is needed —
   * a single config write sets the adapter to 115200 + flow control state.
   * connected() is called only after the config write completes so the
   * caller cannot send commands until the BLE module is fully ready.
   *
   * @param {Object} device
   * @return {Promise}
   * @private
   */
  _connectToDevice(device) {
    return (device ? Promise.resolve(device) : this._requestBluetoothDevice()).
        then((device) => this._connectDeviceAndCacheCharacteristic(device)).
        then((characteristic) => this._startNotifications(characteristic)).

        // Configure the BLE module: 115200 baud + flow control setting.
        then(() => {
          const data = this._buildConfigBytes();
          debuglog('BLE config [115200, fc=' + this._flowControl + ', bytes=' + Array.from(data) + ']');
          tracelog('CFG', data);
          return this._writeToCharacteristicByteArray(this._configCharacteristic, data);
        }).

        // Configuration complete: signal ready.
        then(() => {
          debuglog('BLE configured — signalling connected');
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
