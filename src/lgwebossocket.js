'use strict';
const fs = require('fs');
const fsPromises = fs.promises;
const EventEmitter = require('events');
const WebSocket = require('ws');
const CONSTANS = require('./constans.json');

class LgWebOsSocket extends EventEmitter {
    constructor(config) {
        super();
        const host = config.host;
        const keyFile = config.keyFile;
        const debugLog = config.debugLog;
        const restFulEnabled = config.restFulEnabled;
        const mqttEnabled = config.mqttEnabled;
        const sslWebSocket = config.sslWebSocket;

        this.startPrepareAccessory = true;
        this.socketConnected = false;
        this.specjalizedSocketConnected = false;
        this.power = false;
        this.cidCount = 0;
        this.webOS = 2.0;
        this.modelName = 'LG TV';

        this.connectSocket = async () => {
            //Read pairing key from file
            try {
                this.pairingKey = await this.readPairingKey(keyFile);
            } catch (error) {
                this.emit('error', `Read pairing key error: ${error}`);
            };

            //Socket
            const url = sslWebSocket ? CONSTANS.ApiUrls.WssUrl.replace('lgwebostv', host) : CONSTANS.ApiUrls.WsUrl.replace('lgwebostv', host);
            const socket = sslWebSocket ? new WebSocket(url, { rejectUnauthorized: false }) : new WebSocket(url);
            const debug = debugLog ? this.emit('debug', `Cconnecting socket.`) : false;
            socket.on('open', async () => {
                const debug = debugLog ? this.emit('debug', `Socked connected.`) : false;
                this.socket = socket;
                this.socketConnected = true;

                const heartbeat = setInterval(() => {
                    if (socket.readyState === socket.OPEN) {
                        const debug = debugLog ? this.emit('debug', `Socked send heartbeat.`) : false;
                        socket.ping(null, false, 'UTF-8');
                    }
                }, 3000);

                socket.on('pong', () => {
                    const debug = debugLog ? this.emit('debug', `Socked received heartbeat.`) : false;
                });

                socket.on('close', () => {
                    const debug = debugLog ? this.emit('debug', `Socked closed.`) : false;
                    clearInterval(heartbeat);
                    socket.emit('disconnect');
                });

                //Register to tv
                try {
                    CONSTANS.Pairing['client-key'] = this.pairingKey;
                    this.registerId = await this.getCid();
                    await this.send('register', undefined, CONSTANS.Pairing, this.registerId);
                } catch (error) {
                    this.emit('error', `Register error: ${error}`);
                };
            }).on('message', async (message) => {
                const parsedMessage = JSON.parse(message);
                const messageId = parsedMessage.id;
                const messageType = parsedMessage.type;
                const messageData = parsedMessage.payload;
                const stringifyMessage = JSON.stringify(messageData, null, 2);

                switch (messageId) {
                    case this.registerId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Start registering to TV: ${stringifyMessage}`) : false;
                                this.emit('message', 'Please accept authorization on TV.');
                                break;
                            case 'registered':
                                const debug1 = debugLog ? this.emit('debug', `Registered to TV with key: ${messageData['client-key']}`) : false;

                                //Save key in file if not saved before
                                const pairingKey = messageData['client-key'];
                                if (pairingKey !== this.pairingKey) {
                                    try {
                                        await this.savePairingKey(keyFile, pairingKey);
                                        this.emit('message', 'Pairing key saved.');
                                    } catch (error) {
                                        this.emit('error', `Pairing key save error: ${error}`);
                                    };
                                };

                                //Request specjalized socket
                                try {
                                    this.specjalizedSockedId = await this.getCid();
                                    await this.send('request', CONSTANS.ApiUrls.SocketUrl, undefined, this.specjalizedSockedId);
                                } catch (error) {
                                    this.emit('error', `Request specjalized socket error: ${error}`);
                                };
                                break;
                            case 'error':
                                const debug2 = debugLog ? this.emit('debug', `Register to TV error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug3 = debugLog ? this.emit('debug', this.emit('debug', `Register to TV unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.specjalizedSockedId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Connecting to specjalized socket.`) : false;

                                const socketPath = messageData.socketPath;
                                const specializedSocket = sslWebSocket ? new WebSocket(socketPath, { rejectUnauthorized: false }) : new WebSocket(socketPath);
                                specializedSocket.on('open', async () => {
                                    const debug = debugLog ? this.emit('debug', `Specialized socket connected, path: ${socketPath}.`) : false;
                                    this.specializedSocket = specializedSocket;
                                    this.specjalizedSocketConnected = true;

                                    specializedSocket.on('close', () => {
                                        const debug = debugLog ? this.emit('debug', 'Specialized socket closed.') : false;
                                        specializedSocket.emit('disconnect');
                                    })

                                    //Request system info data
                                    try {
                                        this.systemInfoId = await this.getCid();
                                        await this.send('request', CONSTANS.ApiUrls.GetSystemInfo, undefined, this.systemInfoId);
                                    } catch (error) {
                                        this.emit('error', `Request system info error: ${error}`);
                                    };
                                }).on('error', (error) => {
                                    const debug = debugLog ? this.emit('debug', `Specjalized socket connect error: ${error}.`) : false;
                                    specializedSocket.emit('disconnect');
                                }).on('disconnect', () => {
                                    const message = this.specjalizedSocketConnected ? this.emit('message', 'Specjalized socket disconnected.') : false;
                                    this.specjalizedSocketConnected = false;
                                });
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Connecting to specjalized socket error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Connecting to specjalized socket unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.systemInfoId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `System info: ${stringifyMessage}`) : false;
                                this.modelName = messageData.modelName ?? 'LG TV';

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'systeminfo', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'System info', messageData) : false;

                                //Request software info data
                                try {
                                    this.softwareInfoId = await this.getCid();
                                    await this.send('request', CONSTANS.ApiUrls.GetSoftwareInfo, undefined, this.softwareInfoId);
                                } catch (error) {
                                    this.emit('error', `Request software info error: ${error}`);
                                };
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `System info error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `System info unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.softwareInfoId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Software Info: ${stringifyMessage}`) : false;

                                const productName = messageData.product_name;
                                const deviceId = messageData.device_id;
                                const firmwareRevision = `${messageData.major_ver}.${messageData.minor_ver}`;
                                const match = productName.match(/\d+(\.\d+)?/);
                                this.webOS = match ? parseFloat(match[0]) : this.emit('error', `Unknown webOS system: ${match}.`);

                                this.emit('message', 'Connected.');
                                this.emit('deviceInfo', this.modelName, productName, deviceId, firmwareRevision, this.webOS);

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'softwareinfo', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Software info', messageData) : false;

                                //Request channels list
                                try {
                                    this.channelsId = await this.getCid();
                                    await this.send('request', CONSTANS.ApiUrls.GetChannelList, undefined, this.channelsId);
                                } catch (error) {
                                    this.emit('error', `Request channels error: ${error}`);
                                };
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Software info error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Software info unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.channelsId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Channels list: ${stringifyMessage}`) : false;

                                const channelsList = messageData.channelList;
                                this.emit('channelList', channelsList);

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'channels', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Channels', messageData) : false;

                                //Request apps list
                                try {
                                    this.appsId = await this.getCid();
                                    await this.send('request', CONSTANS.ApiUrls.GetInstalledApps, undefined, this.appsId);
                                } catch (error) {
                                    this.emit('error', `Request apps error: ${error}`);
                                };
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Channels error: ${stringifyMessage}`) : false;

                                //Request apps list
                                try {
                                    this.appsId = await this.getCid();
                                    await this.send('request', CONSTANS.ApiUrls.GetInstalledApps, undefined, this.appsId);
                                } catch (error) {
                                    this.emit('error', `Request apps error: ${error}`);
                                };
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Channels unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.appsId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Apps list: ${stringifyMessage}`) : false;

                                const appsList = messageData.apps;
                                this.emit('appsList', appsList);

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'apps', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Apps', messageData) : false;

                                //Start prepare accessory
                                const prepareAccessory = this.startPrepareAccessory ? this.emit('prepareAccessory') : false;
                                this.startPrepareAccessory = false;

                                await new Promise(resolve => setTimeout(resolve, 2000));
                                //Subscribe tv status
                                try {
                                    const debug = debugLog ? this.emit('debug', `Subscirbe tv status.`) : false;
                                    await this.subscribeTvStatus();
                                    const debug1 = debugLog ? this.emit('debug', `Subscribe tv status successful.`) : false;
                                } catch (error) {
                                    this.emit('error', `Subscribe tv status error: ${error}`);
                                };
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Apps list error: ${stringifyMessage}`) : false;
                                try {
                                    await this.subscribeTvStatus();
                                    const debug = debugLog ? this.emit('debug', `Subscriebe tv status successful.`) : false;
                                } catch (error) {
                                    this.emit('error', `Subscribe tv status error: ${error}`);
                                };
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Apps list unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.powerStateId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Power: ${stringifyMessage}`) : false;

                                let tvScreenState = messageData.state;
                                let screenState = false;
                                let pixelRefresh = false;
                                switch (tvScreenState) {
                                    case 'Active':
                                        this.power = true;
                                        screenState = true;
                                        pixelRefresh = false;
                                        break;
                                    case 'Active Standby':
                                        this.power = false;
                                        screenState = false;
                                        pixelRefresh = true;
                                        break;
                                    case 'Screen Saver':
                                        this.power = true;
                                        screenState = true;
                                        pixelRefresh = false;
                                        break;
                                    case 'Screen Off':
                                        this.power = true;
                                        screenState = false;
                                        pixelRefresh = false;
                                        break;
                                    case 'Suspend':
                                        this.power = false;
                                        screenState = false;
                                        pixelRefresh = false;
                                        break;
                                    default:
                                        this.emit('message', `Unknown power state: ${tvScreenState}`);
                                        break;
                                }
                                this.power = this.webOS >= 3.0 ? this.power : this.socketConnected;
                                this.pixelRefresh = pixelRefresh;
                                this.emit('powerState', this.power, pixelRefresh, screenState, tvScreenState);
                                const disconnect = !this.power ? socket.emit('powerOff') : false;

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'power', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Power', messageData) : false;
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Power error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Power unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.currentAppId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `App: ${stringifyMessage}`) : false;
                                const appId = messageData.appId;

