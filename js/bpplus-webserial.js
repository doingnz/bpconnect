/**
 * BpPlusWebSerial - communicates with BP+ via PL2303 USB-serial
 * adapter using the WebUSB API.
 *
 * WebSerial is not implemented on Android so this is used.
 *
 * Implements the same interface as BpPlusSerial so it can be used as a
 * drop-in replacement.
 */
class BpPlusWebSerial {

  constructor() {
    this._event = new Emitter;
    this._running = false;
    this._status = 'disconnected';
    this._device = null;
    this._endpointIn = null;
    this._endpointOut = null;
  }

  status() {
    return this._status;
  }

  register(type, fn) {
    this._event.on(type, fn);
  }

  // -------------------------------------------------------------------------
  // Connection

  connect() {
    // Async — returns immediately, emits 'connect' event when ready
    this._usbConnect();
  }

  async _usbConnect() {
    // Request a PL2303 device — supports original HX (0x2303) and GT (0x23A3)
    this._device = await navigator.usb.requestDevice({
      filters: [
        { vendorId: 0x067B, productId: 0x2303 },   // PL2303 / PL2303HX
        { vendorId: 0x067B, productId: 0x23A3 },   // PL2303GT
      ]
    });

    await this._device.open();
    await this._device.selectConfiguration(1);

    // PL2303: interface 0 = control, interface 1 = data (bulk)
    await this._device.claimInterface(0);
    //await this._device.claimInterface(1);

    // Discover bulk IN / OUT endpoints from the data interface
/*	
    const dataInterface = this._device.configuration.interfaces[1].alternate;
    for (const endpoint of dataInterface.endpoints) {
      if (endpoint.type === 'bulk') {
        if (endpoint.direction === 'in')  this._endpointIn  = endpoint.endpointNumber;
        if (endpoint.direction === 'out') this._endpointOut = endpoint.endpointNumber;
      }
    }
*/	
	for (const iface of this._device.configuration.interfaces) {
		for (const alt of iface.alternates) {
			if (alt.interfaceClass !== 0xff) continue;
			this.interfaceNumber_ = iface.interfaceNumber;
			for (const ep of alt.endpoints) {
				if (ep.direction === 'out' && ep.type === 'bulk') {
					this._endpointOut = ep.endpointNumber;
					//this.endpointOutPacketSize_ = ep.packetSize;
				} else if (ep.direction === 'in' && ep.type === 'bulk') {
					this._endpointIn = ep.endpointNumber;
					//this.endpointInPacketSize_ = ep.packetSize;
				}
			}
		}
	}	

    // Identify chip variant so the correct init sequence is used below
    this._chipType = (this._device.productId === 0x23A3) ? 'GT' : 'legacy';

    // Run the PL2303 chip initialisation sequence then configure the port
    await this._pl2303Init();
    await this._setBaudRate(115200);              // 115200 8N1
    await this._setControlLineState(true, true);  // Assert DTR + RTS

    console.log('connect');
    this._status = 'connected';
    this._event.emit('connect', true);
  }

  async disconnect() {
    this._running = false;
    this._status = 'disconnected';
    this._event.emit('connect', false);

    await this._setControlLineState(false, false);
    await this._device.releaseInterface(1);
    await this._device.releaseInterface(0);
    await this._device.close();
  }

  // -------------------------------------------------------------------------
  // Measurement control

  start() {
    this._status = 'running';
    this._running = true;

    // Start the receive loop (async — runs in background)
    this._receiver();

    // Send BP+ start commands
    this._transmitter(this._str2ab('d 4\r\n'));
    this._transmitter(this._str2ab('s\r\n'));
  }

  cancel() {
    this._transmitter(this._str2ab('c\r\n'));
  }

  stop() {
    this._status = 'connected';
    this._running = false;
    this._event.emit('stop', true);
  }

  receive(data) {
    // Intentionally empty — callers subscribe via register()
  }

  // -------------------------------------------------------------------------
  // Transport

  async _transmitter(data) {
    await this._device.transferOut(this._endpointOut, data);
  }

  async _receiver() {
    console.log('receiver start');

    while (this._running) {
      try {
        const result = await this._device.transferIn(this._endpointIn, 64);
        if (result.data && result.data.byteLength > 0) {
          this._event.emit('receive', new Uint8Array(result.data.buffer));
        }
      } catch (err) {
        console.log('receiver error: ' + err);
        break;
      }
    }

    console.log('receiver end');
  }

  // -------------------------------------------------------------------------
  // PL2303 chip setup

  /**
   * Vendor-specific initialisation sequence required by the PL2303.
   * Dispatches to the correct sequence for the detected chip variant.
   */
  async _pl2303Init() {
    if (this._chipType === 'GT') {
      await this._pl2303GtInit();
    } else {
      await this._pl2303LegacyInit();
    }
  }

  /**
   * Legacy init sequence for PL2303 / PL2303HX (TYPE_01).
   * Mirrors what the Linux pl2303 kernel driver does on attach for older chips.
   */
  async _pl2303LegacyInit() {
    await this._vendorRead(0x8484, 0);
    await this._vendorWrite(0x0404, 0);
    await this._vendorRead(0x8484, 0);
    await this._vendorRead(0x8383, 0);
    await this._vendorRead(0x8484, 0);
    await this._vendorWrite(0x0404, 1);
    await this._vendorRead(0x8484, 0);
    await this._vendorRead(0x8383, 0);
    await this._vendorWrite(0, 1);
    await this._vendorWrite(1, 0);
    await this._vendorWrite(2, 0x44);
  }

  /**
   * Init sequence for PL2303GT.
   * The GT is a newer die that does not use the legacy TYPE_01 vendor
   * read/write handshake. It only needs a pair of register clears before
   * the standard CDC line-coding commands are issued.
   * Mirrors the TYPE_GT branch in the Linux pl2303 kernel driver.
   */
  async _pl2303GtInit() {
    await this._vendorWrite(0x08, 0);
    await this._vendorWrite(0x09, 0);
  }

  async _vendorRead(value, index) {
    return await this._device.controlTransferIn({
      requestType: 'vendor',
      recipient: 'device',
      request: 0x01,
      value: value,
      index: index,
    }, 1);
  }

  async _vendorWrite(value, index) {
    return await this._device.controlTransferOut({
      requestType: 'vendor',
      recipient: 'device',
      request: 0x01,
      value: value,
      index: index,
    });
  }

  /**
   * Set serial port baud rate and format via CDC SET_LINE_CODING (8N1).
   */
  async _setBaudRate(baudRate) {
    const buffer = new ArrayBuffer(7);
    const view = new DataView(buffer);
    view.setUint32(0, baudRate, true); // baud rate, little-endian
    view.setUint8(4, 0);               // 1 stop bit
    view.setUint8(5, 0);               // no parity
    view.setUint8(6, 8);               // 8 data bits

    await this._device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: 0x20,  // SET_LINE_CODING
      value: 0,
      index: 0,
    }, buffer);
  }

  /**
   * Assert or deassert DTR / RTS via CDC SET_CONTROL_LINE_STATE.
   */
  async _setControlLineState(dtr, rts) {
    const value = (dtr ? 0x01 : 0x00) | (rts ? 0x02 : 0x00);
    await this._device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: 0x22,  // SET_CONTROL_LINE_STATE
      value: value,
      index: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Utilities

  _str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
    }
    return buf;
  }

}
