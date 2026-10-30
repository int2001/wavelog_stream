#!/usr/bin/env -S node
const config = require("./config.js");		// Configfile einbinden
var mqttserver=config.mqttserver.host;		// mqtt-host aus json im configfile holen (ginge auch direkt)
var mqtt = require('mqtt');			// mqtt-module einbinden
const path = require('path');
const express = require('express');
const app = express();		// http-express framework laden (macht routing, etc.)
const http = require('http').Server(app);	// http-server module laden
const fs = require('fs');
var whitelist={whitelist: []};
var qsoHistory = new Map();
var qsoHistoryPath = config.qsoHistoryFile || "./qso_history.json";
var saveTimeout = null;

// Normalize prefix to start and end with / (empty prefix becomes /)
if (config.prefix && !config.prefix.startsWith('/')) {
	config.prefix = '/' + config.prefix;
}
if (!config.prefix.endsWith('/')) {
	config.prefix = config.prefix + '/';
}


app.use((req, res, next) => {
	res.append('Content-Security-Policy', 'sandbox allow-scripts allow-same-origin');
	next();
});

const io = require('socket.io')(http, {path: `${config.prefix}socket.io`,});		// socket.io einbinden

app.use(config.prefix+'leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));

app.get(config.prefix+'map', (req, res) => {
	let baseHTML = fs.readFileSync(path.join(__dirname, 'map.html'),'utf8');
	let newHTML = baseHTML.replace(/%%prefix%%/g, config.prefix);
	res.send(newHTML);
});

app.get(config.prefix+'stream', (req, res) => {
	serve(req,res);
});

app.get(config.prefix, (req, res) => {
	if ((req.query.nojs || 0) == 1) {
		let baseHTML = fs.readFileSync(path.join(__dirname, 'index_iframe.html'),'utf8');
		let call = '';
		if ((req.query.call || '') != '') {
			call='?call='+encodeURIComponent(req.query.call);
		}
		let newHTML=baseHTML.replace('%%prefix%%/',config.prefix).replace('%%suffix%%',call);
		res.send(newHTML);
	} else {
		let baseHTML = fs.readFileSync(path.join(__dirname, 'index.html'),'utf8');
		let newHTML=baseHTML.replace(/%%prefix%%/g,config.prefix).replace('%%showTime%%', config.showTime === false ? 'false' : 'true');
		res.send(newHTML);
	}
});


const streamClients = new Set();

const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function serve(req,res) {
	res.writeHead(200, {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-cache, no-store, must-revalidate',
		'X-Accel-Buffering': 'no',
		'Content-Security-Policy': 'sandbox allow-scripts allow-same-origin',
	});
	const baseHTML = fs.readFileSync(path.join(__dirname, 'index_nojs.html'), 'utf8').replace(/%%prefix%%/g, config.prefix);
	res.write(`${baseHTML}\n\n`);

	// Flatten all QSOs into a single array and sort by time descending
	const allQsos = [];
	for (const [stationCall, qsos] of qsoHistory.entries()) {
		if (((req.query.call || '') == '') || (stationCall == req.query.call)) {
			for (const qso of qsos) {
				allQsos.push(qso);
			}
		}
	}
	allQsos.sort((a, b) => b.qso_time.localeCompare(a.qso_time));

	// Write history rows (newest first)
	for (const h of allQsos) {
		const histRow = `
		<tr><td>${esc(formatQsoTime(h.qso_time))}</td>
		<td>${esc(h.station_call)}</td>
		<td>${esc(h.station_grid)}</td>
		<td>${esc(h.call)}</td>
		<td>${esc(h.grid)}</td>
		<td>${esc(h.band)}</td>
		<td>${esc(h.qrg)}</td>
		<td>${esc(h.mode)}</td>
		<td>${esc(h.RST_RCVD)}</td>
		<td>${esc(h.RST_SENT)}</td>
		</tr>
		`;
		res.write(`${histRow}\n\n`);
	}

	const sendToClient = (tobrowser) => {
		if (((tobrowser.station_call || '') != '') && (((req.query.call || '') == '') || (tobrowser.station_call == req.query.call))) {
			const eventData = `
			<tr><td>${esc(formatQsoTime(tobrowser.qso_time))}</td>
			<td>${esc(tobrowser.station_call)}</td>
			<td>${esc(tobrowser.station_grid)}</td>
			<td>${esc(tobrowser.call)}</td>
			<td>${esc(tobrowser.grid)}</td>
			<td>${esc(tobrowser.band)}</td>
			<td>${esc(tobrowser.qrg)}</td>
			<td>${esc(tobrowser.mode)}</td>
			<td>${esc(tobrowser.RST_RCVD)}</td>
			<td>${esc(tobrowser.RST_SENT)}</td>
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
	const userName = msg.content?.user_name;
	const wlist = (whitelist && whitelist.whitelist) || [];
	if (!(config.whitelist_enabled) || (wlist.includes(userName))) {
		if (topic.startsWith('wavelog/qso/logged')) {
			const tobrowser=parse_qso_msg(msg.content);
			if (!tobrowser.qso_time) {
				console.log("No Timestamp!");
			} else {
				if (isFarFuture(tobrowser.qso_time)) {
					console.log("Skipping QSO with timestamp far in future: "+tobrowser.qso_time);
				} else {
					tobrowser.qso_age=dinmin(tobrowser.qso_time);
					if (tobrowser.qso_age<=10) {
						emitobj=tobrowser;
					}
					addToHistory(tobrowser);
				}
				console.log(topic+' / QSO from: '+tobrowser.station_call+' with '+tobrowser.call+' in Mode: '+tobrowser.mode+' at '+tobrowser.qso_time);
			}
		} else {
			console.log(topic+' / CAT for User '+(msg.content?.user_id || '')+' ('+userName+') at '+(msg.content?.frequency)+' in Mode '+(msg.content?.mode));
		}
	} else {
		console.log(userName+' not in Whitelist');
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
	if (!msg || !msg.COL_TIME_ON) return retmsg;	// no/partial message -> empty, caller checks qso_time
	retmsg.call=msg.COL_CALL;
	retmsg.station_call=msg.COL_STATION_CALLSIGN;
	retmsg.station_grid=msg.COL_MY_GRIDSQUARE;
	retmsg.grid=msg.COL_GRIDSQUARE;
	retmsg.band=msg.COL_BAND;
	retmsg.mode=msg.COL_MODE
	retmsg.qrg=msg.COL_FREQ/1000 || '';
	retmsg.RST_RCVD=msg.COL_RST_RCVD;
	retmsg.RST_SENT=msg.COL_RST_SENT;
	retmsg.qso_time=msg.COL_TIME_ON;
	return retmsg;
}

const parseTs = (timestamp) => {
	const t = new Date(timestamp + 'Z').getTime();
	return Number.isNaN(t) ? null : t;
}

const dinmin = (timestamp) => {
	const t = parseTs(timestamp);
	return t === null ? -Infinity : Math.floor((Date.now() - t) / 60000);
}

const isFarFuture = (timestamp) => {
	const t = parseTs(timestamp);
	return t !== null && t > Date.now() + 4 * 60 * 60 * 1000;
}

const formatQsoTime = (ts) => {
	return config.showTime === false ? ts.split(' ')[0] : ts;
}

function loadQsoHistory() {
	try {
		if (fs.existsSync(qsoHistoryPath)) {
			const data = fs.readFileSync(qsoHistoryPath, 'utf8');
			const parsed = JSON.parse(data);
			for (const [call, qsos] of Object.entries(parsed)) {
				// Only load valid array entries
				if (Array.isArray(qsos)) {
					const filtered = qsos.filter(qso => qso.qso_time && !isFarFuture(qso.qso_time));
					const dropped = qsos.length - filtered.length;
					if (dropped > 0) {
						console.log(`Dropped ${dropped} future QSOs for ${call} during load`);
					}
					if (filtered.length > 0) {
						qsoHistory.set(call, filtered);
					}
				}
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

function cleanOldQsos() {
	const oneHourAgo = Date.now() - 60 * 60 * 1000;
	let cleaned = 0;

	for (const [call, qsos] of qsoHistory.entries()) {
		// Skip non-array entries (corrupted data)
		if (!Array.isArray(qsos)) {
			qsoHistory.delete(call);
			cleaned++;
			continue;
		}
		const filtered = qsos.filter(qso => {
			const qsoTime = parseTs(qso.qso_time);
			return qsoTime !== null && qsoTime > oneHourAgo && !isFarFuture(qso.qso_time);
		});
		if (filtered.length !== qsos.length) {
			cleaned += qsos.length - filtered.length;
			if (filtered.length === 0) {
				qsoHistory.delete(call);
			} else {
				qsoHistory.set(call, filtered);
			}
		}
	}

	if (cleaned > 0) {
		console.log(`Cleaned ${cleaned} QSOs older than 1 hour`);
		debouncedSaveQsoHistory();
	}
}

function addToHistory(qso) {
	const call = qso.station_call;
	if (!call) return;

	let history = qsoHistory.get(call) || [];
	if (history.some(q => q.call === qso.call && q.qso_time === qso.qso_time)) return;
	history.unshift(qso);
	qsoHistory.set(call, history);
	debouncedSaveQsoHistory();
}

function startup() {
	loadQsoHistory();
	cleanOldQsos();
	getWhitelist();
	http.listen(config.webport,config.webbind, () => {						// Webserver starten
		console.log(`Socket.IO server running at http://${config.webbind}:${config.webport}`);	// debug
	});
	setInterval(getWhitelist,5*60*1000);
	setInterval(cleanOldQsos, 60 * 1000); // Clean old QSOs every minute
}

startup();
