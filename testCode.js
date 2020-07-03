const smartFwPath = "https://github.com/webduinoio/wafirmata/raw/master/smart_default.bin"

fetch(smartFwPath, {
  method: 'GET',
  mode: 'no-cors'

}).then(res => {
  console.log(res)
  return res.arrayBuffer()
})