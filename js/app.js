var remotePatientId = '';
  
var $$ = Dom7;

var app = new Framework7({
  // App root element
  root: '#app',
  // App Name
  name: 'My App',
  // App id
  id: 'com.myapp.test',
  // Enable swipe panel
  panel: {
    swipe: 'left',
  },
  // App root methods
  methods: {
    helloWorld: function () {
      app.dialog.alert('Hello World!');
    },
    test: function () {
      console.log("test");
    },
  },  
  // Add default routes
  routes: [
    {
      path: '/about/',
      url: 'about.html',
    },
  ],
});

var mainView = app.views.create('.view-main');

// Show uploadGevity section if ?uploadGevity=1 is in the URL
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('uploadGevity') === '1') {
    document.getElementById('uploadGevity').style.display = 'block';
}

app.on('tabShow', (tabEl) => {
  //console.log('tab: ' + tabEl.id);
  if (tabEl.id == 'tab1') {
    $$('#button-action').show();
  }
  else {
    $$('.preloader-hide').hide();
    $$('#button-action').hide();
  }
});

// Show and hide the button depending on what tab we are on
/*
$$(document).on('tab:show', function (e) {
  //var $viewEl = $$($$(this).attr('href'));
  console.log('tabx ');
});
*/

function clearPatient() {
  $$('#patient-id').text('-');
  $$('#patient-first').text('-');
  $$('#patient-last').text('-');
  $$('#upload').addClass('disabled');
  remotePatientId = '';
}

function clearResultsSummary() {
  $$('#bSys').text('---');
  $$('#bDia').text('---');
  $$('#cSys').text('---');
  $$('#cDia').text('---');
  $$('#status-pressure').text('---');
}

function clearResultsTable() {
  resultsTableClear();
}

function clearResultsAll() {
  clearResultsSummary();
  clearResultsTable();
}

function updateButtonUpdate() {
  if ((remotePatientId !== '') && ($$('#bSys').text() != '---')) {
    $$('#upload').removeClass('disabled');
  }
}

$$('#button-action').on('click', function (e) {
  console.log('button');

  var status = bpplus.status();
  
  if (status == 'disconnected') {
    //console.log('button: d');
    $$('.preloader-hide').show();

    // do the connection
    bpplus.connect();
    buttonStatus();
    return;
  }

  if (status == 'connected') {
    //console.log('button: c');
    $$('.preloader-hide').hide();
    
    // Clear any previous results
    clearResultsAll();
    
    // Hide the results and show status
    $$('.block-measure').hide();
    $$('.block-status').show();

    start();
    
    buttonStatus();
    return;
  }

  if (status == 'running') {
    //console.log('button: r');
    
    // Clear any previous results
    clearResultsAll();
    
    // Hide the status and show blank results
    $$('.block-measure').show();
    $$('.block-status').hide();

    cancel();
    
    buttonStatus();
    return;
  }

});

//
// Settings
//

// When the connection type changes store the value
$$('#connection').on('change', function (e) {
  var connection = $$('#connection').val();

  // We will have to reload to change the connection
  localStorage.setItem("bpconnection", connection);

/*  
  if (bpplusConnection != connection) {
    bpplusConnection = connection;
    
    delete bpplus;
    switch(bpplusConnection) {
      case 'simulator':
        bpplus = new BpPlusSimulator();
      break;
      
      case 'serial':
        bpplus = new BpPlusSerial();
        break;
      default:
    }
  }
*/
});

// When the rate type changes store the value
$$('#connrate').on('change', function (e) {
  var rate = $$('#connrate').val();

  // We will have to reload to change the connection
  localStorage.setItem("bpconnrate", rate);
});

// Serial tracing toggle — takes effect immediately (no reload needed)
$$('#bptrace').on('change', function (e) {
  var trace = $$('#bptrace').val();
  localStorage.setItem("bptrace", trace);
});

// We need to wait for the DOM to be loaded to set the dropdown value
$$(document).on('DOMContentLoaded', function(){
    
  if (localStorage.bpconnection) {
    var bpplusConnection = localStorage.bpconnection;
    $$('#connection').val(bpplusConnection);
  }
  
  if (localStorage.bpconnrate) {
    var bpplusConnRate = localStorage.bpconnrate;
    $$('#connrate').val(bpplusConnRate);
  }

  if (localStorage.bptrace) {
    $$('#bptrace').val(localStorage.bptrace);
  }

    // If auto is selected change the auto value to what we have calced
  //$$('#connrate').options[0].text('xxx');
  if (bpplusConnRate == 'auto') {
      autorate = getSettingRate();
        document.getElementById("connrate").options[0].text = 'Auto (' + autorate + ')';
  }

  // Fill in the results table now the DOM has been drawn
  resultsTableDraw();

  $$('.preloader-hide').hide();
});


//
// Remote upload functions
//

// Clear the patient fileds when the lookup field is cleared
$$('#person-id').on('input:clear', function (e) {
  clearPatient();
});

