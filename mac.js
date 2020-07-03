let mac0 = 0xb46b0000
let mac1 = 0x0200d396
let mac3 = 0x005ccf7f

function getMAC(mac0, mac1, mac3) {
  let oui

  if (mac3 != 0) {
    oui = [(mac3 >> 16) & 0xff, (mac3 >> 8) & 0xff, mac3 & 0xff]
  }
  else if (((mac1 >> 16) & 0xff) == 0) {
    oui = [0x18, 0xfe, 0x34]
  }
  else if (((mac1 >> 16) & 0xff) == 1) {
    oui = [0xac, 0xd0, 0x74]
  }
  let mac = oui.concat([(mac1 >> 8) & 0xff, mac1 & 0xff, (mac0 >> 24) & 0xff])
  mac = mac.map(e => e.toString(16)).toString().replace(/,/g, ":")
  console.log(`MAC: ${mac}`)
}

getMAC(mac0, mac1, mac3)



