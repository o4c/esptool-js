// Base on https://github.com/espressif/esptool/tree/746023b5dbed058ddc8cdf79f5de5b15e76c401e
// Protocol: https://github.com/espressif/esptool/wiki/Serial-Protocol#initial-synchronisation 

let ESP = (function () {
  // Commands supported by ESP8266 ROM bootloader
  const ESP_REQUEST = 0x0
  const ESP_RESPOND = 0x1
  const ESP_FLASH_BEGIN = 0x02
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

  // Some commands supported by stub only
  const ESP_ERASE_FLASH = 0xD0
  const ESP_ERASE_REGION = 0xD1
  const ESP_READ_FLASH = 0xD2
  const ESP_RUN_USER_CODE = 0xD3

  // CMD
  const ESP_CMD_NOT_IMPLEMENTED = 0xFF
  const ESP_SYNC_BAUD = 115200

  const ESPInfo = {
    ESP8266: {
      TEXT_MEM_OFFSET: 0x4010E000,
      DATA_MEM_OFFSET: 0x3FFFACA8,
      ENTRY_ADDR: 0x4010E004,
      DATE_REG_VALUE: 0x00062000,
      DATE_REG2_VALUE: null
    },
    ESP32: {
      TEXT_MEM_OFFSET: 0x400BE000,
      DATA_MEM_OFFSET: 0x3FFDEBA8,
      ENTRY_ADDR: 0x400BE594,
      DATE_REG_VALUE: 0x15122500,
      DATE_REG2_VALUE: null
    }
  }

  let syncID = null
  let et = new EventTarget()
  let decoder = new slip.Decoder({
    onMessage: parseMsg,
    maxMessageSize: 209715200,
    bufferSize: 20000
  })



  class ESP extends WebSerial {
    constructor(options) {
      super()
      this.options = options
      this.chip = null
    }
    /**
     * 按鈕觸發init，初始化接收與發送的功能，連接時baud為115200最為穩定
     */
    async init() {
      // this.port = await super.connect({ baudrate: ESP_SYNC_BAUD })
      this.port = await super.connect(this.options)
      this.on('data', chunk => {
        decoder.decode(chunk)
      })
    }

    toUartBootMode() {
      return new Promise(async resolve => {
        console.log("To UART Bootloader Mode")
        let i = 5
        // dtr: true => IO0 = LOW
        // rts: true => chip in reset
        while (i > 0) {
          await this.port.setSignals({ dtr: false, rts: true })
          await delay(0.1)
          await this.port.setSignals({ dtr: true, rts: false })
          await delay(0.5)
          await this.port.setSignals({ dtr: false })
          i--
        }
        console.log("UART Bootloader Mode success")
        resolve()
      })
    }

    async sync() {
      return new Promise(resolve => {
        console.log("sync...")
        let syncCmd = [ESP_REQUEST, ESP_SYNC, 0x24, 0x0, 0x0, 0x0, 0x0, 0x0, 0x07, 0x07, 0x12, 0x20]
        for (let i = 0; i < 32; i++) {
          syncCmd.push(0x55)
        }
        let packet = slip.encode(new Uint8Array(syncCmd))
        let syncEvent = ESP_SYNC.toString(16)

        et.addEventListener(syncEvent, function done() {
          et.removeEventListener(syncEvent, done)
          resolve()
        })

        syncID = setInterval(() => {
          this.write(packet)
          console.log(".")
        }, 500)
      })
    }
    getChipType() {
      console.log("Detecting chip type...")
      return new Promise(async resolve => {
        let uartRegAddr = await this.req(ESP_READ_REG, { UART_DATE_REG_ADDR })
        await this.req(ESP_READ_REG, { UART_DATE_REG2_ADDR })
        for (let field of ['ESP8266', 'ESP32']) {
          if (uartRegAddr === ESPInfo[field].DATE_REG_VALUE) {
            this.chip = field
            break
          }
        }
        if (this.chip === null) {
          console.log("Chip is not supported !")
        }
        resolve()
      })
    }
    getCrystal() {
      return new Promise(async resolve => {
        console.log("Crystal is XX")
        await this.req(ESP_READ_REG, { UART_CLKDIV_REG })
        resolve()
      })
    }
    getMAC() {
      return new Promise(async resolve => {
        console.log("getMAC...")
        let mac0 = await this.req(ESP_READ_REG, { address: ESP_OTP_MAC0 })
        let mac1 = await this.req(ESP_READ_REG, { address: ESP_OTP_MAC1 })
        let mac3 = await this.req(ESP_READ_REG, { address: ESP_OTP_MAC3 })
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
    uploadStub() {
      return new Promise(async resolve => {
        if (this.chip === null) resolve()
        console.log(this.chip)
        let stub = {}
        stub['text_start'] = ESPInfo[this.chip].TEXT_MEM_OFFSET
        stub['data_start'] = ESPInfo[this.chip].DATA_MEM_OFFSET

        console.log("Uploading stub...")

        for (let field of ['text', 'data']) {
          await fetch(`./stub/${this.chip}/${field}.stub`)
            .then(res => {
              return res.arrayBuffer()
            }).then(buf => {
              stub[field] = buf
            })

          let offs = stub[field + '_start']
          let length = stub[field].byteLength
          let blocks = Math.ceil(length / ESP_RAM_BLOCK)

          // console.log("mem begin")

          await this.req(ESP_MEM_BEGIN,
            {
              size: length,
              blocks: blocks,
              blockSize: ESP_RAM_BLOCK,
              offset: offs
            })

          for (let seq = 0; seq < blocks; seq++) {
            // console.log("seq", seq)
            let from_offs = seq * ESP_RAM_BLOCK
            let to_offs = from_offs + ESP_RAM_BLOCK
            let data = stub[field].slice(from_offs, to_offs)
            // console.log(data.length)
            // console.log("mem data")
            // console.log("dataSize:", data.byteLength)

            let chk = checksum(data)
            // console.log("chk:", chk)
            await this.req(ESP_MEM_DATA,
              {
                dataSize: data.byteLength,
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
        await this.req(ESP_MEM_END, { executeFlag: 0, entryAddress: ESPInfo[this.chip].ENTRY_ADDR })

        resolve()
      })
    }
    changeBaudRate(baudrate) {
      return new Promise(async resolve => {
        console.log("Board is changing baud to", baudrate)
        await this.req(ESP_CHANGE_BAUDRATE, {
          burnBaud: baudrate,
          syncBaud: ESP_SYNC_BAUD
        })
        console.log("Changed.")
        await delay(0.05)

        await this.setBaudRate(baudrate)
        resolve()
      })
    }
    eraseFlash() {
      return new Promise(async resolve => {
        console.log("Erasing flash (this may take a while)...")
        await this.req(ESP_ERASE_FLASH)

        console.log("Chip erase completed successfully !")
        resolve()
      })
    }
    writeFlash(address, url) {
      return new Promise(async resolve => {
        console.log("start write flash")
        let image
        await fetch(url, {
          mode: 'cors'
        }).then(res => {
          console.log(res)
          return res.arrayBuffer()
        }).then(buf => {
          image = buf
        })
        let uncsize = image.byteLength
        let calcmd5 = md5(image)
        // console.log("file md5:", calcmd5)

        // compress image
        image = pako.deflate(image, { level: 9 })
        let size = image.byteLength
        let ratio = uncsize / size

        // compsize
        let num_blocks = Math.floor((size + FLASH_WRITE_SIZE) / FLASH_WRITE_SIZE)

        let write_size = uncsize
        console.log(`Compressed ${uncsize} bytes to ${size}...`)

        // enter compressed flash mode
        // console.log("flash begin")
        await this.req(ESP_FLASH_DEFL_BEGIN, {
          write_size,
          num_blocks,
          FLASH_WRITE_SIZE,
          address,
        })

        // argfile.seek(0)  # in case we need it again
        let seq = 0
        let written = 0
        while (image.byteLength > 0) {

          let addressIndex = toHEX(address + seq * FLASH_WRITE_SIZE, 8)
          console.log(`Writing at 0x${addressIndex}... (${Math.floor(100 * (seq + 1) / num_blocks)}%)`)
          let block = image.slice(0, FLASH_WRITE_SIZE)

          let chk = checksum(block)
          await this.req(ESP_FLASH_DEFL_DATA,
            {
              size: block.byteLength,
              sequence: seq,
              zero1: 0,
              zero2: 0,
              file: block
            },
            chk)
          image = image.slice(FLASH_WRITE_SIZE)
          seq += 1
          written += block.byteLength
        }
        console.log("flash end")
        await this.verify(address, uncsize, calcmd5)
        resolve()
      })
    }
    async verify(address, size, fileHash) {
      return new Promise(async resolve => {
        let hash = await this.req(ESP_SPI_FLASH_MD5, {
          address,
          size,
          padding: 0,
          padding2: 0
        })
        if(hash === fileHash){
          console.log("verify ok")
          resolve()
        }else{
          console.log("md5 hash error !")
        }
      })
    }
    async setSPI() {
      return new Promise(async resolve => {
        console.log("set spi...")
        await this.req(ESP_SPI_SET_PARAMS, {
          id: 0,
          totalSize: 0x00400000,
          blockSize: 0x00010000,
          sectorSize: 0x00001000,
          pageSize: 0x00000100,
          statusMask: 0x0000ffff,
        })
        resolve()
      })
    }
    /**
     * @param {string, array} fw firmware 
     */
    async burn(fw) {
      await this.toUartBootMode()
      await this.sync()
      await this.getChipType()
      await this.uploadStub()

      // await this.changeBaudRate(this.options.baudrate)

      if (Array.isArray(fw)) {
        for (let [fwUrl, addr] of fw) {
          // await this.setSPI()
          await this.writeFlash(addr, fwUrl)
        }
      } else if (typeof fw === "string") {
        await this.writeFlash(0x0, fw)
      } else {
        console.log("Firmware format is wrong")
        return
      }

      // 0x13 SPI_FLASH_MD5 => Hash of data verified.
      // 0x02 FLASH_BEGIN => Leaving...
      // 0x12
      await this.req(ESP_FLASH_DEFL_END, {
        reboot: 1
      })
      console.log("Reboot...")
      await this.reset()
    }
    async erase() {
      return new Promise(async resolve => {
        await this.toUartBootMode()
        await this.sync()
        await this.getChipType()
        await this.uploadStub()
        await this.eraseFlash()
        this.reset()
        resolve()
      })
    }
    async reset() {
      return new Promise(async resolve => {
        console.log("reset...")
        await this.port.setSignals({ rts: true })
        await delay(0.1)
        await this.port.setSignals({ rts: false })
        resolve()
      })
    }
    stop() {
      clearTimeout(syncID)
    }
    /**
    * Requeset Command
    * @param {number} op
    * @param {number} data
    * @param {number} checksum
    */
    req(op, data, checksum = 0) {

      let dataSize = 0
      if (typeof data === "object") {
        for (let x in data) {
          if (x !== 'file') {
            dataSize += 4
          } else {
            dataSize += data.file.byteLength
          }
        }
      }

      // console.log("op", op)
      // console.log("dataSize", dataSize)
      // console.log("checksum", checksum)
      // console.log("data", data)

      // request + opcode + size + checksum = 1 + 1 + 2 + 4 = 8
      let command = new ArrayBuffer(dataSize + 8)
      let view = new DataView(command, 0)
      let pos = 0

      //request
      view.setInt8(pos, ESP_REQUEST, true /* little endian */)
      pos++

      // opcode
      view.setInt8(pos, op, true)
      pos++

      // size
      view.setInt16(pos, dataSize, true)
      pos = pos + 2

      // checksum
      view.setInt32(pos, checksum, true)
      pos = pos + 4

      for (let x in data) {
        if (x === "file") {
          let file = new Uint8Array(data['file'])
          for (let i = 0; i < file.byteLength; i++) {
            view.setInt8(pos, file[i], false) // no litte endian
            pos++
          }

        } else {
          view.setInt32(pos, data[x], true)
          pos = pos + 4
        }
      }

      // console.log("command", command)
      let packet = slip.encode(command)
      this.write(packet)

      let opEvent = op.toString(16)
      return new Promise(resolve => {
        et.addEventListener(opEvent, function done(e) {
          et.removeEventListener(opEvent, done)
          resolve(e.detail)
        })
      })
    }
  }

  function parseMsg(msg) {
    // console.log("msg", msg)

    if (msg[0] == ESP_RESPOND) {
      let op = msg[1]
      let packetSize = msg[2] | msg[3] << 8
      let value = msg[4] | (msg[5] << 8) | (msg[6] << 16) | (msg[7] << 24)
      // console.log(op, packetSize, value)

      let opEvent = new Event(op.toString(16))

      switch (op) {
        case ESP_SYNC:
          if ((msg[4] == 0x07 && msg[5] == 0x07 && msg[6] == 0x12 && msg[7] == 0x20) || msg[8] == ESP_CMD_NOT_IMPLEMENTED) {
            clearTimeout(syncID)
            et.dispatchEvent(opEvent)
          }
          break
        case ESP_READ_REG:
          opEvent = new CustomEvent(ESP_READ_REG.toString(16), {
            detail: value
          })
          et.dispatchEvent(opEvent)
          break
        case ESP_CHANGE_BAUDRATE:
          et.dispatchEvent(opEvent)
          break
        case ESP_SPI_SET_PARAMS:
          console.log("get spi:", msg)
          et.dispatchEvent(opEvent)
          break
        case ESP_SPI_FLASH_MD5:
          let hash = "";
          for(let i = 8; i < 24; i++){
            hash += toHEX(msg[i], 2)
          } 
          // console.log("hash:", hash)
          opEvent = new CustomEvent(ESP_SPI_FLASH_MD5.toString(16), {
            detail: hash
          })
          et.dispatchEvent(opEvent)
          break
        default:
          et.dispatchEvent(opEvent)
      }
    } else if (String.fromCharCode(...msg) === "OHAI") {
      console.log("Stub running...")
    }
  }

  function checksum(data, state = ESP_CHECKSUM_MAGIC) {
    for (let b of new Uint8Array(data)) {
      state ^= b
    }
    return state
  }

  /**
   * Reverse every two character 
   * @param {string} num
   * @returns {string}
   */
  function reverseString(str) {
    return str.match(/.{2}/g).reverse().join("")
  }

  /**
  * Convert to Hex String and Pad Zero
  * @param {number} num
  * @param {number} length
  * @returns {string}
  */
  function toHEX(num, length) {
    let str = num.toString(16)
    let len = str.length
    while (len < length) {
      str = "0" + str
      len = str.length
    }
    return str
  }

  function delay(time) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, time * 1000)
    })
  }

  return ESP
})()