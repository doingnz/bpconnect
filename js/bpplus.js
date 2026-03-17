

var bpplusStatus = 'disconnected';
let command = '';
let xml = '';
let xmlcount = 0;
let xmlStart = '';
let xmlLength = 0;
let xmlCrc = 0;

// Create a instance of the bpplus
let bpplus = null;
switch(getSettingConnection()) {
  case 'simulator':
    bpplus = new BpPlusSimulator();
    break;
  case 'serial':
    bpplus = new BpPlusSerial();
    break;
  case 'webserial':
    bpplus = new BpPlusWebSerial();
    break;
  case 'bluetooth':
    bpplus = new BpPlusBle(getSettingRate(), getSettingFlowControl());
    break;
  default:
}

// Register for events
bpplus.register('receive', receiveData);
bpplus.register('connect', connectStatus);
bpplus.register('stop', stopStatus);

bpplusStatus = bpplus.status();


function getSettingConnection() {
    let bpplusConnection = 'simulator';
    
    if (localStorage.bpconnection) {
      //console.log('LocalStorage found: ' + localStorage.bpconnection);
      bpplusConnection = localStorage.bpconnection;
    }
    return bpplusConnection;
}

function getSettingRate() {
    let bpplusConnRate = 'auto';
    
    if (localStorage.bpconnrate) {
      bpplusConnRate = localStorage.bpconnrate;
    }
    
    // If auto determine rate from browser
    if (bpplusConnRate === 'auto') {
        bpplusConnRate = '115200';

        if (navigator.appVersion.indexOf("Win")!=-1)
            bpplusConnRate = '57600';

        if (navigator.appVersion.indexOf("Bluefy")!=-1)
            bpplusConnRate = '19200';
        
        
    }
    
    return bpplusConnRate;    
}


/**
 * Hardware flow control setting.
 * Returns true when the BLE adapter should have RTS/CTS enabled (byte 3 = 0x02).
 * The BP+ device must ALSO have hardware flow control enabled to match.
 * Defaults to true — this prevents data loss on Android by throttling the
 * BP+ serial output when the BLE link can't keep up with 115200 baud.
 */
function getSettingFlowControl() {
    // Default 'hardware' if not explicitly set to 'none'
    return localStorage.getItem('bpflowcontrol') !== 'none';
}


function connectStatus(state) {
  if (state == true) {
    buttonStatus();
  }
}

function stopStatus(state) {
  if (state == true) {
    buttonStatus();
  }
}

function start() {
  command = '';
  
  bpplus.start();
}

function cancel() {
  
  bpplus.cancel();
}

function stop() {
  
  bpplus.stop();
}

// Override function
bpplus.receive = function(data) {
/*  
  if (data.charAt(0) == 'P') {
    //measure_bSys.textContent = data;
    $$('#status').text(data);
    
  }
  else if (data.charAt(0) == 'S') {
    $$('.block-status').hide();
    $$('.block-measure').show();

    $$('#bSys').text(data);
  }
  else {
  }
*/
}

function buttonStatus() {
  // Set the button image depending on the status
  var status = bpplus.status();
  
  if (status == 'disconnected') {
    $$('#button-action-image').attr('src', 'assets/button-connect.svg');
  }
  if (status == 'connected') {
    $$('#button-action-image').attr('src', 'assets/button-start.svg');
    $$('.preloader-hide').hide();
  }
  if (status == 'running') {
    $$('#button-action-image').attr('src', 'assets/button-stop.svg');
  }
}

function receiveData(data) {
  //console.log('receive');
  // Data is ArrayBuffer Uint8, add each byte to the buffer
  for (let i = 0; i < data.byteLength; i++) {
    command += String.fromCharCode(data[i]);
  }  
  
  // todo do this as a stream

  // Print xml activity
  if (xml !== '')
  {
      xmlcount++;
      if (xmlcount % 10 === 0)
          $$('#status-measure').text(xmlcount);
  }
  
  // Look for a \n in the buffer
  while ((index = command.indexOf('\n')) >= 0) {
    // Split off the command and process
    line = command.slice(0, index+1);
    
    command = command.substr(index+1);
    
    receiveProcess(line);
  }
}

