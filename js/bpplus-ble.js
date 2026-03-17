/**
 * Bluetooth Simulator class.
 */
class BpPlusBle {

  // Create instance
  constructor(bpplusConnRate, flowControl = true) {
    // Private variables
    this._event = new Emitter;
    this._running = false;
    this._status = 'disconnected';

    this._ble = new BluetoothTerminal(bpplusConnRate,
        '0003abcd-0000-1000-8000-00805f9b0131',
        '00031201-0000-1000-8000-00805f9b0130',
        '\n', '\n',
        flowControl);

    this._ble.connected = function() {
      // todo Using global reference as this would refer to the wrong object
      console.log('connected');
      
      bpplus._status = 'connected';
      bpplus._event.emit('connect', true);
    }

    // Override ble receive function
    this._ble.receive = function(dataview) {
      //console.dir(dataview);
      // Received data is a dataview, convert to Uint8 array and notify
      let data = new Uint8Array(dataview.buffer)

      // Signal anybody that has subscribed
      bpplus._event.emit('receive', data);
    }
  }

  status() {
    return this._status;
  }

  register(type, fn) {
    this._event.on(type, fn);
  }

  connect() {
    console.log('connect');
    // todo Check if a BP+ is connected

    this._ble.connect();
  }

  disconnect() {
    this._ble.disconnect();
    
    this._status = 'disconnected';
    this._event.emit('connect', false);
  }

  async start() {
    // todo Check if connected
    
    this._status = 'running';
  
    this._running = true;
    
    // Clear the receive buffer
    
    // Call the receiver, this is an async call so it will return but stay running
    //this._receiver();
    
    // Write to start the BP+
    //this._ble.send(this._str2ab('d 4\r\n'));
    await this._ble.send('d 4\r\n');
    await this._ble.send('s\r\n');
  }

  cancel() {
    // todo Check if connected

    // Cancel any measurement
    this._ble.send('c\r\n');
  }
  
  stop() {
    // todo Check if connected

    this._status = 'connected';
    this._running = false;
    this._event.emit('stop', true);
  }
  

 _str2ab(str) {
    var buf = new ArrayBuffer(str.length);
    var bufView = new Uint8Array(buf);
    for (var i=0, strLen=str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
    }
    return buf;
  }
}