$$('#lookup').on('click', function (e) {
  
  //alert(screen.width);
  //alert($$(window).width());
  
  var id = $$('#person-id').val();
  //console.log('lookup ' + id);
  //id = 'paul.beaver@3phealthcare.com.au';

  // Do query for the person
  var url = 'https://beta.gevityhealth.com/feature/gevity/gevityuser/api?Member_email=' + id;

  var request = new XMLHttpRequest();

  request.open('GET', url, true);

  //request.withCredentials = true; // This does not work, cause a CORS error

  request.setRequestHeader("Authorization", "Basic " + window.btoa("mmurdock@longevum.com:Longevum321!"));

  request.setRequestHeader('Accept', 'application/json');
  request.setRequestHeader('Content-Type', 'application/json');
  request.setRequestHeader('X-Gevity-Organisation', 'Cardiaction');

  request.onreadystatechange = function() {
    if (this.readyState == 4 && this.status == 200) {
      //console.log(this.response);
      var data;
      data = this.response.replace('[', '');
      data = data.replace('}]', '}');
      
      try {
        var patient = JSON.parse(data);
        
        remotePatientId = patient.id;

        // Fill in the fields
        $$('#patient-id').text(remotePatientId);
        $$('#patient-first').text(patient._member_id.firstname);
        $$('#patient-last').text(patient._member_id.lastname);
        
        // Enable the upload button
        updateButtonUpdate();
      }
      catch(err) {
        debuglog('error-json');
      }
      
    }
  };

  request.onerror = function() {
    // There was a connection error of some sort
    debuglog('error-connect');
  };

  request.send();
});


$$('#upload').on('click', function (e) {
  // Ensure we have a remote id
  if (remotePatientId == '') {
    console.log('button upload: id error');
    return;
  }
  
  // todo check is we have some data
  
  var url = 'https://beta.gevityhealth.com/feature/gevity/gevitydetailreading/api';
  var request = new XMLHttpRequest();

  request.open('POST', url, true);

  // todo get from a var
  request.setRequestHeader("Authorization", "Basic " + window.btoa("mmurdock@longevum.com:Longevum321!"));
  request.setRequestHeader('Accept', 'application/json');
  request.setRequestHeader('Content-Type', 'application/json');
  request.setRequestHeader('X-Gevity-Organisation', 'Cardiaction');
  
var dataxx = `{
  "user_id": 231,
  "source": "Uscom",
  "source_id": "GUID",
  "reading_type": "reading_blood_pressure",
  "source_device": "BPplus",
  "deleted": 0,
  "values": {
    "sevr": 170, 
    "systolic": 105, 
    "diastolic": 70, 
    "heartrate": 65,
    "pulse_pressure": 35, 
    "ejection_duration": 35, 
    "augmentation_index": 8, 
    "augmentation_pressure": 3
  },
  "timestamp": "2020-08-26 09:30:00"
}`;

var data = `{
"user_id": 0,
"source": "Uscom",
"source_id": "guid",
"reading_type": "reading_blood_pressure",
"source_device": "BPplus",
"deleted": 0,
"values": {
  "systolic": 0,
  "diastolic": 0,
  "heartrate": 400
  },
"timestamp": ""
}`;


  // Put the json into an array
  var dataJsonObj = JSON.parse(data);
  
  // Update the values
  dataJsonObj.user_id = remotePatientId;

  for (var i = 0; i < resultsData.length; ++i) {
    if (resultsData[i]['measure'] === 'Sys') {
      dataJsonObj.values.systolic = parseInt(resultsData[i]['result']);
    }
    if (resultsData[i]['measure'] === 'Dia') {
      dataJsonObj.values.diastolic = parseInt(resultsData[i]['result']);
    }
    if (resultsData[i]['measure'] === 'Pr') {
      dataJsonObj.values.heartrate = parseInt(resultsData[i]['result']);
    }
  }

  for (var i = 0; i < resultsInfo.length; ++i) {
    if (resultsInfo[i]['measure'] === 'datetime') {
      dataJsonObj.timestamp = resultsInfo[i]['result'];
    }
    if (resultsInfo[i]['measure'] === 'guid') {
      dataJsonObj.source_id = resultsInfo[i]['result'];
    }
  }  
  // Create a string to send
  dataJsonString = JSON.stringify(dataJsonObj);

  request.onreadystatechange = function() {
    if (this.readyState == 4 && this.status == 200) {
      // todo check valid response
      console.log(this.response);
      
    }
  };

  request.onerror = function() {
    // There was a connection error of some sort
    console.log('error');
  };

  console.log(dataJsonString);
  
  // todo add error checking
  request.send(dataJsonString);

});


/*

{
  "user_id": 231,
  "source": "manual_data",
  "source_id": "None",
  "reading_type": "reading_blood_pressure",
  "source_device": "Gevity",
  "deleted": 0,
  "values": {
    "sevr": 170, 
    "systolic": 105, 
    "diastolic": 70, 
    "heartrate": 65,
    "pulse_pressure": 35, 
    "ejection_duration": 35, 
    "augmentation_index": 8, 
    "augmentation_pressure": 3
  },
  "timestamp": "2020-05-08 09:30:28"
}

*/