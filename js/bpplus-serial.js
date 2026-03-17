/**
 * BpPlusSerial - communicates with BP+ via a USB serial cable
 * using the WebSerial API.
 */
class BpPlusSerial {

  /**
   * Create serial instance.
   */
  constructor() {
    // Private variables
    this._event = new Emitter;
    this._timer = 500;
    this._timerHandle;
    this._counter = 0;
    this._running = false;
    this._status = 'disconnected';
    this._port;
    this._reader;
    this._writer;
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
    // This is an async call so it will return straight away
    this._serialConnect();
  }

  async _serialConnect() {
    const requestOptions = {
      // Filter on devices with the Arduino USB vendor ID.
      //filters: [{ vendorId: 0x2341 }],
    };

    this._port = await navigator.serial.requestPort(requestOptions);
  
    //console.log(port);

    // Open and begin reading.
    //await this._port.open({baudrate: 115200, flowControl: "hardware"});
    await this._port.open({baudRate: 115200});
  
    this._reader = this._port.readable.getReader();
    this._writer = this._port.writable.getWriter();

    // todo Check if a BP+ is connected

    console.log('connect');
    this._status = 'connected';
    this._event.emit('connect', true);
  }

  async disconnect() {
    this._status = 'disconnected';
    this._event.emit('connect', false);
  
    await this._reader.cancel();
    this._reader.releaseLock();
    this._writer.releaseLock();
    await this._port.close();  
  }

  start() {
    // todo Check if connected
    
    this._status = 'running';
  
    this._running = true;
    this._counter = 0;
    
    // Clear the receive buffer
    
    // Call the receiver, this is an async call so it will return but stay running
    this._receiver();
    
    // Write to start the BP+
    this._transmitter(this._str2ab('d 4\r\n'));
    this._transmitter(this._str2ab('s\r\n'));
  }

  cancel() {
    // todo Check if connected

    // Cancel any measurement
    this._transmitter(this._str2ab('c\r\n'));
  }

  stop() {
    // todo Check if connected

    this._status = 'connected';
    this._running = false;
    this._event.emit('stop', true);
  }
  
  receive(data) {
  }
  
  async _transmitter(data) {
    await this._writer.write(data);
  }
 
  async _receiver() {
    console.log('receiver start');
  
    while (true) {
      // Read and wait for something to arrive on the serial port
      const {value, done} = await this._reader.read();

      // Exit the loop if the reader has ended
      if (done) break;

      //console.log('receiver ' + value);
      /*
      let str = "";
      for (let i = 0; i < value.byteLength; i++) {
        str += String.fromCharCode(value[i]);
      }
      console.log(str);
      */
      
      // Signal anybody that has subscribed
      this._event.emit('receive', value);
    }

    console.log('receiver end');
  }


 _str2ab(str) {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i=0, strLen=str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}


  async _timerProcess () {
    console.log('timer start');
/*  
    while (true) {
      const {value, done} = await this._reader.read();
      if (done) break;
      console.log(value);
    }
*/
  
    while (true) {
      const {value, done} = await this._reader.read();

      if (done) break;

      //console.log(value);
    this._event.emit('receive', value);
    }

  console.log('timer end');
  
  // Start a new timer
  this._timerHandle = setTimeout(this._timerProcess.bind(this), this._timer);

  }  
    

}