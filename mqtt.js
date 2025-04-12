#!/usr/bin/env -S node 
const config = require("./config.js");		// Configfile einbinden
var mqttserver=config.mqttserver.host;		// mqtt-host aus json im configfile holen (ginge auch direkt)
var mqtt = require('mqtt');			// mqtt-module einbinden
const path = require('path');
const express = require('express');
const app = express();		// http-express framework laden (macht routing, etc.)
const http = require('http').Server(app);	// http-server module laden
var whitelist=[];


app.use((req, res, next) => {
	res.append('Content-Security-Policy', 'sandbox allow-scripts allow-same-origin');
	res.append('x-frame-options', 'ALLOWALL');
	next();
});

const io = require('socket.io')(http, {path: `${config.prefix}/socket.io`,});		// socket.io einbinden

app.use(config.prefix+'/jquery', express.static(path.join(__dirname, 'node_modules', 'jquery', 'dist')));

app.get(config.prefix+'/', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});

const mqttC=mqtt.connect(mqttserver);
mqttC.on('connect', () => {
	console.log('Connected to MQTT broker');
	mqttC.subscribe('wavelog/#', (err) => {
		if (!err) {
			console.log(`Subscribed to topic`);
		} else {
			console.log('Error');
			console.log(err);
		}
	});
});

mqttC.on('message', function (topic, message) {	// Handler, wenn mqtt-message kommt
	date=new Date();					// Timestamp in date merken
	msg={};							// msg-object initialisieren
	if (message.toString().substring(0,1)=='{') {		// JSON-String? Dann aufbereiten
		try {
			messagex=JSON.parse(message);		// Versuchen mqtt-nachricht durch den jsonparser zu parsen
			msg.content=messagex;			// ergebnis in content haemmern
		} catch(e) {
			console.log("No JSON");
		}
	} else {
		msg.content=message.toString();			// Ist nix json? dann ab in "content" damit
	}
	if (!(config.whitelist_enabled) || (whitelist.whitelist.includes(msg.content.user_name))) {
		if (topic.startsWith('wavelog/qso/logged')) {
			tobrowser=parse_qso_msg(msg.content);
			if (tobrowser.qso_time) {
				tobrowser.qso_age=dinmin(tobrowser.qso_time);
				if (tobrowser.qso_age<=10) {
					io.emit("mqtt",tobrowser);				// und raus an den Browser (nur fuer DIESES Socket, nicht fuer alle Clients) damit
				}
			} else {
				console.log("No Timestamp!");
			}
			console.log(topic+' / QSO from: '+tobrowser.station_call+' with '+tobrowser.call+' in Mode: '+tobrowser.mode+' at '+tobrowser.qso_time);
		} else {
			tobrowser=parse_cat_msg(topic,msg.content);
			// io.emit("cat",tobrowser);				// und raus an den Browser (nur fuer DIESES Socket, nicht fuer alle Clients) damit
			console.log(topic+' / CAT for User '+tobrowser.user_id+' ('+msg.content.user_name+') at '+tobrowser.qrg+' in Mode '+tobrowser.mode);
		}
	} else {
		console.log(msg.content.user_name+' not in Whitelist');
	}
});

io.on('connection', (socket) => {	
	console.log(socket.id + " connected // total clients now: "+io.engine.clientsCount);
	socket.on("disconnect", (reason) => {		
		console.log(socket.id + " disconnected // total clients now: "+io.engine.clientsCount);
	});

});

function parse_cat_msg(topic,msg) {
	let retmsg={};
	retmsg.user_id=topic.substring(topic.lastIndexOf('/') + 1)
	retmsg.qrg=msg.frequency;
	retmsg.mode=msg.mode;
	retmsg.time=msg.timestamp;
	return retmsg;
}

async function getWhitelist() {
	if (config.whitelist_enabled) {
		try {
			const response = await fetch(config.whitelist_url);
			if (!response.ok) {
				throw new Error(`HTTP error! Status: ${response.status}`);
			}
			const data = await response.json();
			whitelist = data;
		} catch (error) {
			console.error('Error fetching JSON data:', error);
		}
	}
}

function parse_qso_msg(msg) {
	let retmsg={};
	retmsg.call=msg.COL_CALL;
	retmsg.station_call=msg.COL_STATION_CALLSIGN;
	retmsg.station_grid=msg.COL_MY_GRIDSQUARE;
	retmsg.grid=msg.COL_GRIDSQUARE;
	retmsg.band=msg.COL_BAND;
	retmsg.mode=msg.COL_MODE
	retmsg.qrg=msg.COL_FREQ/1000;
	retmsg.RST_RCVD=msg.COL_RST_RCVD;
	retmsg.RST_SENT=msg.COL_RST_SENT;
	retmsg.qso_time=msg.COL_TIME_ON;
	return retmsg;
}

const dinmin = (timestamp) => {
	return Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
}

function startup() {
	getWhitelist();
	http.listen(config.webport,config.webbind, () => {						// Webserver starten
		console.log(`Socket.IO server running at http://${config.webbind}:${config.webport}`);	// debug
	});
	const intervalID = setInterval(getWhitelist,5*60*1000);
}

startup();
