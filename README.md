## Streaming of MQTT via socket.io to browser

# Install:
1. git clone it
2. you need nodeJS / npm or [bun](https://bun.sh/docs/installation)
3. `npm install` or `bun i`
4. rename config.js.sample to config.js
5. adjust config.js to your local MQTT-Broker
6. ` node ./mqtt.js` or `bun ./mqtt.js`
7. Point browser to localhost:8000
8. Enjoy streaming

# Prerequisites:
* MQTT Server (`apt install mosquitto` or docker-mosquitto)
* MQTT-Streaming at wavelog enabled (`config.php`-switch: `$config['mqtt_server']='your_mosquitto_server';`)
