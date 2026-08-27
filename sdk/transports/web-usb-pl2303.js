/**
 * WebUSB transport for a Prolific PL2303 USB-to-serial adapter.
 *
 * Android has no Web Serial API, so on Android this is how a BP+ on a USB
 * cable is reached: WebUSB claims the adapter directly and this class does the
 * chip's vendor-specific setup itself.
 *
 * This is the class the old tree called `BpPlusWebSerial`, which was
 * confusing: it is not Web Serial, it is WebUSB.
 *
 * Supports the original PL2303/PL2303HX (0x2303) and the newer PL2303GT
 * (0x23A3), which needs a different init sequence — mirrors the TYPE_01 and
 * TYPE_GT branches of the Linux pl2303 kernel driver.
 */

import { Transport } from './transport.js';

const PROLIFIC_VENDOR_ID = 0x067B;
const PL2303_HX          = 0x2303;
const PL2303_GT          = 0x23A3;

const READ_CHUNK_BYTES   = 512;

export class WebUsbPl2303Transport extends Transport {

  constructor(options = {}) {
    super('USB Serial');
    this._baudRate = options.baudRate ?? 115200;

    this._device      = null;
    this._endpointIn  = null;
    this._endpointOut = null;
    this._interface   = null;
    this._chipType    = 'legacy';
    this._running     = false;
  }

  static get isSupported() {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  get description() {
    return this._device
      ? `USB Serial (PL2303${this._chipType === 'GT' ? 'GT' : ''}) @ ${this._baudRate}`
      : this.name;
  }

  async _open() {
    if (!WebUsbPl2303Transport.isSupported) {
      throw new Error('this browser has no WebUSB API');
    }

    this._device = await navigator.usb.requestDevice({
      filters: [
        { vendorId: PROLIFIC_VENDOR_ID, productId: PL2303_HX },
        { vendorId: PROLIFIC_VENDOR_ID, productId: PL2303_GT },
      ],
    });

    await this._device.open();
    if (this._device.configuration === null) {
      await this._device.selectConfiguration(1);
    }

    this._findEndpoints();
    if (this._endpointIn === null || this._endpointOut === null) {
      throw new Error('the adapter has no bulk endpoints');
    }

    await this._device.claimInterface(this._interface);

    this._chipType = this._device.productId === PL2303_GT ? 'GT' : 'legacy';

    await this._initChip();
    await this._setLineCoding(this._baudRate);
    await this._setControlLines(true, true);   // assert DTR and RTS

    this._running = true;
    this._read();
  }

  /** The data interface is the vendor-specific one (class 0xFF). */
  _findEndpoints() {
    for (const iface of this._device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass !== 0xFF) continue;
        for (const ep of alt.endpoints) {
          if (ep.type !== 'bulk') continue;
          if (ep.direction === 'in')  this._endpointIn  = ep.endpointNumber;
          if (ep.direction === 'out') this._endpointOut = ep.endpointNumber;
        }
        if (this._endpointIn !== null && this._endpointOut !== null) {
          this._interface = iface.interfaceNumber;
          return;
        }
      }
    }
  }

  async _read() {
    while (this._running) {
      let result;
      try {
        result = await this._device.transferIn(this._endpointIn, READ_CHUNK_BYTES);
      } catch (err) {
        if (this._running) this._dropped(`USB read failed: ${err.message}`);
        return;
      }
      if (result.status === 'stall') {
        await this._device.clearHalt('in', this._endpointIn);
        continue;
      }
      if (result.data && result.data.byteLength > 0) {
        this._receive(new Uint8Array(
          result.data.buffer, result.data.byteOffset, result.data.byteLength
        ));
      }
    }
  }

  async _write(bytes) {
    const result = await this._device.transferOut(this._endpointOut, bytes);
    if (result.status !== 'ok') {
      throw new Error(`USB write returned "${result.status}"`);
    }
  }

  async _close() {
    this._running = false;
    try { await this._setControlLines(false, false); } catch { /* already gone */ }
    try { await this._device.releaseInterface(this._interface); } catch { /* already gone */ }
    try { await this._device.close(); } catch { /* already gone */ }
    this._device = null;
  }

  // ── PL2303 chip setup ─────────────────────────────────────────────────────

  async _initChip() {
    if (this._chipType === 'GT') {
      // The GT die does not use the legacy vendor read/write handshake; it
      // needs only a pair of register clears before the CDC line-coding
      // commands.
      await this._vendorWrite(0x08, 0);
      await this._vendorWrite(0x09, 0);
      return;
    }

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

  _vendorRead(value, index) {
    return this._device.controlTransferIn({
      requestType: 'vendor', recipient: 'device', request: 0x01, value, index,
    }, 1);
  }

  _vendorWrite(value, index) {
    return this._device.controlTransferOut({
      requestType: 'vendor', recipient: 'device', request: 0x01, value, index,
    });
  }

  /** CDC SET_LINE_CODING — 8N1 at the requested rate. */
  async _setLineCoding(baudRate) {
    const buffer = new ArrayBuffer(7);
    const view   = new DataView(buffer);
    view.setUint32(0, baudRate, true);
    view.setUint8(4, 0);   // 1 stop bit
    view.setUint8(5, 0);   // no parity
    view.setUint8(6, 8);   // 8 data bits

    await this._device.controlTransferOut({
      requestType: 'class', recipient: 'interface', request: 0x20, value: 0, index: 0,
    }, buffer);
  }

  /** CDC SET_CONTROL_LINE_STATE. */
  async _setControlLines(dtr, rts) {
    await this._device.controlTransferOut({
      requestType: 'class',
      recipient:   'interface',
      request:     0x22,
      value:       (dtr ? 0x01 : 0) | (rts ? 0x02 : 0),
      index:       0,
    });
  }
}
