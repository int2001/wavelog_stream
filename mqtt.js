#!/usr/bin/env -S node 
const config = require("./config.js");		// Configfile einbinden
var mqttserver=config.mqttserver.host;		// mqtt-host aus json im configfile holen (ginge auch direkt)
var mqtt = require('mqtt');			// mqtt-module einbinden
var dateFormat = require('dateformat');		// date-format-module einbinden
var topica='#';					// variable in der das topic gehalten wird
const app = require('express')();		// http-express framework laden (macht routing, etc.)
const http = require('http').Server(app);	// http-server module laden
const io = require('socket.io')(http);		// socket.io einbinden
var client=new Array();				// Haelt die einzelnen mqtt-clients je (browser-)client

app.get('/', (req, res) => {			// Routing fuer index.html
  res.sendFile(__dirname + '/index.html');	// index.html rauspusten
});

io.on('connection', (socket) => {			// Neue socket.io Connection?
	console.log(socket.id + " connected");		// Debug
	client[socket.id]  = mqtt.connect(mqttserver);	// Dann neue MQTT-Verbindung aufmachen (je sock.io CLient eine, indiziert ueber die socket.id)
	client[socket.id].subscribe('wavelog/#');	// Vom alten topic "unscubriben"
	/*
	socket.on('wishtopic', (msg) => { 		// Von der Website kommt ein neuer Topic-Wunsch
		client[socket.id].unsubscribe(topica);	// Vom alten topic "unscubriben"
		client[socket.id].subscribe(msg);	// Neues Subscriben
		topica=msg;				// Neues merken
		console.log('message: ' + msg); 	// Debug-Log
	});
	*/
	socket.on("disconnect", (reason) => {		// Socket.io Client gone? Dann mqtt fuer diesen Client wieder schliessen
		client[socket.id].end();
		console.log(socket.id + " disconnected");
	});
	client[socket.id].on('message', function (topic, message) {	// Handler, wenn mqtt-message kommt
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
		tobrowser=parse_msg(msg.content);
		socket.emit("mqtt",tobrowser);				// und raus an den Browser (nur fuer DIESES Socket, nicht fuer alle Clients) damit
		console.log('QSO from: '+tobrowser.station_call+' with '+tobrowser.call+' in Mode: '+tobrowser.mode+' at '+tobrowser.qso_time);
		// socket.emit("mqtt",parse_msg(msg));				// und raus an den Browser (nur fuer DIESES Socket, nicht fuer alle Clients) damit
	});

});

function parse_msg(msg) {
	let retmsg={};
	retmsg.call=msg.COL_CALL;
	retmsg.station_call=msg.COL_STATION_CALLSIGN;
	retmsg.station_grid=msg.COL_MY_GRIDSQUARE;
	retmsg.grid=msg.COL_GRIDSQUARE;
	retmsg.band=msg.COL_BAND;
	retmsg.mode=msg.COL_MODE
	retmsg.RST_RCVD=msg.COL_RST_RCVD;
	retmsg.RST_SENT=msg.COL_RST_SENT;
	retmsg.qso_time=msg.COL_TIME_ON;
	return retmsg;
}

http.listen(8000,'127.0.0.1', () => {						// Webserver starten
  console.log(`Socket.IO server running at http://localhost:8000/`);	// debug
});
