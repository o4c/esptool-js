let fs = require('fs')
let stub = {}
stub['text'] = fs.readFileSync('./stub/esp8266/text.stub')

let type = typeof stub['text']
let length = stub['text'].length
console.log(`type:${type} length:${length}`)



