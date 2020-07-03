
let WebSerial = (function () {
  let et = new EventTarget()
  let waitForChangeBaud = false

  class WebSerial {
    constructor() { }
    async connect(options, cb) {
      return new Promise(async resolve => {
        try {
          const filter = {
            usbVendorId: 0x1A86 // CH340
          }
          const port = await navigator.serial.requestPort({ filters: [filter] })
          console.log("Host set baud to", options.baudrate)

          await port.open(options)
          this.writer = port.writable.getWriter()
          this.port = port

          if (typeof cb === "function") cb()
          resolve(port)
        } catch (e) {
          console.log(e)
        }
      })
    }
    async setBaudRate(baud) {
      return new Promise(async resolve => {
        this.baud = baud
        console.log("cancel")
        await this.reader.cancel()
        waitForChangeBaud = true

        et.addEventListener('waitForChangeBaud', () => {
          console.log("Host set baud ok")
          resolve()
        })
      })
    }
    async on(event, cb) {
      while (this.port.readable) {
        this.reader = this.port.readable.getReader()
        console.log("start receiving data...")
        while (true) {
          let value, done
          try {
            if (event == 'data') {
              ({ value, done } = await this.reader.read())
            }
            // console.log("read:", value)
          } catch (error) {
            // Handle |error|...
            break
          }
          if (done) {
            // |reader| has been canceled.
            console.log("reader done")
            break
          }
          // Do something with |value|...
          if (typeof cb === "function")
            cb(value)
        }
        console.log("releaseLock")
        this.reader.releaseLock()
        this.writer.releaseLock()

        console.log("close port")
        await this.port.close()

        if (waitForChangeBaud) {
          let event = new Event('waitForChangeBaud')

          // 若不是透過跳線進入flash mode的情況下，會reboot裝置
          await this.port.open({ baudrate: this.baud, dsrdtr: true })
          console.log(`Host open port: ${this.baud} bps`)

          // 禁止reset
          // await this.port.setSignals({ rts: true })
          console.log("disable board reboot")

          this.writer = this.port.writable.getWriter()

          waitForChangeBaud = false
          et.dispatchEvent(event)
        }
      }
      console.log("stop receiving data !")
    }
    write(packet) {
      if (this.port.writable) {
        // console.log("write:", packet)
        this.writer.write(packet)
      } else {
        console.log("no port support")
      }
    }
  }

  function delay(time) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, time * 1000)
    })
  }

  // Check to see what ports are available when the page loads.
  document.addEventListener('DOMContentLoaded', async () => {
    let ports = await navigator.serial.getPorts()
    // console.log("ports", ports)
    // Populate the UI with options for the user to select or automatically
    // connect to devices.
  })

  navigator.serial.addEventListener('connect', e => {
    // Add |e.port| to the UI or automatically connect.
    console.log("connect", e)
  })

  navigator.serial.addEventListener('disconnect', e => {
    // Remove |e.port| from the UI. If the device was open the disconnection can
    // also be observed as a stream error.
    console.log("disconnect", e)
  })

  return WebSerial
})()

