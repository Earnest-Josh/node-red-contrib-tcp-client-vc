'use strict';

module.exports = function (RED) {

    //https://github.com/node-red/node-red/blob/master/packages/node_modules/%40node-red/nodes/core/network/31-tcpin.js

    var socketTimeout = RED.settings.socketTimeout||null;

    function TcpClient(config) {

        var net = require('net'); //https://nodejs.org/api/net.html
        var crypto = require('crypto');

        RED.nodes.createNode(this, config);

        this.action = config.action || "listen"; /* listen,close,write */
        this.host = config.host || null;
        this.port = config.port * 1;
        this.topic = config.topic;
        this.debug = config.debug;
        this.stream = (!config.datamode || config.datamode=='stream'); /* stream,single*/
        this.datatype = config.datatype || 'buffer'; /* buffer,utf8,base64,xml */
        this.newline = (config.newline || "").replace("\\n","\n").replace("\\r","\r");

        var node = this;

        var connectionPool = {};
        var server;

        node.on('input', function (msg, nodeSend, nodeDone) {

            if (config.actionType === 'msg' || config.actionType === 'flow' || config.actionType === 'global') {
                node.action = RED.util.evaluateNodeProperty(config.action, config.actionType, this, msg);
            }

            if (config.hostType === 'msg' || config.hostType === 'flow' || config.hostType === 'global') {
                node.host = RED.util.evaluateNodeProperty(config.host, config.hostType, this, msg);
            }

            if (config.portType === 'msg' || config.portType === 'flow' || config.portType === 'global') {
                node.port = (RED.util.evaluateNodeProperty(config.port, config.portType, this, msg)) * 1;
            }
			
			if (config.keyType === 'msg' || config.keyType === 'flow' || config.keyType === 'global') {
                node.key = RED.util.evaluateNodeProperty(config.key, config.keyType, this, msg);
            }

            var id = crypto.createHash('md5').update(`${node.host}${node.port}`).digest("hex");
            //console.log(id)
            var configure = (id) => {
                //console.log(id);
                var socket = connectionPool[id].socket;

                socket.setKeepAlive(true, 120000);

                if (socketTimeout !== null) {
                    socket.setTimeout(socketTimeout);
                }
				
				connectionPool[id].key = node.key;
				//console.log(connectionPool[id].key);

                socket.on('data', (data) => {

                    if (node.debug === 'all') node.warn(`Data received from ${socket.remoteAddress}:${socket.remotePort}`);

                    if (node.datatype != 'buffer') {
                        data = data.toString(node.datatype == 'xml' ? 'utf8' : node.datatype);
                    }
    
                    var buffer = connectionPool[id].buffer;
					
    
                    if (node.stream) {
    
                        var result = {
                            topic: msg.topic || config.topic,
							key:""
                        };

                        if ((typeof data) === "string" && node.newline !== "") {
    
                            buffer = buffer + data;
                            var parts = buffer.split(node.newline);
    
                            for (var i = 0; i < parts.length - 1; i += 1) {
                                
                                result.payload = parts[i];
    
                                if (node.datatype == 'xml') {
    
                                    var xml2js = require('xml2js');
                                    var parseXml = xml2js.parseString;
    
                                    var parseOpts = {
                                        async: true,
                                        attrkey: (config.xmlAttrkey || '$'),
                                        charkey: (config.xmlCharkey || '_'),
                                        explicitArray:  config.xmlArray,
                                        normalizeTags: config.xmlNormalizeTags,
                                        normalize: config.xmlNormalize
                                    };
    
                                    if (config.xmlStrip) {
                                        var stripPrefix = require('xml2js').processors.stripPrefix;
                                        parseOpts.tagNameProcessors = [ stripPrefix ];
                                        parseOpts.attrNameProcessors = [ stripPrefix ];
                                    }
    
                                    var parseStr = result.payload.replace(/^[\x00\s]*/g, "");//Non-whitespace before first tag
                                    parseStr += node.newline;
    
                                    parseXml(parseStr, parseOpts, function (parseErr, parseResult) {
                                        if (!parseErr) { 
                                            result.payload = parseResult;
											result.key = connectionPool[id].key;
											
                                            nodeSend(result);
                                        }
                                    });
    
                                }
                                else {
                                    nodeSend(result);
                                }
    
                            }
    
                            buffer = parts[parts.length - 1];
    
                        }
                        else {
                            result.payload = data;
							//console.log(connectionPool[id].key);
							result.key = connectionPool[id].key;
							//console.log(result.key);
                            nodeSend(result);
                        }
    
                    }
                    else {
    
                        if ((typeof data) === "string") {
                            buffer = buffer + data;
                        }
                        else {
                            buffer = Buffer.concat([buffer, data], buffer.length + data.length);
                        }
    
                    }
    
                    connectionPool[id].buffer = buffer;

                });

                socket.on('end', function () {
                    if (!node.stream || (node.datatype === "utf8" && node.newline !== "")) {
                        var buffer = connectionPool[id].buffer;
                        if (buffer.length > 0) nodeSend({ topic: msg.topic || config.topic, payload: buffer });
                        connectionPool[id].buffer = null;
                    }
                });

                socket.on('timeout', function () {
                    socket.end();
                });

                socket.on('close', function () {
                    delete connectionPool[id];
                });

                socket.on('error', function (err) {
                    node.log(err);
                });

            };

            var close = function() {

                if (node.host == null) {
                    //console.log("1st if");
                    if (node.debug === 'all') node.warn(`Closing port ${node.port}`);
                        //console.log("2nd if");

                    if (connectionPool[id]) {
                        //console.log("coming inside",id);
                        var socket = connectionPool[id].socket;
                        socket.end();
                        socket.destroy();
                        socket.unref();
                        server.close();
                    }

                    connectionPool = {};

                }
                else if (node.port != null) {

                    if (node.debug === 'all') node.warn(`Closing connection to ${node.host}:${node.port}`);
                        //console.log("inside elseif");
                        if (connectionPool[id]) {
                            //console.log("coming inside",id);
                            var socket = connectionPool[id].socket;
                            socket.end();
                            socket.destroy();
                            socket.unref();
                            //server.close();
                        }
                    //TODO

                }
              
            };

            var listen = function() {
                
                if (typeof connectionPool[id] === 'undefined') {

                    if (node.host == null) {

                        if (typeof server === 'undefined') {
    
                            server = net.createServer(function (socket) {
            
                                if (node.debug === 'all') node.warn(`Connection started with ${socket.remoteAddress}:${socket.remotePort}`);

                                connectionPool[id] = {
                                    socket: socket,
                                    buffer: (node.datatype == 'buffer') ? Buffer.alloc(0) : ""
                                };
                                
                                configure(id);
                
                            });
                            
                            server.on('error', function (err) {
                                if (err && node.debug !== 'none') node.error(err);
                            });
            
                        }
        
                        if (node.debug === 'all') node.warn(`Starting to listen on port ${node.port}`);

                        server.listen(node.port, function (err) {
                            if (err && node.debug !== 'none') node.error(err);
                        });
    
                    }
                    else if (node.port != null) {
    
                        connectionPool[id] = {
                            socket: net.connect(node.port, node.host),
                            buffer: (node.datatype == 'buffer') ? Buffer.alloc(0) : ""
                        };

                        configure(id);

                    }
                    else {
                        if (node.debug !== 'none') node.error(`Configuration error`);
                    }

                }
                else {
                    if (node.debug !== 'none') node.error(`Already connected`);
                }

            };

            var write = function() {

                if (connectionPool[id] == null) return;
                var socket = connectionPool[id].socket;

                var writeMsg = config.write;

                if (config.writeType === 'msg' || config.writeType === 'flow' || config.writeType === 'global') {
                    writeMsg = RED.util.evaluateNodeProperty(config.write, config.writeType, this, msg);
                }

                if (writeMsg == null) return;

                if (Buffer.isBuffer(writeMsg)) {
                    socket.write(writeMsg);
                } else if (typeof writeMsg === "string" && node.datatype == 'base64') {
                    socket.write(Buffer.from(writeMsg, 'base64'));
                } else {
                    socket.write(Buffer.from("" + writeMsg));
                }

            };

            switch (node.action.toLowerCase()) {
                case 'close':
                    close();
                    break;
                case 'write':
                    write();
                    break;
                default:
                    listen();
            }

        });

        node.on("close",function() {

            for (var c in connectionPool) {
                if (connectionPool.hasOwnProperty(c)) {
                    var socket = connectionPool[c].socket;
                    socket.end();
                    socket.destroy();
                    socket.unref();
                }
            }

            server.close();
            connectionPool = {};
            node.status({});

        });

    };

    RED.nodes.registerType("tcp-client", TcpClient);

};