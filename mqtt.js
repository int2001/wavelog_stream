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
var qsoHistory = new Map();
var qsoHistoryPath = config.qsoHistoryFile || "./qso_history.json";
var saveTimeout = null;

// Normalize prefix to always end with / (except for empty prefix)
if (config.prefix && config.prefix !== '' && !config.prefix.endsWith('/')) {
	config.prefix = config.prefix + '/';
}


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
		let baseHTML = fs.readFileSync(path.join(__dirname, 'index.html'),'utf8');
		let newHTML=baseHTML.replace(/%%prefix%%/g,config.prefix);
		res.send(newHTML);
	}
});


const streamClients = new Set();

function serve(req,res) {
	res.writeHead(200, {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-cache, no-store, must-revalidate',
		'X-Accel-Buffering': 'no',
	});
	const baseHTML = fs.readFileSync(path.join(__dirname, 'index_nojs.html'));
	res.write(`${baseHTML}\n\n`);

	// Write history rows (newest first, matching socket.io history behavior)
	for (const [stationCall, qsos] of qsoHistory.entries()) {
		if (((req.query.call || '') == '') || (stationCall == req.query.call)) {
			for (let i = qsos.length - 1; i >= 0; i--) {
				const h = qsos[i];
				const histRow = `
			<tr><td>${h.qso_time}</td>
			<td>${h.station_call}</td>
			<td>${h.station_grid}</td>
			<td>${h.call}</td>
			<td>${h.grid}</td>
			<td>${h.band}</td>
			<td>${h.qrg}</td>
			<td>${h.mode}</td>
			<td>${h.RST_RCVD}</td>
			<td>${h.RST_SENT}</td>
			</tr>
			`;
				res.write(`${histRow}\n\n`);
			}
		}
	}

	const sendToClient = (tobrowser) => {
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
			try {
				res.write(`${eventData}\n\n`);
			} catch (e) {
				streamClients.delete(sendToClient);
			}
		}
	};

	streamClients.add(sendToClient);

	req.on('close', () => {
		streamClients.delete(sendToClient);
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
	const date=new Date();					// Timestamp in date merken
	let msg={};							// msg-object initialisieren
	if (message.toString().substring(0,1)=='{') {		// JSON-String? Dann aufbereiten
		try {
			const messagex=JSON.parse(message);		// Versuchen mqtt-nachricht durch den jsonparser zu parsen
			msg.content=messagex;			// ergebnis in content haemmern
		} catch(e) {
			console.log("No JSON");
		}
	} else {
		msg.content=message.toString();			// Ist nix json? dann ab in "content" damit
	}
	if (!(config.whitelist_enabled) || (whitelist.whitelist.includes(msg.content.user_name))) {
		if (topic.startsWith('wavelog/qso/logged')) {
			const tobrowser=parse_qso_msg(msg.content);
			if (tobrowser.qso_time) {
				tobrowser.qso_age=dinmin(tobrowser.qso_time);
				if (tobrowser.qso_age<=10) {
					emitobj=tobrowser;
				}
				addToHistory(tobrowser);
			} else {
				console.log("No Timestamp!");
			}
			console.log(topic+' / QSO from: '+tobrowser.station_call+' with '+tobrowser.call+' in Mode: '+tobrowser.mode+' at '+tobrowser.qso_time);
		} else {
			// tobrowser=parse_cat_msg(topic,msg.content);
			// io.emit("cat",tobrowser);				// und raus an den Browser (nur fuer DIESES Socket, nicht fuer alle Clients) damit
			console.log(topic+' / CAT for User '+(msg.content.user_id || '')+' ('+msg.content.user_name+') at '+msg.content.frequency+' in Mode '+msg.content.mode);
		}
	} else {
		console.log(msg.content.user_name+' not in Whitelist');
	}
	return emitobj;
};

mqttC.on('message', (topic, message) => {	// Handler, wenn mqtt-message kommt
	const tobrowser=handle_mqtt(topic,message);
	if (tobrowser.call) {
		io.emit("mqtt",tobrowser);
	}
	for (const sendToClient of streamClients) {
		sendToClient(tobrowser);
	}
});

io.on('connection', (socket) => {
	console.log(socket.id + " connected // total clients now: "+io.engine.clientsCount);

	// Send full history to the new client
	const allHistory = {};
	for (const [call, qsos] of qsoHistory.entries()) {
		allHistory[call] = qsos;
	}
	socket.emit('history', allHistory);

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
	return Math.floor((Date.now() - new Date(timestamp + 'Z').getTime()) / 60000);
}

function loadQsoHistory() {
	try {
		if (fs.existsSync(qsoHistoryPath)) {
			const data = fs.readFileSync(qsoHistoryPath, 'utf8');
			const parsed = JSON.parse(data);
			for (const [call, qsos] of Object.entries(parsed)) {
				qsoHistory.set(call, qsos);
			}
			console.log(`Loaded QSO history for ${qsoHistory.size} calls`);
		} else {
			console.log('No QSO history file found, starting fresh');
		}
	} catch (e) {
		console.log('Error loading QSO history:', e.message);
	}
}

function saveQsoHistory() {
	const obj = {};
	for (const [call, qsos] of qsoHistory.entries()) {
		obj[call] = qsos;
	}
	try {
		fs.writeFileSync(qsoHistoryPath, JSON.stringify(obj, null, 2), 'utf8');
	} catch (e) {
		console.log('Error saving QSO history:', e.message);
	}
}

function debouncedSaveQsoHistory() {
	if (saveTimeout) {
		clearTimeout(saveTimeout);
	}
	saveTimeout = setTimeout(() => {
		saveQsoHistory();
		saveTimeout = null;
	}, 1000);
}

function addToHistory(qso) {
	const call = qso.station_call;
	if (!call) return;

	let history = qsoHistory.get(call) || [];
	history.unshift(qso);
	if (history.length > 10) {
		history = history.slice(0, 10);
	}
	qsoHistory.set(call, history);
	debouncedSaveQsoHistory();
}

function getHistoryForCall(station_call) {
	return qsoHistory.get(station_call) || [];
}

function startup() {
	loadQsoHistory();
	getWhitelist();
	http.listen(config.webport,config.webbind, () => {						// Webserver starten
		console.log(`Socket.IO server running at http://${config.webbind}:${config.webport}`);	// debug
	});
	const intervalID = setInterval(getWhitelist,5*60*1000);
}

startup();
