// Base on https://github.com/espressif/esptool/tree/746023b5dbed058ddc8cdf79f5de5b15e76c401e

const slip = require('./slip.js')
const events = require('events');
const SerialPort = require('serialport')
const port = new SerialPort('/dev/cu.wchusbserial1410', { baudRate: 921600 })
const em = new events.EventEmitter();
const fs = require('fs')
const zlib = require('zlib')

// Commands supported by ESP8266 ROM bootloader
const ESP_REQUEST = 0x0
const ESP_RESPOND = 0x1
const ESP_MEM_BEGIN = 0x05
const ESP_MEM_END = 0x06
const ESP_MEM_DATA = 0x07
const ESP_SYNC = 0x08
const ESP_WRITE_REG = 0x09
const ESP_READ_REG = 0x0a

// OTP ROM addresses
const ESP_OTP_MAC0 = 0x3ff00050
const ESP_OTP_MAC1 = 0x3ff00054
const ESP_OTP_MAC2 = 0x3ff00058
const ESP_OTP_MAC3 = 0x3ff0005c

const SPI_REG_BASE = 0x60000200
const SPI_USR_OFFS = 0x1c
const SPI_USR1_OFFS = 0x20
const SPI_USR2_OFFS = 0x24
const SPI_W0_OFFS = 0x40

const TEXT_MEM_OFFSET = 0x4010E000
const DATA_MEM_OFFSET = 0x3FFFACA8
const ENTRY_ADDR = 0x4010E004

// Maximum block sized for RAM and Flash writes, respectively.
const ESP_RAM_BLOCK = 0x1800
const FLASH_WRITE_SIZE = 0x4000


const ESP_SPI_SET_PARAMS = 0x0B
const ESP_SPI_ATTACH = 0x0D
const ESP_READ_FLASH_SLOW = 0x0e  // ROM only, much slower than the stub flash read
const ESP_CHANGE_BAUDRATE = 0x0F
const ESP_FLASH_DEFL_BEGIN = 0x10
const ESP_FLASH_DEFL_DATA = 0x11
const ESP_FLASH_DEFL_END = 0x12
const ESP_SPI_FLASH_MD5 = 0x13

// Initial state for the checksum routine
const ESP_CHECKSUM_MAGIC = 0xef

const UART_CLKDIV_REG = 0x60000014
const UART_DATE_REG_ADDR = 0x60000078  // used to differentiate ESP8266 vs ESP32*
const UART_DATE_REG2_ADDR = 0x3f400074 // used to differentiate ESP32-S2 vs other models

let syncID;
let decoder = new slip.Decoder({
  onMessage: logMessage,
  maxMessageSize: 209715200,
  bufferSize: 20000
});

port.on('data', chunk => {
  decoder.decode(chunk)
})

function logMessage(msg) {
  console.log("msg", msg)
  if (msg[0] == ESP_RESPOND) {
    // console.log(msg)
    // console.log("")
    let op = msg[1]
    let packetSize = msg[2] | msg[3] << 8
    let value = msg[4] | (msg[5] << 8) | (msg[6] << 16) | (msg[7] << 24)
    // console.log(op, packetSize, value)

    switch (op) {
      case ESP_SYNC:
        if (packetSize == 2 && msg[4] == 0x07 && msg[5] == 0x07 && msg[6] == 0x12 && msg[7] == 0x20) {
          clearTimeout(syncID)
          em.emit("SYNC")
        }
        break
      case ESP_READ_REG:
        // console.log(msg)
        // console.log(op, packetSize, value)
        em.emit('result', value)
        break
      case ESP_WRITE_REG:
        // console.log(op, packetSize, value)
        em.emit('result', value)
        break
      case ESP_MEM_BEGIN:
        em.emit('result')
        break
      case ESP_MEM_DATA:
        em.emit('result')
        break
      case ESP_MEM_END:
        em.emit('result')
        break
      case ESP_CHANGE_BAUDRATE:
        // console.log(msg)
        em.emit('result')
        break
      case ESP_FLASH_DEFL_BEGIN:
        em.emit('result')
        break
      case ESP_FLASH_DEFL_DATA:
        em.emit('result')
        break
    }
  }
}

/**
 * Reverse every two character 
 * @param {string} num
 * @returns {string}
 */
function reverseString(str) {
  return str.match(/.{2}/g).reverse().join("");
}