                                this.emit('currentApp', appId);

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'currentapp', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Current App', messageData) : false;
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `App error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `App unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.audioStateId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Audio: ${stringifyMessage}`) : false;
                                const messageDataKeys = Object.keys(messageData);
                                const scenarioExist = messageDataKeys.includes('scenario');
                                const volumeStatusExist = messageDataKeys.includes('volumeStatus');
                                const volumeStatusKeys = volumeStatusExist ? Object.keys(messageData.volumeStatus) : false;
                                const soundOutputExist = volumeStatusKeys ? volumeStatusKeys.includes('soundOutput') : false;

                                //data
                                const audioOutput = scenarioExist ? messageData.scenario : soundOutputExist ? messageData.volumeStatus.soundOutput : undefined;
                                const volume = messageData.volume < 0 ? 0 : messageData.volume;
                                const mute = messageData.mute;
                                this.emit('audioState', volume, mute, audioOutput);

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'audio', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Audio', messageData) : false;
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Audio error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Audio unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.currentChannelId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Channel: ${stringifyMessage}`) : false;
                                const channelId = messageData.channelId;
                                const channelName = messageData.channelName;
                                const channelNumber = messageData.channelNumber;
                                this.emit('currentChannel', channelId, channelName, channelNumber);

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'currentchannel', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Current Channel', messageData) : false;
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Channel error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Channel unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.pictureSettingsId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Picture: ${stringifyMessage}`) : false;
                                const brightness = messageData.settings.brightness;
                                const backlight = messageData.settings.backlight;
                                const contrast = messageData.settings.contrast;
                                const color = messageData.settings.color;
                                const pictureMode = 3;
                                this.emit('pictureSettings', brightness, backlight, contrast, color, pictureMode, this.power);

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'picturesettings', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Picture Settings', messageData) : false;
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Picture error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Picture unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    case this.soundModeId:
                        switch (messageType) {
                            case 'response':
                                const debug = debugLog ? this.emit('debug', `Sound mode: ${stringifyMessage}`) : false;
                                const soundMode = messageData.settings.soundMode;
                                this.emit('soundMode', soundMode, this.power);

                                //restFul
                                const restFul = restFulEnabled ? this.emit('restFul', 'soundmode', messageData) : false;

                                //mqtt
                                const mqtt = mqttEnabled ? this.emit('mqtt', 'Sound Mode', messageData) : false;
                                break;
                            case 'error':
                                const debug1 = debugLog ? this.emit('debug', `Sound mode error: ${stringifyMessage}`) : false;
                                break;
                            default:
                                const debug2 = debugLog ? this.emit('debug', this.emit('debug', `Sound mode unknown message, type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`)) : false;
                                break;
                        };
                        break;
                    default:
                        const debug2 = debugLog ? this.emit('debug', `Unknown message type: ${messageType}, id: ${messageId}, data: ${stringifyMessage}`) : false;
                        break;
                };
            }).on('error', (error) => {
                const debug = debugLog ? this.emit('debug', `Socket connect error: ${error}.`) : false;
                this.pixelRefresh = false;
                socket.emit('disconnect');
            }).on('powerOff', async () => {
                //update TV state
                this.emit('powerState', false, this.pixelRefresh, false, false);
                this.emit('audioState', undefined, true);
                this.emit('pictureSettings', 0, 0, 0, 0, 3, false);
                this.emit('soundMode', undefined, false);
                this.power = false;
            }).on('disconnect', async () => {
                const message = this.socketConnected ? this.emit('message', 'Socket disconnected.') : false;
                this.socketConnected = false;
                this.cidCount = 0;

                //update TV state
                this.emit('powerOff', false, this.pixelRefresh, false, false);
                this.emit('audioState', undefined, true);
                this.emit('pictureSettings', 0, 0, 0, 0, 3, false);
                this.emit('soundMode', undefined, false);
                this.power = false;

                //Prepare accessory
                const prepareAccessory = this.pairingKey.length > 10 && this.startPrepareAccessory ? this.emit('prepareAccessory') : false;
                this.startPrepareAccessory = false;

                await new Promise(resolve => setTimeout(resolve, 3000));
                this.connectSocket();
            });
        }

        this.connectSocket();
    };

    readPairingKey(path) {
        return new Promise(async (resolve, reject) => {
            try {
                const key = await fsPromises.readFile(path);
                const pairingKey = key.length > 10 ? key.toString() : '0';
                resolve(pairingKey);
            } catch (error) {
                reject(error);
            }
        });
    }

    savePairingKey(path, pairingKey) {
        return new Promise(async (resolve, reject) => {
            try {
                await fsPromises.writeFile(path, pairingKey);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    subscribeTvStatus() {
        return new Promise(async (resolve, reject) => {
            try {
                this.powerStateId = await this.getCid();
                await this.send('subscribe', CONSTANS.ApiUrls.GetPowerState, undefined, this.powerStateId);
                this.currentAppId = await this.getCid();
                await this.send('subscribe', CONSTANS.ApiUrls.GetForegroundAppInfo, undefined, this.currentAppId);
                this.currentChannelId = await this.getCid();
                await this.send('subscribe', CONSTANS.ApiUrls.GetCurrentChannel, undefined, this.currentChannelId);
                this.audioStateId = await this.getCid();
                await this.send('subscribe', CONSTANS.ApiUrls.GetAudioStatus, undefined, this.audioStateId);

                if (this.webOS >= 4.0) {
                    const payload = {
                        category: 'picture',
                        keys: ['brightness', 'backlight', 'contrast', 'color']
                    }
                    this.pictureSettingsId = await this.getCid();
                    await this.send('subscribe', CONSTANS.ApiUrls.GetSystemSettings, payload, this.pictureSettingsId);
                }

                if (this.webOS >= 6.0) {
                    const payload = {
                        category: 'sound',
                        keys: ['soundMode']
                    }
                    this.soundModeId = await this.getCid();
                    await this.send('subscribe', CONSTANS.ApiUrls.GetSystemSettings, payload, this.soundModeId);
                }
                resolve();
            } catch (error) {
                reject(error);
            };
        });
    }

    getCid() {
        return new Promise((resolve, reject) => {
            try {
                this.cidCount++;
                const randomPart = (`0000000${Math.floor(Math.random() * 0xFFFFFFFF).toString(16)}`).slice(-8);
                const counterPart = (`000${(this.cidCount).toString(16)}`).slice(-4);
                const cid = randomPart + counterPart;
                resolve(cid);
            } catch (error) {
                reject(error);
            }
        });
    }

    send(type, uri, payload, cid) {
        return new Promise(async (resolve, reject) => {

            try {
                switch (type) {
                    case 'button':
                        if (!this.specjalizedSocketConnected) {
                            reject('Specjalized socket not connected.');
                            return;
                        };

                        const keyValuePairs = Object.entries(payload).map(([key, value]) => `${key}:${value}`);
                        keyValuePairs.unshift(`type:${type}`);
                        const message = keyValuePairs.join('\n') + '\n\n';

                        this.specializedSocket.send(message);
                        resolve();
                        break;
                    default:
                        if (!this.socketConnected) {
                            reject('Socket not connected.');
                            return;
                        };

                        cid = cid === undefined ? await this.getCid() : cid;
                        const data = {
                            id: cid,
                            type: type,
                            uri: uri,
                            payload: payload
                        };

                        const message1 = JSON.stringify(data);
                        this.socket.send(message1);
                        resolve();
                        break
                };
            } catch (error) {
                reject(error);
            };
        });
    };
};
module.exports = LgWebOsSocket;