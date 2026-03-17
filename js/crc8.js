// "Class" for calculating CRC8 checksums...
function CRC8(polynomial) { // constructor takes an optional polynomial type from CRC8.POLY
  if (polynomial == null) polynomial = CRC8.POLY.CRC8
  //this.table = CRC8.generateTable(polynomial);
  
//  this.table = new Uint8Array([
  this.table = [
  0X00, 0X91, 0X61, 0XF0, 0XC2, 0X53, 0XA3, 0X32,
  0XC7, 0X56, 0XA6, 0X37, 0X05, 0X94, 0X64, 0XF5,
  0XCD, 0X5C, 0XAC, 0X3D, 0X0F, 0X9E, 0X6E, 0XFF,
  0X0A, 0X9B, 0X6B, 0XFA, 0XC8, 0X59, 0XA9, 0X38,
  0XD9, 0X48, 0XB8, 0X29, 0X1B, 0X8A, 0X7A, 0XEB,
  0X1E, 0X8F, 0X7F, 0XEE, 0XDC, 0X4D, 0XBD, 0X2C,
  0X14, 0X85, 0X75, 0XE4, 0XD6, 0X47, 0XB7, 0X26,
  0XD3, 0X42, 0XB2, 0X23, 0X11, 0X80, 0X70, 0XE1,
  0XF1, 0X60, 0X90, 0X01, 0X33, 0XA2, 0X52, 0XC3,
  0X36, 0XA7, 0X57, 0XC6, 0XF4, 0X65, 0X95, 0X04,
  0X3C, 0XAD, 0X5D, 0XCC, 0XFE, 0X6F, 0X9F, 0X0E,
  0XFB, 0X6A, 0X9A, 0X0B, 0X39, 0XA8, 0X58, 0XC9,
  0X28, 0XB9, 0X49, 0XD8, 0XEA, 0X7B, 0X8B, 0X1A,
  0XEF, 0X7E, 0X8E, 0X1F, 0X2D, 0XBC, 0X4C, 0XDD,
  0XE5, 0X74, 0X84, 0X15, 0X27, 0XB6, 0X46, 0XD7,
  0X22, 0XB3, 0X43, 0XD2, 0XE0, 0X71, 0X81, 0X10,
  0XA1, 0X30, 0XC0, 0X51, 0X63, 0XF2, 0X02, 0X93,
  0X66, 0XF7, 0X07, 0X96, 0XA4, 0X35, 0XC5, 0X54,
  0X6C, 0XFD, 0X0D, 0X9C, 0XAE, 0X3F, 0XCF, 0X5E,
  0XAB, 0X3A, 0XCA, 0X5B, 0X69, 0XF8, 0X08, 0X99,
  0X78, 0XE9, 0X19, 0X88, 0XBA, 0X2B, 0XDB, 0X4A,
  0XBF, 0X2E, 0XDE, 0X4F, 0X7D, 0XEC, 0X1C, 0X8D,
  0XB5, 0X24, 0XD4, 0X45, 0X77, 0XE6, 0X16, 0X87,
  0X72, 0XE3, 0X13, 0X82, 0XB0, 0X21, 0XD1, 0X40,
  0X50, 0XC1, 0X31, 0XA0, 0X92, 0X03, 0XF3, 0X62,
  0X97, 0X06, 0XF6, 0X67, 0X55, 0XC4, 0X34, 0XA5,
  0X9D, 0X0C, 0XFC, 0X6D, 0X5F, 0XCE, 0X3E, 0XAF,
  0X5A, 0XCB, 0X3B, 0XAA, 0X98, 0X09, 0XF9, 0X68,
  0X89, 0X18, 0XE8, 0X79, 0X4B, 0XDA, 0X2A, 0XBB,
  0X4E, 0XDF, 0X2F, 0XBE, 0X8C, 0X1D, 0XED, 0X7C,
  0X44, 0XD5, 0X25, 0XB4, 0X86, 0X17, 0XE7, 0X76,
  0X83, 0X12, 0XE2, 0X73, 0X41, 0XD0, 0X20, 0XB1];


}

// Returns the 8-bit checksum given an array of byte-sized numbers
CRC8.prototype.checksum = function(byte_array) {
  var c = 0xFF;

  for (var i = 0; i < byte_array.length; i++ ) {
    // todo do a string to byte array
    y = byte_array[i].charCodeAt(0);
    x = c ^ y;
    c = this.table[x % 256];
  }

  return c;
} 

// returns a lookup table byte array given one of the values from CRC8.POLY 
CRC8.generateTable =function(polynomial)
{
  var csTable = [] // 256 max len byte array
  
  for ( var i = 0; i < 256; ++i ) {
    var curr = i
    for ( var j = 0; j < 8; ++j ) {
      if ((curr & 0x80) !== 0) {
        curr = ((curr << 1) ^ polynomial) % 256
      } else {
        curr = (curr << 1) % 256
      }
    }
    csTable[i] = curr 
  }
    
  return csTable
}

// This "enum" can be used to indicate what kind of CRC8 checksum you will be calculating
CRC8.POLY = {
  CRC8 : 0xd5,
  CRC8_CCITT : 0x07,
  CRC8_DALLAS_MAXIM : 0x31,
  CRC8_SAE_J1850 : 0x1D,
  CRC_8_WCDMA : 0x9b,
}