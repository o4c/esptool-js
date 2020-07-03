let getUSB = document.getElementById("getUSB")
let burnSmart = document.getElementById("burnSmart")
let burnBit = document.getElementById("burnBit")
let eraseFw = document.getElementById("eraseFw")
let testMac = document.getElementById("testMac")
let testStub = document.getElementById("testStub")

let esp

const smartFwPath = './smart.bin'
// const smartFwPath = "https://github.com/webduinoio/wafirmata/raw/master/smart_default.bin"
const BitFwPath = "https://github.com/webduinoio/wafirmata/raw/master/bit_default.bin"

getUSB.onclick = async () => {
  esp = new ESP({ baudrate: 115200/* 為燒錄速度 */}) 
  esp.init()
}

burnSmart.onclick = async () => {
  esp.burn('./smart.bin')
}

burnBit.onclick = async () => {
  esp.burn([
    ["./BitFlasher/bootloader_dio_40m.bin", 0x1000],
    ["./BitFlasher/partitions.bin", 0x8000],
    ["./BitFlasher/boot_app0.bin", 0xe0000],
    ["./BitFlasher/0.1.14_0417_01.bin", 0x10000]
  ])
}

eraseFw.onclick = async () => {
  esp.erase()
}

// testMac.onclick = async () => {
//   await esp.getMAC()
// }

// testStub.onclick = async() => {
//   await esp.eraseFlash() 
// }