/**
* Convert to Hex String and Pad Zero
* @param {number} num
* @param {number} length
* @returns {string}
*/
function HexPadingZero(num, length) {
  let str = num.toString(16)
  let len = str.length
  while (len < length) {
    str = "0" + str
    len = str.length
  }
  return str
}

/**
* Requeset Command
* @param {number} op
* @param {number} data
* @param {number} checksum
*/
function req(op, data, checksum = 0) {

  // req + op + size + checksum
  let dataSize = 0
  for (let x in data) {
    if (x !== 'file') {
      dataSize += 4
    } else {
      dataSize += data.file.length
    }
  }
  // console.log("op", op)
  // console.log("dataSize", dataSize)
  // console.log("checksum", checksum)

  let command = new ArrayBuffer(dataSize + 1 + 1 + 2 + 4)
  let view = new DataView(command, 0)
  let pos = 0

  //req
  view.setInt8(pos, ESP_REQUEST, true /* little endian */);
  pos++

  // op
  view.setInt8(pos, op, true);
  pos++

  // size
  view.setInt16(pos, dataSize, true);
  pos = pos + 2

  // checksum
  view.setInt32(pos, checksum, true);
  pos = pos + 4

  for (let x in data) {
    if (x === "file") {
      let file = data['file']
      for (let i = 0; i < file.length; i++) {
        // console.log(file[i])
        view.setInt8(pos, file[i], false) // data no litte endian
        pos++
      }

    } else {
      view.setInt32(pos, data[x], true)
      pos = pos + 4
    }
  }
  console.log("command", new Uint8Array(command))
  let packet = slip.encode(command)
  port.write(packet)
  // console.log("packet", packet)

  return new Promise(resolve => {
    em.addListener('result', result => {
      em.removeAllListeners('result')
      resolve(result)
    })
  })
}

