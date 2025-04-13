## Streaming of MQTT via socket.io to browser

# Install:
1. git clone it
2. you need nodeJS / npm or [bun](https://bun.sh/docs/installation)
3. `npm install` or `bun i`
4. rename config.js.sample to config.js
5. adjust config.js to your local MQTT-Broker and other things
   1. the whitelist - if enbled - expects a JSON-Array of allowed __usernames__)
   2. the prefix - if you want to host it - e.g. via haproxy - at a special subfolder
6. ` node ./mqtt.js` or `bun ./mqtt.js`
7. Point browser to localhost:8000
8. Enjoy streaming

More Details (e.g. running it with docker) at the [wiki](https://github.com/int2001/wavelog_stream/wiki)

# Prerequisites:
* MQTT Server (`apt install mosquitto` or docker-mosquitto)
* MQTT-Streaming at wavelog enabled (`config.php`-switch: `$config['mqtt_server']='your_mosquitto_server';`)

# Usage
* call (for plain-live-view): http://[url]/prefix
* call (fot plain filter on specific call): http://[url]/prefix?call=DJ7NT
* embed to QRZ: http://[url]/prefix?nojs=1
* embed to QRZ with callfilter: http://[url]/prefix?nojs=1&call=DJ7NT

# Additional informations
* Whitelist-Example (can also be a static file):
```
{
whitelist: [
"HB9HIL","LA8AJA","DJ7NT","DF2ET"
]
}
```
