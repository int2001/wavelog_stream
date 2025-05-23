#!/usr/bin/env -S node 
const config = require("./config.js");		// Configfile einbinden
var mqttserver=config.mqttserver.host;		// mqtt-host aus json im configfile holen (ginge auch direkt)
var mqtt = require('mqtt');			// mqtt-module einbinden
const path = require('path');
const express = require('express');
const app = express();		// http-express framework laden (macht routing, etc.)
const http = require('http').Server(app);	// http-server module laden
const fs = require('fs');
var whitelist=[];


app.use((req, res, next) => {
	res.append('Content-Security-Policy', 'sandbox allow-scripts allow-same-origin');
	res.append('x-frame-options', 'ALLOWALL');
	next();
});

const io = require('socket.io')(http, {path: `${config.prefix}socket.io`,});		// socket.io einbinden

app.use(config.prefix+'jquery', express.static(path.join(__dirname, 'node_modules', 'jquery', 'dist')));

app.get(config.prefix+'stream', (req, res) => {
	serve(req,res);
});

app.get(config.prefix, (req, res) => {
	if ((req.query.nojs || 0) == 1) {
		let baseHTML = fs.readFileSync(path.join(__dirname, 'index_iframe.html'),'utf8');
		res.writeHead(200, { 'Content-Type': 'text/html' });
		if ((req.query.call || '') != '') {
			call='?call='+req.query.call;
		} else {
			call='';
		}
		let newHTML=baseHTML.replace('%%prefix%%/',config.prefix).replace('%%suffix%%',call);
		res.send(newHTML);
	} else {
		res.sendFile(__dirname + '/index.html');
	}
});


function serve(req,res) {
	res.writeHead(200, {
      		'Transfer-Encoding': 'chunked',
		'Content-Type': 'text/html',
	});
	const baseHTML = fs.readFileSync(path.join(__dirname, 'index_nojs.html'));
	res.write(`${baseHTML}\n\n`);
	res.write(``);

	const msghandler = (topic, message) => {
		let tobrowser=handle_mqtt(topic,message);
		if (((tobrowser.station_call || '') != '') && (((req.query.call || '') == '') || (tobrowser.station_call == req.query.call))) {
			const eventData = `
			<tr><td>${tobrowser.qso_time}</td>
			<td>${tobrowser.station_call}</td>
			<td>${tobrowser.station_grid}</td>
			<td>${tobrowser.call}</td>
			<td>${tobrowser.grid}</td>
			<td>${tobrowser.band}</td>
			<td>${tobrowser.qrg}</td>
			<td>${tobrowser.mode}</td>
			<td>${tobrowser.RST_RCVD}</td>
			<td>${tobrowser.RST_SENT}</td>
			</tr>
			`;

			res.write(`${eventData}\n\n`);
		}
	};

	mqttC.on('message', msghandler);

	req.on('close', () => {
		mqttC.removeListener('message', msghandler);
		res.end();
	});
};

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

function handle_mqtt(topic,message) {
	let emitobj={};
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
					emitobj=tobrowser;
				}
			} else {
				console.log("No Timestamp!");
			}
			console.log(topic+' / QSO from: '+tobrowser.station_call+' with '+tobrowser.call+' in Mode: '+tobrowser.mode+' at '+tobrowser.qso_time);
		} else {
			// tobrowser=parse_cat_msg(topic,msg.content);
			// io.emit("cat",tobrowser);				// und raus an den Browser (nur fuer DIESES Socket, nicht fuer alle Clients) damit
			console.log(topic+' / CAT for User '+(msg.content.user_id || '')+' ('+msg.content.user_name+') at '+tobrowser.qrg+' in Mode '+tobrowser.mode);
		}
	} else {
		console.log(msg.content.user_name+' not in Whitelist');
	}
	return emitobj;
};

mqttC.on('message', function (topic, message) {	// Handler, wenn mqtt-message kommt
	let tobrowser=handle_mqtt(topic,message);
	if (tobrowser.call) {
		io.emit("mqtt",tobrowser);				// und raus an den Browser (nur fuer DIESES Socket, nicht fuer alle Clients) damit
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