class ESP {
  constructor() { }
  async sync() {
    return new Promise(resolve => {
      let syncCmd = [ESP_REQUEST, ESP_SYNC, 0x24, 0x0, 0x0, 0x0, 0x0, 0x0, 0x07, 0x07, 0x12, 0x20]
      for (let i = 0; i < 32; i++) {
        syncCmd.push(0x55)
      }
      let packet = slip.encode(new Uint8Array(syncCmd))

      em.addListener("SYNC", () => {
        // console.log("sync ok")
        resolve();
      })
      syncID = setInterval(() => {
        port.write(packet)
        console.log(".")
      }, 500)
    })
  }
  async getChipType() {
    return new Promise(async resolve => {
      console.log("Detecting chip type...")
      await req(ESP_READ_REG, { UART_DATE_REG_ADDR })
      await req(ESP_READ_REG, { UART_DATE_REG2_ADDR })
      resolve()
    })
  }
  async getChipName() {
    console.log("Chip is XX")
    return new Promise(async resolve => {
      await req(ESP_READ_REG, { ESP_OTP_MAC3 })
      await req(ESP_READ_REG, { ESP_OTP_MAC2 })
      await req(ESP_READ_REG, { ESP_OTP_MAC1 })
      await req(ESP_READ_REG, { ESP_OTP_MAC0 })
      resolve()
    })
  }
  async getFeature() {
    console.log("Features: XX")
    return new Promise(async resolve => {
      await req(ESP_READ_REG, { ESP_OTP_MAC3 })
      await req(ESP_READ_REG, { ESP_OTP_MAC2 })
      await req(ESP_READ_REG, { ESP_OTP_MAC1 })
      await req(ESP_READ_REG, { ESP_OTP_MAC0 })
      resolve()
    })
  }
  async getCrystal() {
    return new Promise(async resolve => {
      console.log("Crystal is XX")
      await req(ESP_READ_REG, { UART_CLKDIV_REG })
      resolve()
    })
  }
  async getMAC() {
    return new Promise(async resolve => {
      let mac3 = await req(ESP_READ_REG, { address: ESP_OTP_MAC3 })
      let mac1 = await req(ESP_READ_REG, { address: ESP_OTP_MAC1 })
      let mac0 = await req(ESP_READ_REG, { address: ESP_OTP_MAC0 })
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
      resolve()
    })
  }
  async getFlashSize() {
    console.log("Configuring flash size...")
    return new Promise(async resolve => {
      // let R_one = [ESP_READ_REG, 0x4, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_USR_OFFS)]
      // let R_two = [ESP_READ_REG, 0x4, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_USR2_OFFS)]

      // let W_one = [ESP_WRITE_REG, 0x10, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_USR1_OFFS), 0x00, 0x17, 0x00, 0x00, ...MASK, ...DELAY]
      // let W_two = [ESP_WRITE_REG, 0x10, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_USR_OFFS), 0x00, 0x00, 0x00, 0x90, ...MASK, ...DELAY]
      // let W_three = [ESP_WRITE_REG, 0x10, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_USR2_OFFS), 0x9f, 0x00, 0x00, 0x70, ...MASK, ...DELAY]
      // let W_four = [ESP_WRITE_REG, 0x10, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_W0_OFFS), 0x00, 0x00, 0x00, 0x00, ...MASK, ...DELAY]
      // let W_five = [ESP_WRITE_REG, 0x10, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE), 0x00, 0x00, 0x04, 0x00, ...MASK, ...DELAY]

      await req(ESP_READ_REG, { R_one: SPI_REG_BASE | SPI_USR_OFFS, mask: 0xffffffff, delay: 0 })
      console.log("R_one")

      await req(ESP_READ_REG, { R_two: SPI_REG_BASE | SPI_USR2_OFFS, mask: 0xffffffff, delay: 0 })
      await req(ESP_WRITE_REG, { W_one: SPI_REG_BASE | SPI_USR1_OFFS, mask: 0xffffffff, delay: 0 })
      await req(ESP_WRITE_REG, { W_two: SPI_REG_BASE | SPI_USR_OFFS, mask: 0xffffffff, delay: 0 })
      await req(ESP_WRITE_REG, { W_three: SPI_REG_BASE | SPI_USR2_OFFS, mask: 0xffffffff, delay: 0 })
      await req(ESP_WRITE_REG, { W_four: SPI_REG_BASE | SPI_W0_OFFS, mask: 0xffffffff, delay: 0 })
      await req(ESP_WRITE_REG, { W_five: SPI_REG_BASE, mask: 0xffffffff, delay: 0 })

      // let R_three = [ESP_READ_REG, 0x4, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE)]
      // let R_four = [ESP_READ_REG, 0x4, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_W0_OFFS)]

      // let W_six = [ESP_WRITE_REG, 0x10, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_USR_OFFS), 0x44, 0x00, 0x00, 0x80, ...MASK, ...DELAY]
      // let W_seven = [ESP_WRITE_REG, 0x10, 0x0, ...NO_CHECKSUM, ...addrToArray(SPI_REG_BASE | SPI_USR2_OFFS), 0x00, 0x00, 0x00, 0x70, ...MASK, ...DELAY]


      // console.log("R_three");
      // await req(R_three)
      // console.log("R_four");
      // await req(R_four)

      // console.log("W_six");
      // await req(W_six)
      // console.log("W_seven");
      // await req(W_seven)
      resolve()
    })
  }
  async uploadStub() {
    return new Promise(async resolve => {
      let stub = {}
      stub['text_start'] = TEXT_MEM_OFFSET
      stub['data_start'] = DATA_MEM_OFFSET
      stub['text'] = fs.readFileSync('./stub/esp8266/text.stub')
      stub['data'] = fs.readFileSync('./stub/esp8266/data.stub')

      console.log("Uploading stub...")

      for (let field of ['text', 'data']) {
        let offs = stub[field + '_start']
        let length = stub[field].length
        // console.log(length)
        let blocks = Math.ceil(length / ESP_RAM_BLOCK)

        console.log("mem begin")


        await req(ESP_MEM_BEGIN,
          {
            size: length,
            blocks: blocks,
            blockSize: ESP_RAM_BLOCK,
            offset: offs
          })

        // chk:247
        // chk:193
        // chk:224

        // console.log("blocks", blocks)
        for (let seq = 0; seq < blocks; seq++) {
          // console.log("seq", seq)
          let from_offs = seq * ESP_RAM_BLOCK
          let to_offs = from_offs + ESP_RAM_BLOCK
          let data = stub[field].slice(from_offs, to_offs)
          // console.log(data.length)
          // console.log("mem data")
          // console.log("dataSize:", data.length)

          let chk = checksum(data)
          // console.log("chk:", chk)
          await req(ESP_MEM_DATA,
            {
              dataSize: data.length,
              sequence: seq,
              zero1: 0,
              zero2: 0,
              file: data
            },
            chk/* checksum */)
        }
      }

      console.log("Running stub...")

      // console.log("mem finish")
      await req(ESP_MEM_END, { executeFlag: 0, entryAddress: ENTRY_ADDR })

      console.log("Stub running...")
      resolve()
    })
  }
  async changeBaudRate(baudrate) {
    console.log("Changing baud rate to", baudrate)
    return new Promise(async resolve => {
      await req(ESP_CHANGE_BAUDRATE, {
        baudrate: baudrate,
        oldbaud: 921600 // what's mean ?
      })
      console.log("Changed.")
      resolve()
    })
  }
  async eraseFlash() {
    // return new Promise(async resolve => {
    //   let erase_size = [0x00, 0x10, 0x00, 0x00]
    //   let packets = [0x01, 0x00, 0x00, 0x00]
    //   let onePacketsDataSize = [0x00, 0x04, 0x00, 0x00]
    //   let flashOffset = [0x00, 0x00, 0x00, 0x00]
    //   // [ c0, 0, 2, 10,0 ,0,0,0,0, 0,10,0,0,  1,0,0,0,  0,4,0,0, 0, 0, 0, 0, c0 ]
    //   // c0 00 02 1000 00000000 00100000    01000000  00040000   00000000 c0
    //   // c0 01 02 0200  e0401600 0000   c0
    //   //[    1, 2, 2,0, 0,0,107,180, 1, 5 ]
    //   let eraseCmd = [ESP_FLASH_BEGIN, 10, 0, ...NO_CHECKSUM, ...erase_size, ...packets, ...onePacketsDataSize, ...flashOffset]

    //   await req(eraseCmd)
    //   resolve()
    // })
  }
  async writeFlash(address) {
    return new Promise(async resolve => {
      let image = fs.readFileSync("./smart.bin")
      let uncsize = image.length
      let calcmd5

      // compress image
      image = zlib.deflateSync(image, { level: 9 })
      let size = image.length
      let ratio = uncsize / size

      
      // compsize
      let num_blocks = Math.floor((size + FLASH_WRITE_SIZE) / FLASH_WRITE_SIZE)
      // let erase_blocks = Math.ceil(size + FLASH_WRITE_SIZE / FLASH_WRITE_SIZE)
      let write_size = uncsize
      console.log(`Compressed ${uncsize} bytes to ${size}...`)
      
      // enter compressed flash mode
      await req(ESP_FLASH_DEFL_BEGIN, {
        write_size,
        num_blocks,
        FLASH_WRITE_SIZE,
        address,
      })

      // argfile.seek(0)  # in case we need it again
      let seq = 0
      let written = 0
      while (image.length > 0) {
        console.log(`Writing at 0x${address + seq * FLASH_WRITE_SIZE}... (${Math.floor(100 * (seq + 1) / num_blocks)}%)`)
        let block = image.slice(0, FLASH_WRITE_SIZE)

        let chk = checksum(block)
        await req(ESP_FLASH_DEFL_DATA
          , {
            size: block.length,
            sequence: seq,
            zero1: 0,
            zero2: 0,
            file: block
          }
          , chk)
        image = image.slice(FLASH_WRITE_SIZE)
        seq += 1
        written += block.length
      }
      console.log("flash end")
      // await req(ESP_FLASH_DEFL_END, {
      //   reboot: 0
      // })
      // console.log("Reboot...")
      resolve()
    })
  }
}

function checksum(data, state = ESP_CHECKSUM_MAGIC) {
  for (let b of data) {
    state ^= b
  }
  return state
}

function delay(time) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, time * 1000)
  })
}

function addrToArray(addr) {
  let array = addr.toString(16).match(/.{2}/g).reverse()
  array = array.map(e => parseInt(e, 16))
  return array
}


// main
(async function () {
  const esp = new ESP()
  await esp.sync()
  // await esp.getChipType()
  // await esp.getChipName()  // << 96超過javascript最大數值
  // await esp.getFeature()
  // await esp.getCrystal()
  // await esp.getMAC()

  await esp.uploadStub()
  await esp.changeBaudRate(921600)
  // await esp.getFlashSize()
  await esp.writeFlash(0x0)
})()