function receiveProcess(data) {
  //console.log('event ' + data);
  
  if (data.charAt(0) == 'M') {
    console.log('Mode: ' + data);
  }

  if (data.charAt(0) == 'P') {
    $$('#status-pressure').text(data.replace("P ", ""));
  }
  else if (data.startsWith('M 03')) {
    $$('#status-measure').text('Measuring Blood Pressure');
  }
  else if (data.startsWith('M 04')) {
  }
  else if (data.startsWith('M 05')) {
    $$('#status-measure').text('Measuring');
  }
  else if (data.startsWith('M 06')) {
    $$('#status-measure').text('Measuring Pulse Wave');
  }
  else if (data.startsWith('M 07')) {
    $$('#status-pressure').text("000");
    $$('#status-measure').text('Calculating');
  }
  else if (data.charAt(0) == 'S') {
    // Result received, show it
    $$('.block-status').hide();
    $$('.block-measure').show();
    $$('#status-measure').text('Ready');
    
    var result = data.split(" ");
    // S ID SNR Sys Map Dia Pr cSys cMap cDia sPR sPRV sAI sPPV sSEP RWTTpeak RWTTfoot sDpDtMax

    $$('#bSys').text(result[3]);
    $$('#bDia').text(result[5]);
    $$('#cSys').text(result[7]);
    $$('#cDia').text(result[9]);
    
    resultsTableClear();
    
    for (var i = 0; i < resultsData.length; ++i) {
      if (resultsData[i]['measure'] === 'Sys') {
        resultsData[i]['result'] = result[3];
      }
      if (resultsData[i]['measure'] === 'Dia') {
        resultsData[i]['result'] = result[5];
      }
      if (resultsData[i]['measure'] === 'Map') {
        resultsData[i]['result'] = result[4];
      }
      if (resultsData[i]['measure'] === 'Pr') {
        resultsData[i]['result'] = result[6];
      }
    }
    resultsTableDraw();
  }
  else if (data.startsWith('M 02')) {
    // stopped
    bpplus.stop();
    buttonStatus();
  }
  else if (data.charAt(0) == '|') {
    // Split the string
    var string = data
    string = string.replace('|_XML_Size', '');
    string = string.replace('_|', '');
    string = string.split(' ');

    xmlLength = parseInt(string[0]);
    xmlCrc = parseInt(string[1]);

    xml = '';
    xmlcount = 0;
    xmlStart = '';
    $$('.block-status').hide();
    $$('.block-measure').show();
    $$('#status-measure').text('Receiving');
  }
  // Once xml has started capture everything
  // We do this by checking if xml is not empty
  else if ((xml != '') || (data.trim().charAt(0) == '<')) {
    // This is an xml line but we need to wait until we have
    // the whole before we process so just accumulate
    
    // If this is the first tag then save it
    if (xml === '') {
      // todo Strip and add the slash
      xmlStart = '</BPplus>';
    }
    xml += data;

    //console.log(data);
    //console.log(data.length);
    //console.log(xml);
    
    if (data.startsWith(xmlStart)) {
      // we have received all the XML so process the xml
      //console.log(xml);
      
      // Chop of the last \r\n for the calcs
      var xmldata = xml.trim();
      
      // Check the length
      console.log(xmlLength);
      console.log(xmldata.length);
      if (xmlLength != xmldata.length) {
        console.log('xml length error');
        $$('#status-measure').text('Length error' + xmlLength + ' ' + xmldata.length);
        return;
      }
      
      // Check the CRC
      var crc8 = new CRC8()
      var checksum = crc8.checksum(xmldata);
      if (xmlCrc != checksum) {
        console.log('xml crc error ' + checksum);
        $$('#status-measure').text('CRC error');
        return;
      }
      
      // Parse xml
      parser = new DOMParser();
      resultsXml = parser.parseFromString(xml, "text/xml");

      //console.log(resultsXml.documentElement.nodeName);
      //console.log(resultsXml.getElementsByTagName("Sys")[0].childNodes[0].nodeValue);

      $$('#bSys').text(resultsXml.getElementsByTagName("Sys")[0].childNodes[0].nodeValue);
      $$('#bDia').text(resultsXml.getElementsByTagName("Dia")[0].childNodes[0].nodeValue);
      $$('#cSys').text(resultsXml.getElementsByTagName("cSys")[0].childNodes[0].nodeValue);
      $$('#cDia').text(resultsXml.getElementsByTagName("cDia")[0].childNodes[0].nodeValue);
      $$('#status-measure').text('Ready');

      // Loop throgh the table looking for xml tags
      for (var i = 0; i < resultsData.length; ++i) {
        var tag = resultsData[i]['measure'];
        
        var element = resultsXml.getElementsByTagName(tag);
        if (element.length) {
          resultsData[i]['result'] = element[0].childNodes[0].nodeValue;
        }
      }

      for (var i = 0; i < resultsInfo.length; ++i) {
        var tag = resultsInfo[i]['measure'];
        
        var attrib = resultsXml.getElementsByTagName("MeasDataLogger")[0].getAttribute(tag);
        if (attrib) {
          resultsInfo[i]['result'] = attrib;
        }
      }
/*
      for (var i = 0; i < resultsInfo.length; ++i) {
        if (resultsInfo[i]['measure'] === 'time') {
          resultsInfo[i]['result'] = resultsXml.getElementsByTagName("MeasDataLogger")[0].getAttribute('datetime');
        }
        if (resultsInfo[i]['measure'] === 'guid') {
          resultsInfo[i]['result'] = resultsXml.getElementsByTagName("MeasDataLogger")[0].getAttribute('guid');
        }
      }
*/

      resultsTableDraw();
      updateButtonUpdate();

      // Draw waveform charts in Tab 3
      if (typeof waveformDraw === 'function') {
        waveformDraw(resultsXml);
      }

        xml = '';
    }
    else {
    }
  }
  else {
    console.log('Error: unknown data ' + data);
  }
}

  
var resultsData = [
{"id":1,"measure":"Sys","label":"SYS","unit":"mmHg","result":""},
{"id":2,"measure":"Dia","label":"DIA","unit":"mmHg","result":""},
{"id":3,"measure":"Map","label":"MAP","unit":"mmHg","result":""},
{"id":4,"measure":"Pr","label":"PR","unit":"bpm","result":""},
{"id":5,"measure":"cSys","label":"cSYS","unit":"mmHg","result":""},
{"id":6,"measure":"cDia","label":"cDIA","unit":"mmHg","result":""},
{"id":7,"measure":"cMap","label":"cMAP","unit":"mmHg","result":""},
{"id":8,"measure":"SNR","label":"SNR","unit":"dB","result":""},
{"id":9,"measure":"sPR","label":"sPR","unit":"bpm","result":""},
{"id":10,"measure":"sPRV","label":"sPRV","unit":"ms","result":""},
{"id":11,"measure":"sAI","label":"sAI","unit":"%","result":""},
{"id":12,"measure":"sDpDtMax","label":"sDpDtMax","unit":"mmHg/s","result":""},
{"id":13,"measure":"sPP","label":"sPP","unit":"mmHg","result":""},
{"id":14,"measure":"sPPV","label":"sPPV","unit":"%","result":""},
{"id":15,"measure":"sRWTTFoot","label":"sRWTTFoot","unit":"ms","result":""},
{"id":16,"measure":"sRWTTPeak","label":"sRWTTPeak","unit":"ms","result":""},
{"id":17,"measure":"sSEP","label":"sSEP","unit":"ms","result":""},
];

var resultsInfo = [
{"id":2,"measure":"datetime","label":"time","unit":"","result":""},
{"id":1,"measure":"guid","label":"guid","unit":"","result":""},
{"id":2,"measure":"version","label":"version","unit":"","result":""},
{"id":2,"measure":"nibp","label":"nibp","unit":"","result":""},
{"id":2,"measure":"nibpversion","label":"nibpversion","unit":"","result":""},
{"id":2,"measure":"nibp_id","label":"nibp_id","unit":"","result":""},
{"id":2,"measure":"software_version","label":"software_version","unit":"","result":""},
{"id":2,"measure":"firmware_version","label":"firmware_version","unit":"","result":""},
{"id":2,"measure":"device_id","label":"device_id","unit":"","result":""},
];

function resultsTableDraw() {
  // Create inital results table
  var tableHtml = '';
  for (var i=0; i < resultsData.length; i+=1) {
    tableHtml += '<tr><td class="label-cell">'+resultsData[i].label+'</td><td class="">'+resultsData[i].unit+'</td><td class="numeric-cell">'+resultsData[i].result+'</td></tr>';
  }

  $$('.data-table table tbody').html(tableHtml);
  
  var infoHtml = '';
  for (var i=0; i < resultsInfo.length; i+=1) {
    infoHtml += '<p>' + resultsInfo[i].label + ' = ' + resultsInfo[i].result + '</p>';
  }
  
  $$('.results-info').html(infoHtml);
}

function resultsTableClear() {
  for (var i=0; i < resultsData.length; i+=1) {
    resultsData[i].result = 0.0;
  }
  resultsTableDraw();
}
